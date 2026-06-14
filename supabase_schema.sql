-- ───────────────────────────────────────────────────────────
-- Run this in Supabase → SQL Editor → New query → Run
-- Safe to re-run. Sets up tables + login-based security.
--
-- NOTE: This DROPS and recreates the two tables, clearing any old
-- data. That's intended — we start fresh per account. If you ever
-- want to KEEP existing data, comment out the two drop lines below.
-- ───────────────────────────────────────────────────────────

drop table if exists chat_sessions;
drop table if exists profiles;

-- Per-user progress: streak, learned words, saved settings/keys,
-- mistakes log, and the set of dates the user was active (for the calendar).
create table profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  learned      jsonb default '[]'::jsonb,   -- [[jp,romaji,en], ...]
  streak       int   default 0,
  last_active  date,
  active_days  jsonb default '[]'::jsonb,   -- ["2026-06-14", ...]
  mistakes     jsonb default '[]'::jsonb,   -- [{original,fixed,romaji,note,at}, ...]
  settings     jsonb default '{}'::jsonb,
  updated_at   timestamptz default now()
);

create table chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text,                          -- optional custom name
  scenario    text default 'free',
  messages    jsonb default '[]'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index chat_sessions_user_idx on chat_sessions (user_id, updated_at desc);

-- ── Row Level Security: each person can only touch their own rows ──
alter table profiles      enable row level security;
alter table chat_sessions enable row level security;

create policy "own profile" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own sessions" on chat_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
