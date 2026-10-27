import "server-only";

import { createProvider, providerIdFromEnv } from "@/lib/providers";
import type { ProviderId } from "@/lib/providers/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { QuotaExceededError, QuotaGuard } from "@/lib/sync/quota";
import { FootballStore } from "@/lib/sync/store";

export interface SyncConfig {
  provider: ProviderId;
  /** API-Football league ids (39) or football-data.org competition codes (PL). */
  leagueIds: string[];
  season: number;
  /** Most API requests this run may make. */
  maxRequests: number;
}

export function syncConfigFromEnv(): SyncConfig {
  const season = Number(process.env.SYNC_SEASON);
  if (!Number.isInteger(season)) throw new Error("SYNC_SEASON must be set, e.g. 2025");
  const provider = providerIdFromEnv();
  const defaultLeague = provider === "football_data" ? "PL" : "39";
  return {
    provider,
    leagueIds: (process.env.SYNC_LEAGUE_IDS ?? defaultLeague).split(",").map((s) => s.trim()),
    season,
    maxRequests: Number(process.env.SYNC_MAX_REQUESTS_PER_RUN ?? 80),
  };
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * One sync pass: leagues, teams, fixtures for the coming week, then player
 * pages. Pages already in api_cache cost nothing, so a run that stops on
 * the quota resumes where it left off next time.
 */
export async function runSync(config: SyncConfig) {
  const db = createAdminClient();
  const quota = QuotaGuard.fromEnv(config.maxRequests);
  const provider = createProvider(config.provider, db, quota);
  const store = new FootballStore(db, provider.id);
  const runs = db.schema("football").from("sync_runs");

  const { data: run, error } = await runs.insert({ job: `sync:${config.provider}` }).select("id").single();
  if (error) throw error;

  const summary = { teams: 0, fixtures: 0, players: 0, pagesDone: 0, pagesTotal: 0 };
  let status: "ok" | "stopped_quota" | "error" = "ok";
  let message: string | null = null;

  try {
    const seasonIds = new Map<string, string>();
    const leagues = await provider.getLeagues({ externalIds: config.leagueIds });
    for (const league of leagues) {
      const { seasonId } = await store.saveLeague(league, config.season);
      seasonIds.set(`${league.externalId}:${config.season}`, seasonId);
    }
    const seasonIdFor = (leagueId: string, season: number) => seasonIds.get(`${leagueId}:${season}`) ?? null;

    const today = new Date();
    const from = isoDate(new Date(today.getTime() - 3 * 864e5));
    const to = isoDate(new Date(today.getTime() + 7 * 864e5));

    for (const leagueId of config.leagueIds) {
      const seasonId = seasonIdFor(leagueId, config.season);
      if (!seasonId) continue;

      for (const team of await provider.getTeams(leagueId, config.season)) {
        await store.saveTeam(team);
        summary.teams++;
      }
      // A date range can reach into another season; keep only the synced one
      // so every fixture is linked to the season it belongs to.
      const fixtures = (await provider.getFixtures(leagueId, config.season, from, to)).filter(
        (f) => seasonIdFor(f.leagueExternalId, f.season) === seasonId,
      );
      await store.saveFixtures(fixtures, seasonId);
      summary.fixtures += fixtures.length;

      let page = 1;
      let totalPages = 1;
      do {
        const result = await provider.getPlayers(leagueId, config.season, page);
        totalPages = result.totalPages;
        await store.savePlayers(result.items, seasonIdFor);
        summary.players += result.items.length;
        summary.pagesDone++;
        page++;
      } while (page <= totalPages);
      summary.pagesTotal += totalPages;
    }
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      status = "stopped_quota";
    } else {
      status = "error";
    }
    message = e instanceof Error ? e.message : String(e);
  }

  await runs
    .update({
      finished_at: new Date().toISOString(),
      requests_used: quota.requestsUsed,
      requests_remaining: quota.remaining,
      status,
      error: message,
    })
    .eq("id", run.id);

  return { status, message, requestsUsed: quota.requestsUsed, requestsRemaining: quota.remaining, ...summary };
}
