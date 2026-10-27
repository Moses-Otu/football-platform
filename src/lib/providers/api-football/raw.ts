// Raw API-Football v3 response shapes: only the fields we read.
// Verify against the live docs; field names (including the API's own
// "appearences" spelling) come from API-Football, not from us.

export interface RawTeam {
  id: number;
  name: string;
  country?: string | null;
  logo?: string | null;
}

export interface RawLeague {
  league: { id: number; name: string; logo?: string | null };
  country?: { name: string } | null;
  seasons: { year: number; current: boolean }[];
}

export interface RawPlayerStatistic {
  team: RawTeam;
  league: { id: number; season: number };
  games: {
    appearences: number | null;
    minutes: number | null;
    position: string | null;
    rating: string | null;
  };
  goals: { total: number | null; assists: number | null };
  shots?: { total: number | null; on: number | null };
  passes?: { total: number | null; key: number | null };
  tackles?: { total: number | null };
  dribbles?: { success: number | null };
  cards?: { yellow: number | null; red: number | null };
}

export interface RawPlayerItem {
  player: {
    id: number;
    name: string;
    firstname: string | null;
    lastname: string | null;
    birth: { date: string | null } | null;
    nationality: string | null;
    photo: string | null;
  };
  statistics: RawPlayerStatistic[];
}

export interface RawFixture {
  fixture: { id: number; date: string; status: { short: string } };
  league: { id: number; season: number };
  teams: { home: RawTeam; away: RawTeam };
  goals: { home: number | null; away: number | null };
}
