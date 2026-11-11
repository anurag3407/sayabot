-- 0024_desktop_hosts.sql
-- Computers running the Sayabot desktop app: remote desktop sessions and the local runner
-- (agents that run on apps signed in on that computer). Idempotent.

create table if not exists public.desktop_hosts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid references public.orgs(id) on delete set null,
  name text not null,
  platform text not null,
  app_version text,
  token_hash text not null,
  permissions jsonb not null default '{}'::jsonb,
  local_agents jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  storage jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists desktop_hosts_user_idx on public.desktop_hosts (user_id);
alter table public.desktop_hosts add column if not exists storage jsonb not null default '{}'::jsonb;

create table if not exists public.remote_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.desktop_hosts(id) on delete cascade,
  viewer_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'requested',
  control boolean not null default false,
  offer text,
  answer text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint remote_sessions_status_check check (status in ('requested', 'answered', 'denied', 'ended', 'failed'))
);
create index if not exists remote_sessions_host_idx on public.remote_sessions (host_id, status);

create table if not exists public.local_runner_jobs (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.desktop_hosts(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  message_id uuid not null,
  reply_message_id uuid,
  status text not null default 'queued',
  prompt text not null,
  output text,
  error text,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint local_runner_jobs_status_check check (status in ('queued', 'running', 'done', 'failed', 'cancelled'))
);
create index if not exists local_runner_jobs_host_idx on public.local_runner_jobs (host_id, status);

-- Server-only: tokens, SDP and prompts are read and written through server routes.
alter table public.desktop_hosts enable row level security;
alter table public.remote_sessions enable row level security;
alter table public.local_runner_jobs enable row level security;
revoke all on public.desktop_hosts, public.remote_sessions, public.local_runner_jobs from anon, authenticated, public;
grant all on public.desktop_hosts, public.remote_sessions, public.local_runner_jobs to service_role;
