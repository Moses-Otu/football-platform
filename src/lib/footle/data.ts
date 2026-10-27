import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  compareGuess,
  dayIndex,
  MAX_GUESSES,
  positionGroup,
  puzzleNumber,
  type FootlePlayer,
  type GuessFeedback,
} from "@/lib/footle/clues";

export interface FootleState {
  day: string;
  number: number;
  guesses: GuessFeedback[];
  status: "playing" | "won" | "lost";
  /** Only set once the game is over, so the answer never reaches the browser early. */
  answer: FootlePlayer | null;
  maxGuesses: number;
}

export interface Candidate {
  player: FootlePlayer;
  /** League goals this season; null when the player is not in the top-scorers list. */
  goals: number | null;
}

interface SeasonRow {
  goals: number | null;
  player: {
    id: string;
    display_name: string;
    birth_date: string | null;
    nationality: string | null;
    position: string | null;
  };
  team: { name: string; logo_url: string | null };
}

// Squads change at most once a day (the sync), so keep them in memory
// briefly instead of reloading ~550 players on every guess.
const CANDIDATES_TTL_MS = 10 * 60 * 1000;
let candidatesMemo: { at: number; value: Promise<Candidate[]> } | null = null;

/** Every player in a current-season squad: the names people can guess. */
export function getCandidates(db: SupabaseClient): Promise<Candidate[]> {
  if (candidatesMemo && Date.now() - candidatesMemo.at < CANDIDATES_TTL_MS) return candidatesMemo.value;
  const value = loadCandidates(db);
  candidatesMemo = { at: Date.now(), value };
  value.catch(() => {
    candidatesMemo = null; // don't keep a failed load
  });
  return value;
}

async function loadCandidates(db: SupabaseClient): Promise<Candidate[]> {
  const football = db.schema("football");
  const { data: seasons, error: seasonError } = await football.from("seasons").select("id").eq("is_current", true);
  if (seasonError) throw seasonError;
  if (!seasons.length) return [];

  const { data, error } = await football
    .from("player_seasons")
    .select(
      "goals, player:players!inner(id, display_name, birth_date, nationality, position), team:teams!inner(name, logo_url)",
    )
    .in(
      "season_id",
      seasons.map((s) => s.id),
    )
    .range(0, 4999)
    .overrideTypes<SeasonRow[], { merge: false }>();
  if (error) throw error;

  const byId = new Map<string, Candidate>();
  for (const row of data) {
    const p = row.player;
    byId.set(p.id, {
      goals: row.goals,
      player: {
        id: p.id,
        name: p.display_name,
        club: row.team.name,
        clubLogo: row.team.logo_url,
        nationality: p.nationality,
        position: positionGroup(p.position),
        birthDate: p.birth_date,
      },
    });
  }
  return [...byId.values()].sort((a, b) => a.player.name.localeCompare(b.player.name));
}

/**
 * Possible daily answers: players who have scored this season (so they are
 * recognisable) and have every clue fact on record (so no clue is unknown).
 */
export function answerPool(candidates: Candidate[]): FootlePlayer[] {
  return candidates
    .filter(
      (c) =>
        (c.goals ?? 0) >= 1 && c.player.birthDate && c.player.nationality && c.player.position && c.player.club,
    )
    .map((c) => c.player)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** A day's answer never changes once stored, so remember it per server instance. */
const puzzleMemo = new Map<string, string>();

/** The answer for a day: stored on first use, so it never changes once chosen. */
export async function getOrCreatePuzzle(db: SupabaseClient, day: string, pool: FootlePlayer[]): Promise<string> {
  const known = puzzleMemo.get(day);
  if (known) return known;
  const id = await findOrCreatePuzzle(db, day, pool);
  puzzleMemo.clear(); // keep only today
  puzzleMemo.set(day, id);
  return id;
}

async function findOrCreatePuzzle(db: SupabaseClient, day: string, pool: FootlePlayer[]): Promise<string> {
  const existing = await db.from("daily_puzzles").select("player_id").eq("date", day).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.player_id;

  if (!pool.length) throw new Error("No players are eligible for Footle yet. Run a data sync first.");

  // Avoid repeating recent answers while the pool is big enough.
  const windowDays = Math.min(365, Math.floor(pool.length / 2));
  const since = new Date(Date.parse(`${day}T00:00:00Z`) - windowDays * 864e5).toISOString().slice(0, 10);
  const recent = await db.from("daily_puzzles").select("player_id").gte("date", since);
  if (recent.error) throw recent.error;
  const used = new Set(recent.data.map((r) => r.player_id));
  const choices = pool.filter((p) => !used.has(p.id));
  const pick = (choices.length ? choices : pool)[dayIndex(day, (choices.length ? choices : pool).length)];

  // If two requests race, the first insert wins and both read it back.
  const insert = await db.from("daily_puzzles").upsert({ date: day, player_id: pick.id }, { ignoreDuplicates: true });
  if (insert.error) throw insert.error;
  const chosen = await db.from("daily_puzzles").select("player_id").eq("date", day).single();
  if (chosen.error) throw chosen.error;
  return chosen.data.player_id;
}

export function buildState(
  day: string,
  guessIds: string[],
  answer: FootlePlayer,
  byId: Map<string, FootlePlayer>,
): FootleState {
  const guesses = guessIds.flatMap((id) => {
    const p = byId.get(id);
    return p ? [compareGuess(p, answer, day)] : [];
  });
  const won = guesses.some((g) => g.correct);
  const lost = !won && guesses.length >= MAX_GUESSES;
  return {
    day,
    number: puzzleNumber(day),
    guesses,
    status: won ? "won" : lost ? "lost" : "playing",
    answer: won || lost ? answer : null,
    maxGuesses: MAX_GUESSES,
  };
}

export interface GameRow {
  id: string;
  guesses: string[];
  solved: boolean;
  created_at: string;
}

export async function loadGuestGame(db: SupabaseClient, guestId: string, day: string): Promise<GameRow | null> {
  const { data, error } = await db
    .from("footle_games")
    .select("id, guesses, solved, created_at")
    .eq("guest_id", guestId)
    .eq("puzzle_date", day)
    .maybeSingle();
  if (error) throw error;
  return data;
}
