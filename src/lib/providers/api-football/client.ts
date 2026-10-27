import "server-only";

import { QuotaExceededError, type QuotaGuard } from "@/lib/sync/quota";

const BASE_URL = "https://v3.football.api-sports.io";

/** The standard API-Football v3 response envelope. */
export interface ApiFootballEnvelope<T> {
  get: string;
  parameters: Record<string, string>;
  errors: unknown[] | Record<string, string>;
  results: number;
  paging: { current: number; total: number };
  response: T[];
}

export class ApiFootballError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiFootballError";
  }
}

function apiKey(): string {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new ApiFootballError("API_FOOTBALL_KEY is not set");
  return key;
}

function hasErrors(errors: ApiFootballEnvelope<unknown>["errors"]): boolean {
  return Array.isArray(errors) ? errors.length > 0 : Object.keys(errors).length > 0;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One call to API-Football. Checks the quota guard first, records the
 * remaining-requests header afterwards, and retries 429/5xx with backoff.
 * Never call this from a request a user triggers: only from sync jobs.
 */
export async function apiFootballGet<T>(
  path: string,
  params: Record<string, string | number>,
  quota: QuotaGuard,
): Promise<ApiFootballEnvelope<T>> {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  for (let attempt = 0; attempt < 3; attempt++) {
    quota.assertCanSpend();

    const res = await fetch(url, {
      headers: { "x-apisports-key": apiKey() },
      cache: "no-store",
    });
    quota.recordRequest(res.headers.get("x-ratelimit-requests-remaining"));

    if (res.status === 429 || res.status >= 500) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new ApiFootballError(`HTTP ${res.status} for ${path}`, res.status);

    const body = (await res.json()) as ApiFootballEnvelope<T>;
    if (hasErrors(body.errors)) {
      const detail = JSON.stringify(body.errors);
      // API-Football reports a used-up daily quota as an error in the body.
      if (/limit|requests/i.test(detail)) throw new QuotaExceededError(detail);
      throw new ApiFootballError(`API error for ${path}: ${detail}`);
    }
    return body;
  }
  throw new ApiFootballError(`Gave up on ${path} after 3 attempts`);
}
