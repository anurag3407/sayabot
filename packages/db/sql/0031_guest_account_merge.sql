-- 0031_guest_account_merge.sql
-- Desktop guest mode: when a guest signs in to (or creates) a real account, everything the
-- guest made moves into that account. Idempotent.

-- One-time proof that the person signing in really was this guest. Only the server (service
-- role) reads or writes it; the raw token lives in an httpOnly cookie, here we keep its hash.
create table if not exists public.account_merge_tickets (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  guest_user_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  used_at timestamptz
);
create index if not exists account_merge_tickets_guest_idx
  on public.account_merge_tickets (guest_user_id);

alter table public.account_merge_tickets enable row level security;
revoke all on public.account_merge_tickets from anon, authenticated, public;
grant all on public.account_merge_tickets to service_role;

-- Moves every row that points at the guest over to the target user.
--
-- Walks the catalog for single-column foreign keys to profiles / auth.users, so tables added
-- later are covered without touching this function. Where the target already has an
-- equivalent row (a unique key would clash, e.g. both in the same room), the target's row wins
-- and the guest's duplicate is dropped. Columns that hold a user id without a foreign key
-- (message senders, authors, actors) are listed explicitly.
--
-- Runs in one transaction: any other error rolls the whole merge back.
create or replace function public.merge_guest_into_user(p_guest uuid, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fk record;
  r record;
  n bigint;
  moved jsonb := '{}'::jsonb;
  dropped jsonb := '{}'::jsonb;
  key text;
begin
  if p_guest is null or p_target is null or p_guest = p_target then
    raise exception 'guest and target must be two different users';
  end if;
  if not exists (select 1 from auth.users where id = p_guest and is_anonymous) then
    raise exception 'source user is not a guest account';
  end if;
  if not exists (select 1 from auth.users where id = p_target and not is_anonymous) then
    raise exception 'target user must be a full (non-guest) account';
  end if;

  -- Two tabs finishing the same merge must not interleave.
  perform pg_advisory_xact_lock(hashtext('mesh:merge:' || p_guest::text)::bigint);

  -- 1. Foreign keys to profiles(id) or auth.users(id).
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
      and c.connamespace = 'public'::regnamespace
      and c.conrelid not in (
        'public.profiles'::regclass,
        'public.account_merge_tickets'::regclass
      )
    order by 1, 2
  loop
    key := fk.tbl::text || '.' || fk.col;
    begin
      execute format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col)
        using p_target, p_guest;
      get diagnostics n = row_count;
      if n > 0 then moved := moved || jsonb_build_object(key, n); end if;
    exception when unique_violation then
      -- Some rows clash with ones the target already has: move row by row, drop the clashes.
      n := 0;
      for r in execute format('select ctid as rid from %s where %I = $1', fk.tbl, fk.col)
        using p_guest
      loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', fk.tbl, fk.col)
            using p_target, r.rid;
          n := n + 1;
        exception when unique_violation then
          execute format('delete from %s where ctid = $1', fk.tbl) using r.rid;
          dropped := dropped || jsonb_build_object(
            key, coalesce((dropped ->> key)::bigint, 0) + 1
          );
        end;
      end loop;
      if n > 0 then moved := moved || jsonb_build_object(key, n); end if;
    end;
  end loop;

  -- 2. User ids stored without a foreign key (sender/author/actor can also be an agent id;
  --    ids are UUIDs, so matching the guest's id only ever hits the guest's own rows).
  update public.messages set sender_id = p_target where sender_id = p_guest;
  get diagnostics n = row_count;
  if n > 0 then moved := moved || jsonb_build_object('messages.sender_id', n); end if;

  update public.canvas_versions set author_id = p_target where author_id = p_guest;
  get diagnostics n = row_count;
  if n > 0 then moved := moved || jsonb_build_object('canvas_versions.author_id', n); end if;

  update public.task_events set actor_id = p_target where actor_id = p_guest;
  get diagnostics n = row_count;
  if n > 0 then moved := moved || jsonb_build_object('task_events.actor_id', n); end if;

  update public.task_comments set author_id = p_target where author_id = p_guest;
  get diagnostics n = row_count;
  if n > 0 then moved := moved || jsonb_build_object('task_comments.author_id', n); end if;

  update public.audit_logs set actor_id = p_target where actor_id = p_guest;
  get diagnostics n = row_count;
  if n > 0 then moved := moved || jsonb_build_object('audit_logs.actor_id', n); end if;

  return jsonb_build_object('moved', moved, 'dropped', dropped);
end;
$$;

revoke all on function public.merge_guest_into_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_guest_into_user(uuid, uuid) to service_role;
