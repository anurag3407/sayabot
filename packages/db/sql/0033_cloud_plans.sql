-- 0033_cloud_plans.sql
-- Sayabot Cloud (SAYABOT_EDITION=cloud): each workspace's plan and what it used this month.
-- Self-hosted servers create the tables but never fill them; nothing reads them there.
-- Idempotent.

create table if not exists public.org_plans (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  plan text not null default 'free',
  -- Payment provider's subscription status: active, trialing, past_due, canceled…
  status text not null default 'active',
  provider text,
  customer_id text,
  subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint org_plans_plan_check check (plan in ('free', 'pro', 'team'))
);
create unique index if not exists org_plans_customer_idx on public.org_plans (customer_id)
  where customer_id is not null;

-- One row per workspace per calendar month (UTC, "2026-11").
create table if not exists public.org_usage_monthly (
  org_id uuid not null references public.orgs(id) on delete cascade,
  month text not null,
  server_turns integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (org_id, month)
);

-- Members can see their workspace's plan and usage (the billing page reads it on the server,
-- but the phone and future clients may read it directly). Only the server writes.
alter table public.org_plans enable row level security;
alter table public.org_usage_monthly enable row level security;

drop policy if exists org_plans_member_read on public.org_plans;
create policy org_plans_member_read on public.org_plans
  for select using (org_id in (select org_id from public.org_members where user_id = auth.uid()));

drop policy if exists org_usage_member_read on public.org_usage_monthly;
create policy org_usage_member_read on public.org_usage_monthly
  for select using (org_id in (select org_id from public.org_members where user_id = auth.uid()));

revoke insert, update, delete on public.org_plans, public.org_usage_monthly from anon, authenticated, public;
grant select on public.org_plans, public.org_usage_monthly to authenticated;
grant all on public.org_plans, public.org_usage_monthly to service_role;

-- Counts one server reply and says whether it fit. Atomic, so parallel turns can't overshoot.
create or replace function public.bump_server_turns(p_org uuid, p_month text, p_limit integer)
returns table (allowed boolean, used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  insert into public.org_usage_monthly as u (org_id, month, server_turns)
  values (p_org, p_month, 0)
  on conflict (org_id, month) do nothing;

  update public.org_usage_monthly as u
     set server_turns = u.server_turns + 1, updated_at = now()
   where u.org_id = p_org and u.month = p_month
     and (p_limit is null or u.server_turns < p_limit)
  returning u.server_turns into v_used;

  if v_used is null then
    select u.server_turns into v_used from public.org_usage_monthly u
     where u.org_id = p_org and u.month = p_month;
    return query select false, coalesce(v_used, 0);
  else
    return query select true, v_used;
  end if;
end;
$$;

revoke all on function public.bump_server_turns(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.bump_server_turns(uuid, text, integer) to service_role;
