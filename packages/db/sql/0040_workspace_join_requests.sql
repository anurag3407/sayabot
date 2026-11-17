-- 0040_workspace_join_requests.sql
-- Opening an invite link asks to join. A workspace admin approves before the person
-- is a member. Idempotent: migrate.ts re-applies every file in sql/.

create table if not exists public.workspace_join_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  invite_id uuid not null references public.workspace_invites(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  role text not null default 'member',
  room_ids uuid[] not null default '{}',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint workspace_join_requests_status_check check (status in ('pending', 'approved', 'declined')),
  constraint workspace_join_requests_role_check check (role in ('member', 'admin'))
);

create unique index if not exists workspace_join_requests_invite_user_idx
  on public.workspace_join_requests (invite_id, user_id);

create index if not exists workspace_join_requests_org_idx
  on public.workspace_join_requests (org_id, status);

-- Server-only, same as workspace_invites: the link is a grant.
alter table public.workspace_join_requests enable row level security;
revoke all on public.workspace_join_requests from anon, authenticated, public;
grant all on public.workspace_join_requests to service_role;
