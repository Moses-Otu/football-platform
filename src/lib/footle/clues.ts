// Pure Footle rules: no I/O, so they run in tests, on the server and in the browser.

export const MAX_GUESSES = 6;

/** The day Footle #1 was played (UTC). */
export const LAUNCH_DATE = "2026-10-27";

export type PositionGroup = "Goalkeeper" | "Defender" | "Midfielder" | "Forward";

/** What a clue needs to know about a player. Missing facts stay null. */
export interface FootlePlayer {
  id: string;
  name: string;
  club: string | null;
  clubLogo: string | null;
  nationality: string | null;
  position: PositionGroup | null;
  birthDate: string | null; // YYYY-MM-DD
}

export type Match = "match" | "miss" | "unknown";
/** For age: is the answer older, younger or the same as the guess? */
export type AgeHint = "match" | "older" | "younger" | "unknown";

export interface GuessFeedback {
  player: FootlePlayer;
  age: number | null;
  correct: boolean;
  club: Match;
  nationality: Match;
  position: Match;
  ageHint: AgeHint;
}

// Providers label positions at different levels of detail ("Midfield",
// "Defensive Midfield"). Group them so clues compare like with like.
const POSITION_GROUPS: Record<string, PositionGroup> = {
  goalkeeper: "Goalkeeper",
  defence: "Defender",
  defender: "Defender",
  "centre-back": "Defender",
  "left-back": "Defender",
  "right-back": "Defender",
  midfield: "Midfielder",
  midfielder: "Midfielder",
  "central midfield": "Midfielder",
  "defensive midfield": "Midfielder",
  "attacking midfield": "Midfielder",
  "left midfield": "Midfielder",
  "right midfield": "Midfielder",
  offence: "Forward",
  attacker: "Forward",
  forward: "Forward",
  "centre-forward": "Forward",
  "second striker": "Forward",
  "left winger": "Forward",
  "right winger": "Forward",
};

export function positionGroup(raw: string | null | undefined): PositionGroup | null {
  if (!raw) return null;
  return POSITION_GROUPS[raw.trim().toLowerCase()] ?? null;
}

/** Whole years between a birth date and a day, both YYYY-MM-DD. */
export function ageOn(birthDate: string | null, day: string): number | null {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

function compare(a: string | null, b: string | null): Match {
  if (a === null || b === null) return "unknown";
  return a === b ? "match" : "miss";
}

export function compareGuess(guess: FootlePlayer, answer: FootlePlayer, day: string): GuessFeedback {
  const guessAge = ageOn(guess.birthDate, day);
  const answerAge = ageOn(answer.birthDate, day);
  let ageHint: AgeHint = "unknown";
  if (guessAge !== null && answerAge !== null) {
    ageHint = guessAge === answerAge ? "match" : answerAge > guessAge ? "older" : "younger";
  }

  return {
    player: guess,
    age: guessAge,
    correct: guess.id === answer.id,
    club: compare(guess.club, answer.club),
    nationality: compare(guess.nationality, answer.nationality),
    position: compare(guess.position, answer.position),
    ageHint,
  };
}

/** Footle #1 is LAUNCH_DATE; one puzzle per UTC day after that. */
export function puzzleNumber(day: string): number {
  const ms = Date.parse(`${day}T00:00:00Z`) - Date.parse(`${LAUNCH_DATE}T00:00:00Z`);
  return Math.floor(ms / 864e5) + 1;
}

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const TILE: Record<Match, string> = { match: "🟩", miss: "⬛", unknown: "⬜" };
const AGE_TILE: Record<AgeHint, string> = { match: "🟩", older: "⬆️", younger: "⬇️", unknown: "⬜" };

/** The spoiler-free result people paste to friends. */
export function shareText(day: string, guesses: GuessFeedback[], solved: boolean): string {
  const score = solved ? `${guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  const rows = guesses.map((g) =>
    g.correct
      ? "🟩🟩🟩🟩"
      : [TILE[g.club], TILE[g.nationality], TILE[g.position], AGE_TILE[g.ageHint]].join(""),
  );
  return [`Footle #${puzzleNumber(day)} ${score}`, ...rows].join("\n");
}

/**
 * A stable pseudo-random index for a day, so the same date always picks the
 * same answer from the same pool (FNV-1a hash of the date string).
 */
export function dayIndex(day: string, poolSize: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % poolSize;
}
