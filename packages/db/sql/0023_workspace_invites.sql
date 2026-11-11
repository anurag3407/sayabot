-- 0023_workspace_invites.sql
-- Invite people by email, by a single-use link (24h) or by a permanent link, with a
-- pending list admins can revoke. Idempotent: migrate.ts re-applies every file in sql/.

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null,
  code text unique,
  email text,
  user_id uuid references public.profiles(id) on delete set null,
  role text not null default 'member',
  room_ids uuid[] not null default '{}',
  max_uses integer,
  use_count integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint workspace_invites_kind_check check (kind in ('email', 'link', 'permanent')),
  constraint workspace_invites_role_check check (role in ('member', 'admin')),
  constraint workspace_invites_code_check check (kind = 'email' or code is not null)
);

create index if not exists workspace_invites_org_idx on public.workspace_invites (org_id, kind);

-- Server-only: links are grants, so only server actions (service role) read or write them.
alter table public.workspace_invites enable row level security;
revoke all on public.workspace_invites from anon, authenticated, public;
grant all on public.workspace_invites to service_role;
