# Orchestrator tests

- `tests/unit/` — pure/single-module behaviour (env, active-runs, ssrf,
  runner context/llm helpers, mcp instructions, engine evidence, tool specs).
- `tests/integration/` — cross-module contracts with the DB/network stubbed:
  in-process Hono app, ComputerClient fetch stub, approval/bot-reply waiters,
  memory tools, MCP registry, webhook drop paths, interrupt steering.

Run: `pnpm --filter @sayabot/orchestrator test`
