// Raw football-data.org v4 response shapes: only the fields we read.
// Field names come from the v4 docs (docs.football-data.org).

export interface RawArea {
  name: string | null;
}

export interface RawTeamRef {
  id: number;
  name: string | null;
  shortName?: string | null;
  crest?: string | null;
}

export interface RawSeason {
  id: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

export interface RawCompetition {
  id: number;
  code: string;
  name: string;
  emblem: string | null;
  area: RawArea | null;
  currentSeason: RawSeason | null;
  seasons?: RawSeason[];
}

export interface RawSquadMember {
  id: number;
  name: string | null;
  firstName?: string | null;
  lastName?: string | null;
  position: string | null;
  dateOfBirth: string | null;
  nationality: string | null;
}

export interface RawTeam extends RawTeamRef {
  area?: RawArea | null;
  /** Empty or missing when the plan does not include squads. */
  squad?: RawSquadMember[];
}

export interface RawTeamsResponse {
  teams: RawTeam[];
}

export interface RawMatch {
  id: number;
  utcDate: string;
  status: string;
  competition: { code: string };
  season: RawSeason;
  homeTeam: RawTeamRef;
  awayTeam: RawTeamRef;
  score: { fullTime: { home: number | null; away: number | null } };
}

export interface RawScorer {
  player: { id: number };
  team: { id: number };
  goals: number | null;
  assists: number | null;
  playedMatches: number | null;
}

export interface RawScorersResponse {
  scorers: RawScorer[];
}

export interface RawMatchesResponse {
  matches: RawMatch[];
}
