-- 0038_agent_last_seen.sql
-- When an invited agent's own app (Claude Code, Cursor, Codex, Hermes…) last called Sayabot with
-- its key or sign-in token. The orchestrator stamps it at most every 30 seconds. Room settings
-- shows "connected" / "not open right now" from it, and a room says so when a turn is handed to
-- an app that isn't open. Idempotent.

alter table public.agents
  add column if not exists last_seen_at timestamptz;
