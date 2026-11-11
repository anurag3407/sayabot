-- 0021_device_pairings.sql
-- "Add a phone": one-time codes that sign a phone in from a computer, and the list of
-- paired phones (revocable). Idempotent: migrate.ts re-applies every file in sql/.

create table if not exists public.device_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid references public.orgs(id) on delete cascade,
  code_hash text not null unique,
  status text not null default 'waiting',
  device_name text,
  platform text,
  device_token_hash text,
  paired_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint device_pairings_status_check check (status in ('waiting', 'paired', 'revoked'))
);

create index if not exists device_pairings_user_idx on public.device_pairings (user_id, status);

-- Server-only: codes and device tokens are hashes, but nothing here needs a browser read.
alter table public.device_pairings enable row level security;
revoke all on public.device_pairings from anon, authenticated, public;
grant all on public.device_pairings to service_role;
