-- 0032_mac_runner_tools.sql
-- Agents running on a person's Mac (Sayabot for Mac) get Sayabot's room tools and live tool
-- activity. Each job carries a one-run MCP token, sealed with MESH_KEK until the Mac claims it,
-- and the agent run it belongs to (so tool cards attach to the right reply). Idempotent.

alter table public.local_runner_jobs
  add column if not exists run_id uuid references public.agent_runs(id) on delete set null;
alter table public.local_runner_jobs add column if not exists mcp_token_enc text;
alter table public.local_runner_jobs add column if not exists mcp_token_id uuid;
-- Which app runs it (claude-code, codex…): chosen per agent, or the Mac's default.
alter table public.local_runner_jobs add column if not exists app text;

-- Tool cards from a Mac run are found by the app's own tool-use id (args->'_mac'->>'key').
create index if not exists tool_calls_mac_key_idx
  on public.tool_calls (room_id, ((args -> '_mac' ->> 'key')));
