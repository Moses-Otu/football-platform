# Football Platform

Daily football puzzles, player discovery and friend challenges. Built with Next.js, TypeScript, Tailwind CSS, shadcn/ui and Supabase, deployed on Vercel. Football data comes from a provider layer with two adapters: football-data.org (the default) and API-Football.

This is the free-tier setup: football-data.org free plan, Supabase Free and Vercel Hobby. It syncs one league (Premier League) by default.

## How data flows

Users never call a football API. A daily cron job (`/api/cron/sync`) fetches leagues, teams, fixtures and players, stores raw responses in `football.api_cache`, and writes clean rows into the `football` schema. Pages read Postgres only.

- `src/lib/providers/types.ts`: provider-neutral types and the `FootballProvider` interface
- `src/lib/providers/football-data/`: the football-data.org client and adapter
- `src/lib/providers/api-football/`: the API-Football client and adapter
- `src/lib/providers/index.ts`: picks the adapter from `FOOTBALL_PROVIDER`
- `src/lib/sync/`: cache, quota guard, database writes and the sync run
- `supabase/migrations/`: database schema and row-level security

## Providers

| | football-data.org (free) | API-Football (free) |
| --- | --- | --- |
| Limit | 10 requests a minute | 100 requests a day |
| Leagues | 12 competitions | All, with season limits |
| Fixtures, results, tables | Yes (scores delayed) | Yes |
| Squads (players, birth date, nationality, position) | Listed as paid-only; the adapter uses them if returned | Yes |
| Player season stats | No | Yes |

A football-data.org sync needs 3 requests per league and spaces them 6.5 seconds apart to stay under the per-minute limit. If your plan returns no squads, the sync stores teams and fixtures only, and the player count on the home page stays at 0.

## Setup

You need accounts on [football-data.org](https://www.football-data.org/client/register), [Supabase](https://supabase.com) and [Vercel](https://vercel.com).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the values.

3. Create the database. In a new Supabase project, link and push the migrations:

   ```bash
   npx supabase init
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

4. In Supabase, go to Project Settings > Data API and add `football` to **Exposed schemas**. Without this, the app cannot read football data.

5. Run the app:

   ```bash
   npm run dev
   ```

6. Run one sync by hand (replace the secret with your `CRON_SECRET`):

   ```bash
   curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/sync
   ```

   The response shows requests used and how many teams, fixtures and players were stored.

## Deploy

Import the repo in Vercel and add the same environment variables. `vercel.json` schedules the sync daily at 04:00 UTC; Hobby allows one cron run a day.

Before a public launch, move to paid tiers: Vercel Hobby is for non-commercial use only, and Supabase Free pauses a project after a week without activity.

## Rules

- Never invent player facts, fixtures, results or stats. Missing provider values stay null and show as "not available".
- API keys stay server-side. Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` reach the browser.
- No scraping of publishers without permission.
