// Provider-neutral football types. Game and UI code import only these,
// never a provider's raw response shape.

export type ProviderId = "api_football" | "football_data";

/** An id as the provider knows it. Mapped to our UUIDs via football.external_ids. */
export type ExternalId = string;

export interface League {
  externalId: ExternalId;
  name: string;
  country: string | null;
  logoUrl: string | null;
  seasons: { year: number; isCurrent: boolean }[];
}

export interface Team {
  externalId: ExternalId;
  name: string;
  country: string | null;
  logoUrl: string | null;
}

export interface Player {
  externalId: ExternalId;
  fullName: string;
  displayName: string;
  /** ISO date (YYYY-MM-DD). Null when the provider has no value; never guessed. */
  birthDate: string | null;
  nationality: string | null;
  position: string | null;
  photoUrl: string | null;
}

export interface PlayerSeasonStats {
  team: Team;
  leagueExternalId: ExternalId;
  season: number;
  appearances: number | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  /** Any other stats the provider returns, keyed by our names. Missing = absent, not 0. */
  extra: Record<string, number | null>;
}

export interface PlayerWithSeasons {
  player: Player;
  seasons: PlayerSeasonStats[];
}

export type FixtureStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled";

export interface Fixture {
  externalId: ExternalId;
  leagueExternalId: ExternalId;
  season: number;
  kickoffAt: string; // ISO timestamp
  status: FixtureStatus;
  home: Team;
  away: Team;
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
}

export interface FootballProvider {
  readonly id: ProviderId;
  getLeagues(params: { externalIds: ExternalId[] }): Promise<League[]>;
  getTeams(leagueId: ExternalId, season: number): Promise<Team[]>;
  /** Players in a league season, page by page (page 1 first). May be empty if the plan has no player data. */
  getPlayers(leagueId: ExternalId, season: number, page: number): Promise<Page<PlayerWithSeasons>>;
  getFixtures(leagueId: ExternalId, season: number, from: string, to: string): Promise<Fixture[]>;
}
