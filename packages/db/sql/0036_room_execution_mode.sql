-- 0036_room_execution_mode.sql
-- How bots in a chat ask before acting, picked from the composer.
--  * ask_risky (default): risky tools (dangerous: true) wait for a person's OK; reads just happen.
--  * review_all: every tool call waits for a person's OK, even reading and searching.
-- There is deliberately no value that skips approval for risky tools. Idempotent.

alter table public.rooms add column if not exists execution_mode text not null default 'ask_risky';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_execution_mode_check') then
    alter table public.rooms
      add constraint rooms_execution_mode_check check (execution_mode in ('ask_risky', 'review_all'));
  end if;
end $$;
