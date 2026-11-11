-- 0019_owner_facts.sql
-- Owner facts: what people have already told their bots, so bots stop asking twice.
-- Idempotent: migrate.ts re-applies every file in sql/ on each run.

create table if not exists public.owner_facts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete cascade, -- null = every room in the workspace
  key text not null,
  label text not null,
  value text not null,
  source text not null default 'answer', -- 'answer' | 'manual' | 'agent'
  source_task_id uuid references public.tasks(id) on delete set null,
  source_agent_id uuid references public.agents(id) on delete set null,
  note text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_facts_key_format check (key ~ '^[a-z0-9_]{1,48}$'),
  constraint owner_facts_value_length check (char_length(value) between 1 and 1000),
  constraint owner_facts_source_check check (source in ('answer', 'manual', 'agent'))
);

create unique index if not exists owner_facts_scope_key_idx
  on public.owner_facts (org_id, coalesce(room_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
create index if not exists owner_facts_org_idx on public.owner_facts (org_id);

drop trigger if exists owner_facts_set_updated_at on public.owner_facts;
create trigger owner_facts_set_updated_at before update on public.owner_facts
  for each row execute function public.set_updated_at();

-- Reads: workspace-wide facts to org members, room facts to people who can read the room.
-- Writes go through the server (service role) so every change is audited.
alter table public.owner_facts enable row level security;

drop policy if exists "owner_facts_select" on public.owner_facts;
create policy "owner_facts_select" on public.owner_facts for select
  using (
    (room_id is null and public.is_org_member(org_id))
    or (room_id is not null and public.can_read_room(room_id))
  );

revoke all on public.owner_facts from anon, public;
revoke insert, update, delete on public.owner_facts from authenticated;
grant select on public.owner_facts to authenticated;
grant all on public.owner_facts to service_role;
