import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { utcDay } from "@/lib/footle/clues";
import { answerPool, buildState, getCandidates, getOrCreatePuzzle, loadGuestGame } from "@/lib/footle/data";
import { createAdminClient } from "@/lib/supabase/admin";

import { FootleGame } from "./footle-game";
import { GUEST_COOKIE } from "./guest";

export const metadata: Metadata = {
  title: "Daily puzzle",
  description: "Guess today's mystery Premier League player in six tries.",
};

async function FootleLoader() {
  // The puzzle depends on today's date, so render at request time.
  await connection();
  const jar = await cookies();
  const db = createAdminClient();
  const day = utcDay();

  const candidates = await getCandidates(db);
  const byId = new Map(candidates.map((c) => [c.player.id, c.player]));
  const answerId = await getOrCreatePuzzle(db, day, answerPool(candidates));
  const answer = byId.get(answerId);
  if (!answer) {
    return <p className="text-muted-foreground">Today&apos;s puzzle is unavailable. Try again later.</p>;
  }

  const guestId = jar.get(GUEST_COOKIE)?.value;
  const game = guestId ? await loadGuestGame(db, guestId, day) : null;
  const state = buildState(day, game?.guesses ?? [], answer, byId);

  // Only what the search box needs; nothing here marks which player is the answer.
  const options = candidates.map((c) => ({ id: c.player.id, name: c.player.name, club: c.player.club }));
  return <FootleGame initialState={state} options={options} />;
}

export default function FootlePage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <Link href="/" className="w-fit text-sm text-muted-foreground hover:text-foreground">
          ← Home
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">Footle</h1>
        <p className="text-muted-foreground">
          Guess today&apos;s mystery Premier League player in six tries. Each guess shows how close you are on club,
          nationality, position and age.
        </p>
      </header>
      <Suspense fallback={<p className="text-muted-foreground">Loading today&apos;s puzzle…</p>}>
        <FootleLoader />
      </Suspense>
    </main>
  );
}
