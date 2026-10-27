-- Initial schema: provider-neutral football data + user/game data.
-- Football tables are written only by the sync job (service role).

create extension if not exists pgcrypto;

create schema if not exists football;

-- ---------------------------------------------------------------------------
-- Football data
-- ---------------------------------------------------------------------------

create table football.providers (
  id   text primary key,           -- e.g. 'api_football'
  name text not null
);

insert into football.providers (id, name) values ('api_football', 'API-Football');

create table football.leagues (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  country  text,
  logo_url text
);

create table football.seasons (
  id         uuid primary key default gen_random_uuid(),
  league_id  uuid not null references football.leagues (id) on delete cascade,
  year       int  not null,
  is_current boolean not null default false,
  unique (league_id, year)
);

create table football.teams (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  country  text,
  logo_url text
);

create table football.players (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  display_name    text not null,
  birth_date      date,             -- age is computed, never stored
  nationality     text,
  position        text,
  photo_url       text,
  current_team_id uuid references football.teams (id) on delete set null
);

create index players_display_name_idx on football.players using gin (to_tsvector('simple', display_name));

-- One row per player, team and season. Career history = these rows.
create table football.player_seasons (
  player_id   uuid not null references football.players (id) on delete cascade,
  season_id   uuid not null references football.seasons (id) on delete cascade,
  team_id     uuid not null references football.teams (id) on delete cascade,
  appearances int,
  minutes     int,
  goals       int,
  assists     int,
  stats       jsonb not null default '{}'::jsonb,   -- other provider stats, null-safe
  primary key (player_id, season_id, team_id)
);

create table football.fixtures (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references football.seasons (id) on delete cascade,
  home_team_id  uuid not null references football.teams (id),
  away_team_id  uuid not null references football.teams (id),
  kickoff_at    timestamptz not null,
  status        text not null,      -- provider status mapped to: scheduled | live | finished | postponed | cancelled
  home_goals    int,
  away_goals    int
);

create index fixtures_kickoff_idx on football.fixtures (kickoff_at);

-- Maps our ids to each provider's ids, so a second provider can be added.
create table football.external_ids (
  entity_type text not null,        -- league | team | player | fixture | season
  entity_id   uuid not null,
  provider_id text not null references football.providers (id),
  external_id text not null,
  primary key (provider_id, entity_type, external_id)
);

create index external_ids_entity_idx on football.external_ids (entity_type, entity_id);

-- Provenance shown next to every fact.
create table football.source_records (
  entity_type  text not null,
  entity_id    uuid not null,
  provider_id  text not null references football.providers (id),
  fetched_at   timestamptz not null default now(),
  payload_hash text,
  primary key (entity_type, entity_id, provider_id)
);

-- Raw provider responses, so a re-parse costs no API call.
create table football.api_cache (
  cache_key  text primary key,      -- provider + endpoint + sorted params
  response   jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table football.sync_runs (
  id                 uuid primary key default gen_random_uuid(),
  job                text not null,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  requests_used      int not null default 0,
  requests_remaining int,           -- from the provider's quota headers
  status             text not null default 'running',  -- running | ok | stopped_quota | error
  error              text
);

-- ---------------------------------------------------------------------------
-- User and game data
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Answer is never exposed to clients: no select policy for anon/authenticated.
create table public.daily_puzzles (
  date       date primary key,
  player_id  uuid not null references football.players (id),
  created_at timestamptz not null default now()
);

create table public.challenges (
  id         uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  player_id  uuid not null references football.players (id),   -- hidden from clients
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);

create table public.footle_games (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users (id) on delete cascade,
  guest_id     uuid,
  puzzle_date  date references public.daily_puzzles (date),
  challenge_id uuid references public.challenges (id) on delete cascade,
  guesses      uuid[] not null default '{}',
  solved       boolean not null default false,
  guess_count  int not null default 0,
  duration_ms  int,
  created_at   timestamptz not null default now(),
  check (user_id is not null or guest_id is not null),
  check ((puzzle_date is null) <> (challenge_id is null))
);

create unique index footle_games_user_puzzle on public.footle_games (user_id, puzzle_date) where user_id is not null and puzzle_date is not null;
create unique index footle_games_user_challenge on public.footle_games (user_id, challenge_id) where user_id is not null and challenge_id is not null;

create table public.challenge_entries (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  game_id      uuid not null references public.footle_games (id) on delete cascade,
  primary key (challenge_id, user_id)
);

create table public.predictions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  fixture_id uuid not null references football.fixtures (id) on delete cascade,
  home_goals int not null check (home_goals between 0 and 20),
  away_goals int not null check (away_goals between 0 and 20),
  points     int,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, fixture_id)
);

create table public.user_stats (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  current_streak int not null default 0,
  best_streak    int not null default 0,
  total_points   int not null default 0,
  games_played   int not null default 0
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Football data: anyone can read; only the service role writes (it bypasses RLS).
-- A custom schema gets no default grants, so give them explicitly.
grant usage on schema football to anon, authenticated, service_role;
grant all on all tables in schema football to service_role;

do $$
declare t text;
begin
  foreach t in array array['leagues','seasons','teams','players','player_seasons','fixtures','source_records']
  loop
    execute format('alter table football.%I enable row level security', t);
    execute format('grant select on football.%I to anon, authenticated', t);
    execute format('create policy "public read" on football.%I for select using (true)', t);
  end loop;
end $$;

-- Internal tables: RLS on, no policies, no grants -> service role only.
alter table football.providers    enable row level security;
alter table football.external_ids enable row level security;
alter table football.api_cache    enable row level security;
alter table football.sync_runs    enable row level security;

alter table public.profiles          enable row level security;
alter table public.daily_puzzles     enable row level security;
alter table public.challenges        enable row level security;
alter table public.footle_games      enable row level security;
alter table public.challenge_entries enable row level security;
alter table public.predictions       enable row level security;
alter table public.user_stats        enable row level security;

create policy "profiles are public" on public.profiles for select using (true);
create policy "own profile insert" on public.profiles for insert with check ((select auth.uid()) = id);
create policy "own profile update" on public.profiles for update using ((select auth.uid()) = id);

create policy "stats are public" on public.user_stats for select using (true);

-- Games and predictions: owners read their own. All writes go through server
-- actions using the service role, which enforce game rules (e.g. kick-off lock).
create policy "own games" on public.footle_games for select using ((select auth.uid()) = user_id);
create policy "own predictions" on public.predictions for select using ((select auth.uid()) = user_id);
create policy "own challenge entries" on public.challenge_entries for select using ((select auth.uid()) = user_id);

-- Challenges and daily_puzzles: no client policies, so player_id never leaks.
