-- 0020_bot_invites.sql
-- Approval-gated "Add an agent" links. The link holds no credential: a bot asks to join,
-- a person approves it, and only the bot that asked collects its key, once.
-- Idempotent: migrate.ts re-applies every file in sql/ on each run.

create table if not exists public.bot_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  code text not null unique,
  name text,
  app text,
  status text not null default 'waiting',
  request_name text,
  request_app text,
  request_about text,
  request_user_agent text,
  requested_at timestamptz,
  poll_token_hash text,
  agent_id uuid references public.agents(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  joined_at timestamptz,
  rejected_attempts jsonb not null default '[]'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_invites_status_check
    check (status in ('waiting', 'pending', 'approved', 'joined', 'declined', 'revoked'))
);

create index if not exists bot_invites_room_idx on public.bot_invites (room_id, status);
create index if not exists bot_invites_org_idx on public.bot_invites (org_id, status);

drop trigger if exists bot_invites_set_updated_at on public.bot_invites;
create trigger bot_invites_set_updated_at before update on public.bot_invites
  for each row execute function public.set_updated_at();

-- Server-only: the add-agent dialog and the Inbox read it through server actions, so the
-- poll token hash never reaches a browser.
alter table public.bot_invites enable row level security;
drop policy if exists "bot_invites_select" on public.bot_invites;
revoke all on public.bot_invites from anon, authenticated, public;
grant all on public.bot_invites to service_role;
