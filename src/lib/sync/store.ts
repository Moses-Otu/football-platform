import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Fixture, League, PlayerWithSeasons, ProviderId, ScorerStats, Team } from "@/lib/providers/types";

type EntityType = "league" | "season" | "team" | "player" | "fixture";

/**
 * Writes provider-neutral records into the football schema, mapping each
 * provider id to our own UUID through football.external_ids.
 */
export class FootballStore {
  private readonly db;
  private readonly idCache = new Map<string, string>();
  /** Teams already written in this run, so each is saved once. */
  private readonly savedTeams = new Map<string, string>();

  constructor(
    client: SupabaseClient,
    private readonly provider: ProviderId,
  ) {
    this.db = client.schema("football");
  }

  private async findId(type: EntityType, externalId: string): Promise<string | null> {
    const memo = `${type}:${externalId}`;
    const known = this.idCache.get(memo);
    if (known) return known;

    const { data, error } = await this.db
      .from("external_ids")
      .select("entity_id")
      .eq("provider_id", this.provider)
      .eq("entity_type", type)
      .eq("external_id", externalId)
      .maybeSingle();
    if (error) throw error;
    if (data) this.idCache.set(memo, data.entity_id);
    return data?.entity_id ?? null;
  }

  /** Inserts or updates one row and its external-id mapping; returns our UUID. */
  private async save(
    type: EntityType,
    table: string,
    externalId: string,
    row: Record<string, unknown>,
  ): Promise<string> {
    const existing = await this.findId(type, externalId);
    if (existing) {
      const { error } = await this.db.from(table).update(row).eq("id", existing);
      if (error) throw error;
      await this.touchSource(type, existing);
      return existing;
    }

    const { data, error } = await this.db.from(table).insert(row).select("id").single();
    if (error) throw error;
    const id = data.id as string;

    const { error: mapError } = await this.db.from("external_ids").insert({
      entity_type: type,
      entity_id: id,
      provider_id: this.provider,
      external_id: externalId,
    });
    if (mapError) throw mapError;

    this.idCache.set(`${type}:${externalId}`, id);
    await this.touchSource(type, id);
    return id;
  }

