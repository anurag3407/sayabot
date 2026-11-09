-- 0018_workspace_connectors.sql
-- Two-Tier Workspace Connectors (Google Drive, Slack, GitHub) & Agent Scoping

-- 1. Create workspace_connectors table
create table if not exists public.workspace_connectors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete set null,
  source text not null, -- 'google_drive', 'slack', 'github', 'jira'
  name text not null,
  status text not null default 'active', -- 'active', 'error', 'syncing', 'disabled'
  auth_type text not null default 'token', -- 'oauth', 'token', 'service_account'
  ciphertext text not null,
  iv text not null,
  tag text not null,
  last4 text not null,
  config jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Indexes
create index if not exists workspace_connectors_org_idx on public.workspace_connectors(org_id);
create index if not exists workspace_connectors_source_idx on public.workspace_connectors(org_id, source);

-- 3. Safe public view without ciphertext
create or replace view public.workspace_connectors_public as
select
  id,
  org_id,
  owner_user_id,
  source,
  name,
  status,
  auth_type,
  last4,
  config,
  last_synced_at,
  error_message,
  created_at,
  updated_at
from public.workspace_connectors
where public.is_org_member(org_id);

-- 4. Agent Connector Grants Table (Tier-2 Granular Scoping)
create table if not exists public.agent_connector_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  connector_id uuid not null references public.workspace_connectors(id) on delete cascade,
  scope_config jsonb not null default '{}'::jsonb, -- e.g. { allowedFolders: [...], allowedChannels: [...] }
  created_at timestamptz not null default now()
);

create index if not exists agent_connector_grants_agent_idx on public.agent_connector_grants(org_id, agent_id);

-- 5. RLS and Grants
alter table public.workspace_connectors enable row level security;
alter table public.agent_connector_grants enable row level security;

revoke all on public.workspace_connectors from anon, authenticated, public;
grant select on public.workspace_connectors_public to authenticated;
grant all on public.workspace_connectors to service_role;

drop policy if exists "agent_connector_grants_policy" on public.agent_connector_grants;
create policy "agent_connector_grants_policy" on public.agent_connector_grants for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

grant select, insert, update, delete on public.agent_connector_grants to authenticated;
grant all on public.agent_connector_grants to service_role;
