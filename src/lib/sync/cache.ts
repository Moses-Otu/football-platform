import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProviderId } from "@/lib/providers/types";

export type Params = Record<string, string | number>;

/** Makes one live call to a provider and returns its parsed JSON body. */
export type Fetcher = (path: string, params: Params) => Promise<unknown>;

/** A cache-first getter that an adapter uses for every provider call. */
export type CachedGet = <T>(path: string, params: Params, ttlSeconds: number) => Promise<T>;

export function cacheKey(provider: string, path: string, params: Params): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return `${provider}:${path}?${sorted}`;
}

/**
 * Returns a getter that reads football.api_cache first and only calls the
 * provider on a miss or an expired entry, then stores the response.
 */
export function createCachedGet(db: SupabaseClient, provider: ProviderId, fetcher: Fetcher): CachedGet {
  const cache = db.schema("football").from("api_cache");

  return async function cachedGet<T>(path: string, params: Params, ttlSeconds: number): Promise<T> {
    const key = cacheKey(provider, path, params);

    const { data: hit, error: readError } = await cache
      .select("response, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (readError) throw readError;
    if (hit && new Date(hit.expires_at) > new Date()) {
      return hit.response as T;
    }

    const body = await fetcher(path, params);
    const now = new Date();
    const { error: writeError } = await cache.upsert({
      cache_key: key,
      response: body,
      fetched_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    });
    if (writeError) throw writeError;
    return body as T;
  };
}
