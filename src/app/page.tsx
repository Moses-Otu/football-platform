import { connection } from "next/server";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";

const FEATURES = [
  { title: "Footle", body: "Guess the mystery player from clues. A new one every day." },
  { title: "Players", body: "Browse profiles, nationality, position and career history." },
  { title: "Compare", body: "Put two players side by side on the stats both have." },
  { title: "Guess the Score", body: "Predict results before kick-off and climb the table." },
];

async function getDataStatus() {
  try {
    const football = createAdminClient().schema("football");
    const [players, fixtures, lastRun] = await Promise.all([
      football.from("players").select("id", { count: "exact", head: true }),
      football.from("fixtures").select("id", { count: "exact", head: true }),
      football
        .from("sync_runs")
        .select("started_at, status, requests_used")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    return {
      ok: true as const,
      players: players.count ?? 0,
      fixtures: fixtures.count ?? 0,
      lastRun: lastRun.data,
    };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

async function DataStatus() {
  await connection();
  const status = await getDataStatus();

  return status.ok ? (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 tabular-nums">
      <dt className="text-muted-foreground">Players (all seasons)</dt>
      <dd>{status.players}</dd>
      <dt className="text-muted-foreground">Fixtures</dt>
      <dd>{status.fixtures}</dd>
      <dt className="text-muted-foreground">Last sync</dt>
      <dd>
        {status.lastRun
          ? `${new Date(status.lastRun.started_at).toUTCString()} (${status.lastRun.status})`
          : "Never run"}
      </dd>
      <dt className="text-muted-foreground">API requests used</dt>
      <dd>{status.lastRun?.requests_used ?? "None yet"}</dd>
    </dl>
  ) : (
    <p className="text-muted-foreground">
      Not connected to the database yet: {status.error}. Fill in <code>.env.local</code> as the README describes.
    </p>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-3">
        <Badge variant="secondary" className="w-fit">
          In development
        </Badge>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">Footle</h1>
        <p className="max-w-prose text-lg text-muted-foreground">
          Daily football puzzles, player discovery and friendly competition, built on verified data.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <CardHeader>
              <CardTitle>{f.title}</CardTitle>
              <CardDescription>{f.body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Data status</CardTitle>
          <CardDescription>What the last sync stored.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
            <DataStatus />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
