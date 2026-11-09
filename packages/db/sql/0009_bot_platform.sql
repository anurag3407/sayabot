-- 0009_bot_platform.sql
-- Sayabot Bot Platform: Capabilities, Templates, Secret Broker, Bot Computers, Task Hierarchies, and MCP OAuth

-- 1. Enums
do $$ begin
  create type public.vault_secret_kind as enum ('api_token', 'basic_auth', 'password', 'header_set', 'github_app');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.secret_inject as enum ('header', 'basic', 'query', 'body');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.computer_status as enum ('none', 'stopped', 'starting', 'running', 'stopping', 'error', 'over_quota');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.computer_profile as enum ('standard', 'browser');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.agent_visibility as enum ('private', 'org');
exception when duplicate_object then null; end $$;

-- 2. Agent Templates Table
create table if not exists public.agent_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  icon text,
  category text not null default 'general',
  system_prompt text not null default '',
  default_provider public.provider,
  default_model text,
  params jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{"canvas":true,"tasks":true,"sandbox":true,"webSearch":true,"github":true,"postgres":true,"mcp":true,"computer":false,"secrets":false}'::jsonb,
  secret_slots jsonb not null default '[]'::jsonb,
  starter_tasks jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_templates_org_slug_idx
  on public.agent_templates (org_id, slug) nulls not distinct;
create index if not exists agent_templates_org_idx on public.agent_templates (org_id);

alter table public.agent_templates enable row level security;

drop policy if exists "agent_templates_read" on public.agent_templates;
create policy "agent_templates_read" on public.agent_templates
  for select using (
    org_id is null or public.is_org_member(org_id)
  );

drop policy if exists "agent_templates_write" on public.agent_templates;
create policy "agent_templates_write" on public.agent_templates
  for all using (
    org_id is not null and public.is_org_admin(org_id)
  );

-- 3. Extend agents table
alter table public.agents
  add column if not exists template_id uuid references public.agent_templates(id) on delete set null,
  add column if not exists owner_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists visibility public.agent_visibility not null default 'org',
  add column if not exists avatar text,
  add column if not exists bio text,
  add column if not exists capabilities jsonb not null default '{"canvas":true,"tasks":true,"sandbox":true,"webSearch":true,"github":true,"postgres":true,"mcp":true,"computer":false,"secrets":false}'::jsonb;

-- 4. Extend agent_api_keys table
alter table public.agent_api_keys
  add column if not exists room_ids uuid[],
  add column if not exists oauth_client_id uuid,
  add column if not exists expires_at timestamptz;

-- 5. Extend tasks table for leads, hierarchies, and budgets
alter table public.tasks
  add column if not exists lead_agent_id uuid references public.agents(id) on delete set null,
  add column if not exists parent_task_id uuid references public.tasks(id) on delete cascade,
  add column if not exists budget_turns integer,
  add column if not exists budget_usd numeric(10, 4),
  add column if not exists turns_used integer not null default 0,
  add column if not exists cost_usd numeric(10, 4) not null default 0;

create index if not exists tasks_lead_agent_idx on public.tasks (lead_agent_id);
create index if not exists tasks_parent_task_idx on public.tasks (parent_task_id);

-- 6. Extend turn_sessions for task-driven sessions
alter table public.turn_sessions
  add column if not exists task_id uuid references public.tasks(id) on delete set null;

create index if not exists turn_sessions_task_idx on public.turn_sessions (task_id);

-- 7. Secret Broker: vault_secrets, agent_secret_grants, org_quotas
create table if not exists public.vault_secrets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete set null,
  label text not null,
  kind public.vault_secret_kind not null,
  sealed text not null,
  last4 text not null,
  last_used_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists vault_secrets_org_idx on public.vault_secrets (org_id);

-- Lock down vault_secrets direct access
alter table public.vault_secrets enable row level security;
revoke all on public.vault_secrets from authenticated, anon;

-- Public view for vault secrets (safe columns only)
create or replace view public.vault_secrets_public with (security_invoker = true) as
  select id, org_id, owner_user_id, label, kind, last4, last_used_at, rotated_at, created_at
  from public.vault_secrets;

grant select on public.vault_secrets_public to authenticated;

create table if not exists public.agent_secret_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  secret_id uuid not null references public.vault_secrets(id) on delete cascade,
  env_name text not null,
  placeholder text not null unique,
  allowed_hosts text[] not null,
  inject jsonb not null default '{"mode":"header"}'::jsonb,
  methods text[],
  requires_approval boolean not null default false,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create unique index if not exists agent_secret_grants_agent_env_idx on public.agent_secret_grants (agent_id, env_name);
create index if not exists agent_secret_grants_agent_idx on public.agent_secret_grants (agent_id);
create index if not exists agent_secret_grants_secret_idx on public.agent_secret_grants (secret_id);
create index if not exists agent_secret_grants_placeholder_idx on public.agent_secret_grants (placeholder);

