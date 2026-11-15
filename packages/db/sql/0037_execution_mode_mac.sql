-- 0037_execution_mode_mac.sql
-- Four execution modes, like a local coding agent's permissions:
--  * review_all  every step asks, even reading and searching
--  * ask_risky   (default) risky steps ask
--  * auto        on the owner's own Mac, read-only commands run without asking
--  * turbo       on the owner's own Mac, every command runs without asking
-- execution_mode_set_by records who picked it: a Mac honours auto/turbo only when its owner did,
-- so another member of a group chat can't loosen someone else's computer. Server tools marked
-- dangerous keep asking in every mode. Idempotent.

alter table public.rooms
  add column if not exists execution_mode_set_by uuid references public.profiles(id) on delete set null;

alter table public.rooms drop constraint if exists rooms_execution_mode_check;
alter table public.rooms
  add constraint rooms_execution_mode_check
  check (execution_mode in ('review_all', 'ask_risky', 'auto', 'turbo'));
