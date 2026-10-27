import "server-only";

import type { Params } from "@/lib/sync/cache";
import type { QuotaGuard } from "@/lib/sync/quota";

const BASE_URL = "https://api.football-data.org/v4";

/** The free plan allows 10 requests a minute; one every 6.5 s stays under it. */
const MIN_GAP_MS = Number(process.env.FOOTBALL_DATA_MIN_GAP_MS ?? 6500);

export class FootballDataError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "FootballDataError";
  }
}

function token(): string {
  const t = process.env.FOOTBALL_DATA_TOKEN;
  if (!t) throw new FootballDataError("FOOTBALL_DATA_TOKEN is not set");
  return t;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let lastCallAt = 0;

async function waitForSlot(): Promise<void> {
  const wait = lastCallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

/**
 * One call to football-data.org. Spaces calls to respect the per-minute
 * limit, waits out a 429, and explains a 403 (resource not in your plan).
 * Never call this from a request a user triggers: only from sync jobs.
 */
export async function footballDataGet(path: string, params: Params, quota: QuotaGuard): Promise<unknown> {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  for (let attempt = 0; attempt < 3; attempt++) {
    quota.assertCanSpend();
    await waitForSlot();

    const res = await fetch(url, { headers: { "X-Auth-Token": token() }, cache: "no-store" });
    quota.recordRequest(null);

    if (res.status === 429) {
      const reset = Number(res.headers.get("x-requestcounter-reset"));
      await sleep((Number.isFinite(reset) && reset > 0 ? reset : 60) * 1000);
      continue;
    }
    if (res.status >= 500) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (res.status === 403) {
      throw new FootballDataError(`${path} is not included in your football-data.org plan`, 403);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new FootballDataError(`HTTP ${res.status} for ${path}: ${body.slice(0, 200)}`, res.status);
    }
    return res.json();
  }
  throw new FootballDataError(`Gave up on ${path} after 3 attempts`);
}