alter table public.agent_secret_grants enable row level security;
revoke all on public.agent_secret_grants from authenticated, anon;

-- Public view for grants (placeholder masked)
create or replace view public.agent_secret_grants_public with (security_invoker = true) as
  select id, org_id, agent_id, secret_id, env_name, allowed_hosts, inject, methods, requires_approval, expires_at, revoked_at, last_used_at, created_at, created_by
  from public.agent_secret_grants;

grant select on public.agent_secret_grants_public to authenticated;

-- Org Quotas table
create table if not exists public.org_quotas (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  max_agents integer not null default 25,
  max_computers integer not null default 5,
  max_running_computers integer not null default 2,
  max_disk_mb_total integer not null default 20480,
  max_secrets integer not null default 50,
  egress_mode text not null default 'open',
  egress_allowlist text[] not null default '{}'::text[]
);

alter table public.org_quotas enable row level security;
drop policy if exists "org_quotas_read" on public.org_quotas;
create policy "org_quotas_read" on public.org_quotas
  for select using (public.is_org_member(org_id));

-- 8. Bot Computers Table
create table if not exists public.agent_computers (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  profile public.computer_profile not null default 'standard',
  status public.computer_status not null default 'none',
  container_id text,
  container_ip text,
  volume text not null,
  proxy_secret_hash text,
  cpu_millis integer not null default 1000,
  mem_mb integer not null default 1024,
  disk_mb integer not null default 5120,
  disk_used_mb integer not null default 0,
  last_active_at timestamptz,
  started_at timestamptz,
  created_at timestamptz not null default now(),
  error text
);

create index if not exists agent_computers_org_status_idx on public.agent_computers (org_id, status);
create index if not exists agent_computers_idle_sweeper_idx on public.agent_computers (status, last_active_at);

alter table public.agent_computers enable row level security;
drop policy if exists "agent_computers_read" on public.agent_computers;
create policy "agent_computers_read" on public.agent_computers
  for select using (public.is_org_member(org_id));

-- 9. Room Invites & OAuth 2.1
create table if not exists public.room_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  code_hash text not null unique,
  client text not null,
  handle_hint text,
  display_name_hint text,
  scopes text[] not null default array['messages:write','tasks:write','votes:write','profile:write','canvas:read','activity:wait'],
  created_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  claimed_agent_id uuid references public.agents(id) on delete set null,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists room_invites_room_expires_idx on public.room_invites (room_id, expires_at);
create index if not exists room_invites_code_hash_idx on public.room_invites (code_hash);

alter table public.room_invites enable row level security;
drop policy if exists "room_invites_read" on public.room_invites;
create policy "room_invites_read" on public.room_invites
  for select using (public.is_room_member(room_id));

create table if not exists public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_name text not null,
  redirect_uris text[] not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists oauth_clients_client_id_idx on public.oauth_clients (client_id);
alter table public.oauth_clients enable row level security;
revoke all on public.oauth_clients from authenticated, anon;

create table if not exists public.oauth_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  client_id text not null,
  invite_id uuid references public.room_invites(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  code_challenge text not null,
  redirect_uri text not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists oauth_codes_code_hash_idx on public.oauth_codes (code_hash);
alter table public.oauth_codes enable row level security;
revoke all on public.oauth_codes from authenticated, anon;

create table if not exists public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('access', 'refresh')),
  token_hash text not null unique,
  client_id text not null,
  agent_id uuid references public.agents(id) on delete cascade,
  room_ids uuid[],
  scopes text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  rotated_from uuid,
  created_at timestamptz not null default now()
);

create index if not exists oauth_tokens_token_hash_idx on public.oauth_tokens (token_hash);
alter table public.oauth_tokens enable row level security;
revoke all on public.oauth_tokens from authenticated, anon;

-- 10. Triggers for NOTIFY vault_changed
create or replace function public.notify_vault_changed()
returns trigger as $$
declare
  payload json;
begin
  if tg_table_name = 'agent_secret_grants' then
    payload := json_build_object(
      'agentId', coalesce(new.agent_id, old.agent_id),
      'secretId', coalesce(new.secret_id, old.secret_id)
    );
  else
    payload := json_build_object(
      'secretId', coalesce(new.id, old.id)
    );
  end if;
  perform pg_notify('vault_changed', payload::text);
  return coalesce(new, old);
end;
$$ language plpgsql security definer;

drop trigger if exists tr_agent_secret_grants_vault_changed on public.agent_secret_grants;
create trigger tr_agent_secret_grants_vault_changed
  after insert or update or delete on public.agent_secret_grants
  for each row execute function public.notify_vault_changed();

drop trigger if exists tr_vault_secrets_vault_changed on public.vault_secrets;
create trigger tr_vault_secrets_vault_changed
  after insert or update or delete on public.vault_secrets
  for each row execute function public.notify_vault_changed();
