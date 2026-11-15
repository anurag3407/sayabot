-- 0035_model_choice.sql
-- Pick a model per bot and per chat.
--  * local_runner_jobs.model / effort: the model and thinking effort a Mac run uses inside the app
--    (Claude Code, Codex, Ollama…). null keeps the app's own default.
--  * room_agents.model_override: "only this chat" — this bot answers in this chat with another
--    model than its default ({ keyId, model, effort, providerKeyId, agentModel, runner }).
--    null follows the bot's default. Idempotent.

alter table public.local_runner_jobs add column if not exists model text;
alter table public.local_runner_jobs add column if not exists effort text;
alter table public.room_agents add column if not exists model_override jsonb;
