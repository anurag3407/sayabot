-- Computer placement: one Boat key per workspace, and one Cloud copy of a Mac's bots,
-- chats, routines, and keys. Idempotent.

create table if not exists public.org_computer_settings (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  boat_ciphertext text,
  boat_iv text,
  boat_tag text,
  boat_last4 text,
  vps_ssh_alias text,
  vps_start_automatically boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.org_computer_settings enable row level security;
revoke all on public.org_computer_settings from anon, authenticated, public;
grant all on public.org_computer_settings to service_role;

create table if not exists public.cloud_home_copies (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  org_id uuid references public.orgs(id) on delete set null,
  snapshot jsonb not null,
  copied_at timestamptz not null default now(),
  restored_at timestamptz
);

alter table public.cloud_home_copies enable row level security;
revoke all on public.cloud_home_copies from anon, authenticated, public;
grant all on public.cloud_home_copies to service_role;
