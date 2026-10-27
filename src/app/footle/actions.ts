"use server";

import { cookies } from "next/headers";

import { utcDay } from "@/lib/footle/clues";
import { answerPool, buildState, getCandidates, getOrCreatePuzzle, loadGuestGame, type FootleState } from "@/lib/footle/data";
import { createAdminClient } from "@/lib/supabase/admin";

import { GUEST_COOKIE } from "./guest";

export type GuessResult = { ok: true; state: FootleState } | { ok: false; error: string; state?: FootleState };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks one guess on the server. Anyone can call a Server Action with a
 * direct POST, so every rule is enforced here, not in the browser.
 */
export async function submitGuess(playerId: unknown): Promise<GuessResult> {
  if (typeof playerId !== "string" || !UUID.test(playerId)) {
    return { ok: false, error: "Pick a player from the list." };
  }

  const db = createAdminClient();
  const day = utcDay();
  const candidates = await getCandidates(db);
  const byId = new Map(candidates.map((c) => [c.player.id, c.player]));
  const answerId = await getOrCreatePuzzle(db, day, answerPool(candidates));
  const answer = byId.get(answerId);
  if (!answer) return { ok: false, error: "Today's puzzle is unavailable. Try again later." };

  const jar = await cookies();
  let guestId = jar.get(GUEST_COOKIE)?.value;
  if (!guestId || !UUID.test(guestId)) {
    guestId = crypto.randomUUID();
    jar.set(GUEST_COOKIE, guestId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }

  const game = await loadGuestGame(db, guestId, day);
  const previous = game?.guesses ?? [];
  const before = buildState(day, previous, answer, byId);

  if (before.status !== "playing") return { ok: false, error: "Today's game is finished.", state: before };
  if (!byId.has(playerId)) return { ok: false, error: "Pick a player from the list.", state: before };
  if (previous.includes(playerId)) return { ok: false, error: "You already guessed that player.", state: before };

  const guesses = [...previous, playerId];
  const solved = playerId === answerId;
  const finished = solved || guesses.length >= before.maxGuesses;
  const durationMs = finished && game ? Date.now() - Date.parse(game.created_at) : null;

  if (game) {
    const { error } = await db
      .from("footle_games")
      .update({ guesses, guess_count: guesses.length, solved, duration_ms: durationMs })
      .eq("id", game.id);
    if (error) throw error;
  } else {
    const { error } = await db.from("footle_games").insert({
      guest_id: guestId,
      puzzle_date: day,
      guesses,
      guess_count: guesses.length,
      solved,
      duration_ms: finished ? 0 : null,
    });
    if (error) throw error;
  }

  return { ok: true, state: buildState(day, guesses, answer, byId) };
}
