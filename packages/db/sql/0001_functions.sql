-- Core functions and triggers that Drizzle cannot express.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'rooms', 'agents', 'messages', 'turn_sessions', 'tool_calls',
    'canvases', 'mcp_servers', 'model_pricing', 'org_tool_configs'
  ]
  loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t, t
    );
  end loop;
end;
$$;

-- Keep profiles in sync with Supabase auth.users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      nullif(trim(new.raw_user_meta_data->>'user_name'), ''),
      nullif(trim(split_part(coalesce(new.email, ''), '@', 1)), ''),
      'member'
    ),
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'avatar_url'), ''),
      nullif(trim(new.raw_user_meta_data->>'picture'), '')
    )
  )
  on conflict (id) do update set
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    display_name = case 
      when public.profiles.display_name is null or public.profiles.display_name = '' or public.profiles.display_name = 'member'
      then excluded.display_name
      else public.profiles.display_name
    end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select id, split_part(coalesce(email, ''), '@', 1)
from auth.users
on conflict (id) do nothing;

-- Self-referencing thread root. Drizzle models the column; the constraint is added here.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_thread_root_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_thread_root_id_fkey
      foreign key (thread_root_id) references public.messages(id) on delete cascade;
  end if;
end;
$$;
