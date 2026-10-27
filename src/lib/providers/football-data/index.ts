import "server-only";

import type { CachedGet } from "@/lib/sync/cache";
import type {
  Fixture,
  FixtureStatus,
  FootballProvider,
  League,
  Page,
  PlayerWithSeasons,
  Team,
} from "@/lib/providers/types";

import type {
  RawCompetition,
  RawMatch,
  RawMatchesResponse,
  RawSeason,
  RawTeam,
  RawTeamRef,
  RawTeamsResponse,
} from "./raw";

const DAY = 24 * 60 * 60;
const TTL = {
  competitions: 30 * DAY,
  teams: 7 * DAY,
  matches: 60 * 60,
};

const STATUS: Record<string, FixtureStatus> = {
  SCHEDULED: "scheduled",
  TIMED: "scheduled",
  IN_PLAY: "live",
  PAUSED: "live",
  SUSPENDED: "live",
  FINISHED: "finished",
  AWARDED: "finished",
  POSTPONED: "postponed",
  CANCELLED: "cancelled",
};

/** football-data.org names a season by the year it starts (2025 = 2025/26). */
const seasonYear = (s: RawSeason) => Number(s.startDate.slice(0, 4));

function mapTeam(t: RawTeamRef & { area?: { name: string | null } | null }): Team {
  return {
    externalId: String(t.id),
    name: t.name ?? t.shortName ?? `Team ${t.id}`,
    country: t.area?.name ?? null,
    logoUrl: t.crest ?? null,
  };
}

function mapMatch(m: RawMatch): Fixture {
  return {
    externalId: String(m.id),
    leagueExternalId: m.competition.code,
    season: seasonYear(m.season),
    kickoffAt: m.utcDate,
    status: STATUS[m.status] ?? "scheduled",
    home: mapTeam(m.homeTeam),
    away: mapTeam(m.awayTeam),
    homeGoals: m.score.fullTime.home,
    awayGoals: m.score.fullTime.away,
  };
}

/**
 * football-data.org adapter. League ids are competition codes (PL, PD, BL1,
 * SA, FL1, ...). Squads come with the teams call when the plan includes
 * them; the free plan may return none, and then getPlayers returns nothing.
 * The free plan has no per-player stats, so season stats stay null.
 */
export class FootballDataProvider implements FootballProvider {
  readonly id = "football_data" as const;

  constructor(private readonly get: CachedGet) {}

  private teamsWithSquads(code: string, season: number) {
    return this.get<RawTeamsResponse>(`/competitions/${code}/teams`, { season }, TTL.teams);
  }

  async getLeagues({ externalIds }: { externalIds: string[] }): Promise<League[]> {
    const leagues: League[] = [];
    for (const code of externalIds) {
      const c = await this.get<RawCompetition>(`/competitions/${code}`, {}, TTL.competitions);
      const seasons = c.seasons?.length ? c.seasons : c.currentSeason ? [c.currentSeason] : [];
      leagues.push({
        externalId: c.code,
        name: c.name,
        country: c.area?.name ?? null,
        logoUrl: c.emblem,
        seasons: seasons.map((s) => ({ year: seasonYear(s), isCurrent: s.id === c.currentSeason?.id })),
      });
    }
    return leagues;
  }

  async getTeams(leagueId: string, season: number): Promise<Team[]> {
    const body = await this.teamsWithSquads(leagueId, season);
    return body.teams.map(mapTeam);
  }

  async getPlayers(leagueId: string, season: number, page: number): Promise<Page<PlayerWithSeasons>> {
    // One call returns every team with its squad, so there is only one page.
    if (page > 1) return { items: [], page, totalPages: 1 };

    const body = await this.teamsWithSquads(leagueId, season);
    const items: PlayerWithSeasons[] = [];
    for (const t of body.teams as RawTeam[]) {
      const team = mapTeam(t);
      for (const p of t.squad ?? []) {
        if (!p.name) continue;
        const fullName = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
        items.push({
          player: {
            externalId: String(p.id),
            fullName: fullName || p.name,
            displayName: p.name,
            birthDate: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : null,
            nationality: p.nationality,
            position: p.position,
            photoUrl: null,
          },
          seasons: [
            {
              team,
              leagueExternalId: leagueId,
              season,
              appearances: null,
              minutes: null,
              goals: null,
              assists: null,
              extra: {},
            },
          ],
        });
      }
    }
    return { items, page: 1, totalPages: 1 };
  }

  async getFixtures(leagueId: string, _season: number, from: string, to: string): Promise<Fixture[]> {
    // dateTo is exclusive in football-data.org, so the range already ends before `to`.
    const body = await this.get<RawMatchesResponse>(
      `/competitions/${leagueId}/matches`,
      { dateFrom: from, dateTo: to },
      TTL.matches,
    );
    return body.matches.map(mapMatch);
  }
}
