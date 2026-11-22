-- 0043_mac_job_system_prompt.sql
-- local_runner_jobs.system_prompt: the run's system prompt (room context, room-tools and Mac
-- notes) kept apart from the prompt for ACP apps on Sayabot for Mac 1.0.32+, which pass it to the
-- agent session as a system prompt instead of prepending it to the user's message. Null means
-- the system prompt is already part of `prompt` (older Mac apps and non-ACP apps). Idempotent.

alter table public.local_runner_jobs add column if not exists system_prompt text;