  /** Our ids for many provider ids of one type; unknown ones are left out. */
  private async lookupIds(type: EntityType, externalIds: string[]): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (const part of chunk(externalIds, LOOKUP_CHUNK)) {
      const { data, error } = await this.db
        .from("external_ids")
        .select("external_id, entity_id")
        .eq("provider_id", this.provider)
        .eq("entity_type", type)
        .in("external_id", part);
      if (error) throw error;
      for (const r of data) ids.set(r.external_id, r.entity_id);
    }
    return ids;
  }

  /**
   * Bulk version of save for many rows of one type: a handful of queries in
   * total instead of several per row. New rows get ids generated here, so
   * rows, mappings and provenance can be written in batches.
   */
  private async saveMany(
    type: EntityType,
    table: string,
    items: { externalId: string; row: Record<string, unknown> }[],
  ): Promise<Map<string, string>> {
    const ids = await this.lookupIds(
      type,
      items.map((i) => i.externalId),
    );

    const fresh: string[] = [];
    for (const { externalId } of items) {
      if (!ids.has(externalId)) {
        ids.set(externalId, crypto.randomUUID());
        fresh.push(externalId);
      }
    }

    for (const part of chunk(items, WRITE_CHUNK)) {
      const { error } = await this.db
        .from(table)
        .upsert(part.map(({ externalId, row }) => ({ id: ids.get(externalId), ...row })));
      if (error) throw error;
    }

    for (const part of chunk(fresh, WRITE_CHUNK)) {
      const { error } = await this.db.from("external_ids").insert(
        part.map((externalId) => ({
          entity_type: type,
          entity_id: ids.get(externalId),
          provider_id: this.provider,
          external_id: externalId,
        })),
      );
      if (error) throw error;
    }

    const fetchedAt = new Date().toISOString();
    for (const part of chunk([...new Set(items.map((i) => ids.get(i.externalId)!))], WRITE_CHUNK)) {
      const { error } = await this.db.from("source_records").upsert(
        part.map((id) => ({ entity_type: type, entity_id: id, provider_id: this.provider, fetched_at: fetchedAt })),
      );
      if (error) throw error;
    }

    for (const [externalId, id] of ids) this.idCache.set(`${type}:${externalId}`, id);
    return ids;
  }

  private async touchSource(type: EntityType, id: string): Promise<void> {
    const { error } = await this.db.from("source_records").upsert({
      entity_type: type,
      entity_id: id,
      provider_id: this.provider,
      fetched_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async saveLeague(league: League, seasonYear: number): Promise<{ leagueId: string; seasonId: string }> {
    const leagueId = await this.save("league", "leagues", league.externalId, {
      name: league.name,
      country: league.country,
      logo_url: league.logoUrl,
    });
    const isCurrent = league.seasons.find((s) => s.year === seasonYear)?.isCurrent ?? false;
    const seasonId = await this.save("season", "seasons", `${league.externalId}:${seasonYear}`, {
      league_id: leagueId,
      year: seasonYear,
      is_current: isCurrent,
    });
    return { leagueId, seasonId };
  }

  async saveTeam(team: Team): Promise<string> {
    const done = this.savedTeams.get(team.externalId);
    if (done) return done;

    // Match and player responses carry a thinner team record than the teams
    // call, so leave out empty fields rather than overwrite good values.
    const row = Object.fromEntries(
      Object.entries({ name: team.name, country: team.country, logo_url: team.logoUrl }).filter(
        ([, v]) => v !== null,
      ),
    );
    const id = await this.save("team", "teams", team.externalId, row);
    this.savedTeams.set(team.externalId, id);
    return id;
  }

  /** Saves a page of players and their season rows in a few batched queries. */
  async savePlayers(
    items: PlayerWithSeasons[],
    seasonIdFor: (leagueExternalId: string, season: number) => string | null,
  ): Promise<void> {
    const prepared = [];
    for (const item of items) {
      const seasons = [];
      let currentTeamId: string | null = null;
      for (const s of item.seasons) {
        const seasonId = seasonIdFor(s.leagueExternalId, s.season);
        if (!seasonId) continue; // a league we don't sync
        const teamId = await this.saveTeam(s.team); // once per team per run
        currentTeamId ??= teamId;
        seasons.push({ seasonId, teamId, s });
      }
      prepared.push({ item, seasons, currentTeamId });
    }

    const ids = await this.saveMany(
      "player",
      "players",
      prepared.map(({ item: { player: p }, currentTeamId }) => ({
        externalId: p.externalId,
        row: {
          full_name: p.fullName,
          display_name: p.displayName,
          birth_date: p.birthDate,
          nationality: p.nationality,
          position: p.position,
          photo_url: p.photoUrl,
          current_team_id: currentTeamId,
        },
      })),
    );

    const seasonRows = prepared.flatMap(({ item, seasons }) =>
      seasons.map(({ seasonId, teamId, s }) => ({
        player_id: ids.get(item.player.externalId),
        season_id: seasonId,
        team_id: teamId,
        appearances: s.appearances,
        minutes: s.minutes,
        goals: s.goals,
        assists: s.assists,
        stats: s.extra,
      })),
    );
    for (const part of chunk(seasonRows, WRITE_CHUNK)) {
      const { error } = await this.db.from("player_seasons").upsert(part);
      if (error) throw error;
    }
  }

  /**
   * Adds goals, assists and appearances from a top-scorers list to the
   * season rows of players we already have. Players not in a synced squad
   * are skipped; we never create a player from a scorers entry alone.
   */
  async saveScorerStats(stats: ScorerStats[], seasonId: string): Promise<number> {
    const players = await this.lookupIds(
      "player",
      stats.map((s) => s.playerExternalId),
    );
    const teams = await this.lookupIds(
      "team",
      stats.map((s) => s.teamExternalId),
    );

    const rows = stats.flatMap((s) => {
      const playerId = players.get(s.playerExternalId);
      const teamId = teams.get(s.teamExternalId);
      if (!playerId || !teamId) return [];
      // Only these columns are sent, so the upsert leaves the others alone.
      return [
        {
          player_id: playerId,
          season_id: seasonId,
          team_id: teamId,
          goals: s.goals,
          assists: s.assists,
          appearances: s.appearances,
        },
      ];
    });

    for (const part of chunk(rows, WRITE_CHUNK)) {
      const { error } = await this.db.from("player_seasons").upsert(part);
      if (error) throw error;
    }
    return rows.length;
  }

  /** Saves fixtures in a few batched queries. */
  async saveFixtures(fixtures: Fixture[], seasonId: string): Promise<void> {
    const items = [];
    for (const f of fixtures) {
      const homeId = await this.saveTeam(f.home);
      const awayId = await this.saveTeam(f.away);
      items.push({
        externalId: f.externalId,
        row: {
          season_id: seasonId,
          home_team_id: homeId,
          away_team_id: awayId,
          kickoff_at: f.kickoffAt,
          status: f.status,
          home_goals: f.homeGoals,
          away_goals: f.awayGoals,
        },
      });
    }
    await this.saveMany("fixture", "fixtures", items);
  }
}

/** Ids per external_ids lookup; keeps the request URL short. */
const LOOKUP_CHUNK = 150;
/** Rows per bulk write. */
const WRITE_CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
