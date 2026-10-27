import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { apiFootballGet } from "@/lib/providers/api-football/client";
import { ApiFootballProvider } from "@/lib/providers/api-football";
import { footballDataGet } from "@/lib/providers/football-data/client";
import { FootballDataProvider } from "@/lib/providers/football-data";
import type { FootballProvider, ProviderId } from "@/lib/providers/types";
import { createCachedGet } from "@/lib/sync/cache";
import type { QuotaGuard } from "@/lib/sync/quota";

export function providerIdFromEnv(): ProviderId {
  const id = process.env.FOOTBALL_PROVIDER ?? "football_data";
  if (id !== "football_data" && id !== "api_football") {
    throw new Error(`Unknown FOOTBALL_PROVIDER "${id}"; use football_data or api_football`);
  }
  return id;
}

/** Builds the configured provider with a cache-first getter in front of it. */
export function createProvider(id: ProviderId, db: SupabaseClient, quota: QuotaGuard): FootballProvider {
  switch (id) {
    case "api_football":
      return new ApiFootballProvider(createCachedGet(db, id, (path, params) => apiFootballGet(path, params, quota)));
    case "football_data":
      return new FootballDataProvider(createCachedGet(db, id, (path, params) => footballDataGet(path, params, quota)));
  }
}
