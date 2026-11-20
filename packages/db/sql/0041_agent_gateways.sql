-- Agent gateways: one external bot account (Telegram, Discord) per agent.
-- The token is sealed by the application (AES-256-GCM, MESH_KEK); the fingerprint is a SHA-256
-- hex digest used only to enforce "one bot identity, one agent".

create table if not exists agent_gateways (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  source text not null,
  name text not null,
  status text not null default 'active',
  ciphertext text not null,
  iv text not null,
  tag text not null,
  last4 text not null,
  token_fingerprint text not null,
  webhook_secret_enc text,
  config jsonb not null default '{}'::jsonb,
  last_error text,
  last_seen_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agent_gateways_agent_source_idx
  on agent_gateways (agent_id, source);
create unique index if not exists agent_gateways_token_idx
  on agent_gateways (token_fingerprint);
create index if not exists agent_gateways_org_idx
  on agent_gateways (org_id, source);

create table if not exists gateway_inbound (
  gateway_id uuid not null references agent_gateways (id) on delete cascade,
  external_id text not null,
  message_id uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists gateway_inbound_pk
  on gateway_inbound (gateway_id, external_id);

create table if not exists external_chats (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  gateway_id uuid not null references agent_gateways (id) on delete cascade,
  external_chat_id text not null,
  chat_type text not null default 'dm',
  room_id uuid not null references rooms (id) on delete cascade,
  title text,
  model_override jsonb,
  system_prompt text,
  allowed_user_ids text[] not null default '{}',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists external_chats_gateway_chat_idx
  on external_chats (gateway_id, external_chat_id);
create unique index if not exists external_chats_room_idx
  on external_chats (room_id);
create index if not exists external_chats_org_idx
  on external_chats (org_id);

alter table agent_gateways enable row level security;
alter table external_chats enable row level security;
alter table gateway_inbound enable row level security;

drop policy if exists "agent_gateways_org" on agent_gateways;
create policy "agent_gateways_org" on agent_gateways
  for all
  using (org_id in (select org_id from org_members where user_id = auth.uid()))
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));

drop policy if exists "external_chats_org" on external_chats;
create policy "external_chats_org" on external_chats
  for all
  using (org_id in (select org_id from org_members where user_id = auth.uid()))
  with check (org_id in (select org_id from org_members where user_id = auth.uid()));

-- The dedup ledger is written by the orchestrator only (service role); members may read it.
drop policy if exists "gateway_inbound_read" on gateway_inbound;
create policy "gateway_inbound_read" on gateway_inbound
  for select
  using (
    exists (
      select 1
      from agent_gateways g
      where g.id = gateway_inbound.gateway_id
        and g.org_id in (select org_id from org_members where user_id = auth.uid())
    )
  );
