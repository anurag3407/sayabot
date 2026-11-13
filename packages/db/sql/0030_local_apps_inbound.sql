-- 0030_local_apps_inbound.sql
-- Desktop jobs for password managers and local apps, plus dedup for chat webhooks.
-- Idempotent.

alter table public.mcp_servers
  add column if not exists host_id uuid references public.desktop_hosts(id) on delete set null,
  add column if not exists tool_cache jsonb,
  add column if not exists catalog_app text;

create table if not exists public.desktop_secret_jobs (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.desktop_hosts(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  connector_id uuid not null,
  source text not null,
  action text not null,
  query text not null,
  vault text,
  status text not null default 'queued',
  result_enc text,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint desktop_secret_jobs_status_check check (status in ('queued', 'running', 'done', 'failed')),
  constraint desktop_secret_jobs_action_check check (action in ('search', 'read'))
);
create index if not exists desktop_secret_jobs_host_idx on public.desktop_secret_jobs (host_id, status);

create table if not exists public.desktop_mcp_calls (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.desktop_hosts(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  server_id uuid not null,
  app_id text not null,
  method text not null,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint desktop_mcp_calls_status_check check (status in ('queued', 'running', 'done', 'failed'))
);
create index if not exists desktop_mcp_calls_host_idx on public.desktop_mcp_calls (host_id, status);

create table if not exists public.messaging_inbound (
  connector_id uuid not null references public.workspace_connectors(id) on delete cascade,
  external_id text not null,
  message_id uuid,
  created_at timestamptz not null default now(),
  primary key (connector_id, external_id)
);

alter table public.desktop_secret_jobs enable row level security;
alter table public.desktop_mcp_calls enable row level security;
alter table public.messaging_inbound enable row level security;
revoke all on public.desktop_secret_jobs, public.desktop_mcp_calls, public.messaging_inbound from anon, authenticated, public;
grant all on public.desktop_secret_jobs, public.desktop_mcp_calls, public.messaging_inbound to service_role;
