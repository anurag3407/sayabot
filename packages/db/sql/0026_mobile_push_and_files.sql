-- 0026_mobile_push_and_files.sql
-- Phone push tokens (alerts with Answer / Allow buttons) and a private bucket for files
-- sent from the phone. Idempotent.

create table if not exists public.mobile_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  platform text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists mobile_push_tokens_user_idx on public.mobile_push_tokens (user_id);
alter table public.mobile_push_tokens enable row level security;
revoke all on public.mobile_push_tokens from anon, authenticated, public;
grant all on public.mobile_push_tokens to service_role;

-- Private bucket: files are served through /api/files, which checks room access first.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('attachments', 'attachments', false, 15728640)
    on conflict (id) do nothing;
  end if;
end;
$$;
