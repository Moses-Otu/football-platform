import { runSync, syncConfigFromEnv } from "@/lib/sync/run";

// A cold-cache run writes a few hundred players; allow up to 5 minutes.
export const maxDuration = 300;

/**
 * Called by Vercel Cron, which sends `Authorization: Bearer <CRON_SECRET>`.
 * Anyone without the secret gets 401, so the public cannot spend the quota.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await runSync(syncConfigFromEnv());
  return Response.json(result, { status: result.status === "error" ? 500 : 200 });
}
