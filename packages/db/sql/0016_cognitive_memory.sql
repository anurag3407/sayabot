-- 0016_cognitive_memory.sql
-- GBrain-grade cognitive memory layer for multi-agent systems
-- Adds epistemic beliefs, open loops, knowledge graph links, and multi-source isolation.

-- 1. Create New Enums
do $$ begin
  create type public.epistemic_status as enum ('hypothesis', 'belief', 'verified', 'withdrawn', 'superseded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.open_loop_status as enum ('open', 'in_progress', 'blocked', 'resolved', 'dropped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.memory_link_type as enum ('relates_to', 'depends_on', 'caused_by', 'contradicts', 'supersedes', 'supports');
exception when duplicate_object then null; end $$;

-- 2. Enhance existing public.memories table
alter table public.memories
  add column if not exists perspective text not null default 'first_person',
  add column if not exists emotional_salience numeric(3,2) not null default 0.50,
  add column if not exists epistemic_status public.epistemic_status not null default 'belief',
  add column if not exists evidence_refs text[] not null default '{}',
  add column if not exists target_agent_id uuid references public.agents(id) on delete set null,
  add column if not exists decay_half_life_days integer not null default 30,
  add column if not exists withdrawal_reason text;

create index if not exists memories_epistemic_idx on public.memories (org_id, epistemic_status);
create index if not exists memories_salience_idx on public.memories (org_id, emotional_salience desc);
create index if not exists memories_target_agent_idx on public.memories (org_id, target_agent_id);

-- 3. Create memory_sources table (Multi-tenancy & federated visibility)
create table if not exists public.memory_sources (
  id text primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  federated boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists memory_sources_org_idx on public.memory_sources (org_id, federated);

-- 4. Create open_loops table (Actionable commitments & promises across turns)
create table if not exists public.open_loops (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade,
  description text not null,
  status public.open_loop_status not null default 'open',
  due_at timestamptz,
  blocker_reason text,
  resolution text,
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists open_loops_agent_status_idx on public.open_loops (org_id, agent_id, status);
create index if not exists open_loops_room_idx on public.open_loops (org_id, room_id);

-- 5. Create memory_links table (Knowledge graph & entity relationships)
create table if not exists public.memory_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  source_memory_id uuid not null references public.memories(id) on delete cascade,
  target_memory_id uuid references public.memories(id) on delete cascade,
  target_slug text,
  relationship public.memory_link_type not null default 'relates_to',
  weight numeric(3,2) not null default 1.0,
  created_at timestamptz not null default now()
);

create index if not exists memory_links_source_idx on public.memory_links (org_id, source_memory_id);
create index if not exists memory_links_target_idx on public.memory_links (org_id, target_memory_id);
create index if not exists memory_links_slug_idx on public.memory_links (org_id, target_slug);

-- 6. Row Level Security
alter table public.memory_sources enable row level security;
alter table public.open_loops enable row level security;
alter table public.memory_links enable row level security;

-- memory_sources policies
drop policy if exists "memory_sources_select_policy" on public.memory_sources;
create policy "memory_sources_select_policy" on public.memory_sources for select
  using (public.is_org_member(org_id));

drop policy if exists "memory_sources_modify_policy" on public.memory_sources;
create policy "memory_sources_modify_policy" on public.memory_sources for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- open_loops policies
drop policy if exists "open_loops_select_policy" on public.open_loops;
create policy "open_loops_select_policy" on public.open_loops for select
  using (public.is_org_member(org_id) and (room_id is null or public.can_read_room(room_id)));

drop policy if exists "open_loops_modify_policy" on public.open_loops;
create policy "open_loops_modify_policy" on public.open_loops for all
  using (public.is_org_member(org_id) and (room_id is null or public.can_read_room(room_id)))
  with check (public.is_org_member(org_id) and (room_id is null or public.can_read_room(room_id)));

-- memory_links policies
drop policy if exists "memory_links_select_policy" on public.memory_links;
create policy "memory_links_select_policy" on public.memory_links for select
  using (public.is_org_member(org_id));

drop policy if exists "memory_links_modify_policy" on public.memory_links;
create policy "memory_links_modify_policy" on public.memory_links for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- 7. Grants
grant select, insert, update, delete on public.memory_sources to authenticated;
grant all on public.memory_sources to service_role;
grant select, insert, update, delete on public.open_loops to authenticated;
grant all on public.open_loops to service_role;
grant select, insert, update, delete on public.memory_links to authenticated;
grant all on public.memory_links to service_role;
