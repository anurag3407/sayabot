-- 0014_routines.sql
-- Hermes-class autonomous agent routines and cron scheduling with n8n canvas visual workflow

-- 1. Create Routine Enums
do $$ begin
  create type public.routine_status as enum ('idle', 'running', 'success', 'failed');
exception when duplicate_object then null; end $$;

-- 2. Create Routines Table
create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  agent_id uuid not null references public.agents(id) on delete cascade,
  name text not null,
  description text,
  schedule_expr text not null,
  schedule_kind text not null default 'cron',
  timezone text not null default 'UTC',
  prompt text not null,
  enabled boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status public.routine_status not null default 'idle',
  last_error text,
  run_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_agent_id uuid references public.agents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Create Routine Runs (Execution history for n8n view)
create table if not exists public.routine_runs (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  status public.routine_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  output text,
  error text
);

-- 4. Indexes
create index if not exists routines_org_idx on public.routines (org_id, enabled);
create index if not exists routines_next_run_idx on public.routines (enabled, next_run_at);
create index if not exists routines_agent_idx on public.routines (agent_id);
create index if not exists routines_room_idx on public.routines (room_id);
create index if not exists routine_runs_routine_idx on public.routine_runs (routine_id, started_at desc);
create index if not exists routine_runs_org_idx on public.routine_runs (org_id, started_at desc);

-- 5. Row Level Security
alter table public.routines enable row level security;
alter table public.routine_runs enable row level security;

drop policy if exists "routines_select_policy" on public.routines;
create policy "routines_select_policy"
  on public.routines for select
  using (public.is_org_member(org_id));

drop policy if exists "routines_insert_policy" on public.routines;
create policy "routines_insert_policy"
  on public.routines for insert
  with check (public.is_org_member(org_id));

drop policy if exists "routines_update_policy" on public.routines;
create policy "routines_update_policy"
  on public.routines for update
  using (public.is_org_member(org_id));

drop policy if exists "routines_delete_policy" on public.routines;
create policy "routines_delete_policy"
  on public.routines for delete
  using (public.is_org_member(org_id));

drop policy if exists "routine_runs_select_policy" on public.routine_runs;
create policy "routine_runs_select_policy"
  on public.routine_runs for select
  using (public.is_org_member(org_id));

drop policy if exists "routine_runs_insert_policy" on public.routine_runs;
create policy "routine_runs_insert_policy"
  on public.routine_runs for insert
  with check (public.is_org_member(org_id));
