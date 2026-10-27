import "server-only";

import type { ApiFootballEnvelope } from "@/lib/providers/api-football/client";
import type { CachedGet } from "@/lib/sync/cache";
import type {
  Fixture,
  FixtureStatus,
  FootballProvider,
  League,
  Page,
  PlayerSeasonStats,
  PlayerWithSeasons,
  Team,
} from "@/lib/providers/types";

import type { RawFixture, RawLeague, RawPlayerItem, RawPlayerStatistic, RawTeam } from "./raw";

const DAY = 24 * 60 * 60;
const TTL = {
  leagues: 30 * DAY,
  teams: 7 * DAY,
  players: 7 * DAY,
  fixtures: 60 * 60,
};

const STATUS: Record<string, FixtureStatus> = {
  TBD: "scheduled",
  NS: "scheduled",
  "1H": "live",
  HT: "live",
  "2H": "live",
  ET: "live",
  BT: "live",
  P: "live",
  SUSP: "live",
  INT: "live",
  LIVE: "live",
  FT: "finished",
  AET: "finished",
  PEN: "finished",
  AWD: "finished",
  WO: "finished",
  PST: "postponed",
  CANC: "cancelled",
  ABD: "cancelled",
};

const toNumber = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function mapTeam(t: RawTeam): Team {
  return {
    externalId: String(t.id),
    name: t.name,
    country: t.country ?? null,
    logoUrl: t.logo ?? null,
  };
}

function mapSeasonStats(s: RawPlayerStatistic): PlayerSeasonStats {
  return {
    team: mapTeam(s.team),
    leagueExternalId: String(s.league.id),
    season: s.league.season,
    appearances: toNumber(s.games.appearences),
    minutes: toNumber(s.games.minutes),
    goals: toNumber(s.goals.total),
    assists: toNumber(s.goals.assists),
    extra: {
      rating: toNumber(s.games.rating),
      shots_total: toNumber(s.shots?.total),
      shots_on: toNumber(s.shots?.on),
      passes_total: toNumber(s.passes?.total),
      passes_key: toNumber(s.passes?.key),
      tackles_total: toNumber(s.tackles?.total),
      dribbles_success: toNumber(s.dribbles?.success),
      yellow_cards: toNumber(s.cards?.yellow),
      red_cards: toNumber(s.cards?.red),
    },
  };
}

function mapPlayer(item: RawPlayerItem): PlayerWithSeasons {
  const p = item.player;
  const fullName = [p.firstname, p.lastname].filter(Boolean).join(" ").trim();
  return {
    player: {
      externalId: String(p.id),
      fullName: fullName || p.name,
      displayName: p.name,
      birthDate: p.birth?.date ?? null,
      nationality: p.nationality ?? null,
      position: item.statistics[0]?.games.position ?? null,
      photoUrl: p.photo ?? null,
    },
    seasons: item.statistics.map(mapSeasonStats),
  };
}

function mapFixture(f: RawFixture): Fixture {
  return {
    externalId: String(f.fixture.id),
    leagueExternalId: String(f.league.id),
    season: f.league.season,
    kickoffAt: f.fixture.date,
    status: STATUS[f.fixture.status.short] ?? "scheduled",
    home: mapTeam(f.teams.home),
    away: mapTeam(f.teams.away),
    homeGoals: f.goals.home,
    awayGoals: f.goals.away,
  };
}

export class ApiFootballProvider implements FootballProvider {
  readonly id = "api_football" as const;

  constructor(private readonly get: CachedGet) {}

  async getLeagues({ externalIds }: { externalIds: string[] }): Promise<League[]> {
    const leagues: League[] = [];
    for (const id of externalIds) {
      const body = await this.get<ApiFootballEnvelope<RawLeague>>("/leagues", { id }, TTL.leagues);
      for (const l of body.response) {
        leagues.push({
          externalId: String(l.league.id),
          name: l.league.name,
          country: l.country?.name ?? null,
          logoUrl: l.league.logo ?? null,
          seasons: l.seasons.map((s) => ({ year: s.year, isCurrent: s.current })),
        });
      }
    }
    return leagues;
  }

  async getTeams(leagueId: string, season: number): Promise<Team[]> {
    const body = await this.get<ApiFootballEnvelope<{ team: RawTeam }>>(
      "/teams",
      { league: leagueId, season },
      TTL.teams,
    );
    return body.response.map((r) => mapTeam(r.team));
  }

  async getPlayers(leagueId: string, season: number, page: number): Promise<Page<PlayerWithSeasons>> {
    const body = await this.get<ApiFootballEnvelope<RawPlayerItem>>(
      "/players",
      { league: leagueId, season, page },
      TTL.players,
    );
    return {
      items: body.response.map(mapPlayer),
      page: body.paging.current,
      totalPages: body.paging.total,
    };
  }

  async getFixtures(leagueId: string, season: number, from: string, to: string): Promise<Fixture[]> {
    const body = await this.get<ApiFootballEnvelope<RawFixture>>(
      "/fixtures",
      { league: leagueId, season, from, to },
      TTL.fixtures,
    );
    return body.response.map(mapFixture);
  }
}
