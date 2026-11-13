# Models, prices, effort and plans

How the model picker on the Agents page finds which models each account can use, what they
cost, which effort levels they take, and how much of a subscription is used. The design follows
OpenMausBot (which follows OpenCode and T3 Code). Code: [`packages/llm/src/models/`](../packages/llm/src/models/).

## Where each piece comes from

| What | Source | Refresh | Code |
| :-- | :-- | :-- | :-- |
| Prices, context windows, per-model effort levels for every provider | `https://models.dev/api.json` | daily, with an ETag; falls back to our cache, then OpenCode's `~/.cache/opencode/models.json`, then the bundled snapshot | `models-dev.ts` |
| Claude Code / Codex / Cursor model lists, CLI version floors, price overrides | [`model-manifest.json`](../packages/llm/src/models/model-manifest.json), fetched from GitHub `main` | hourly; 5 minutes after someone opens the picker | `manifest.ts` |
| Codex models for the signed-in account (with each model's effort levels and default) | `codex app-server`, JSON-RPC `model/list` | kept 6 hours on disk; then `~/.codex/models_cache.json`; then the manifest | `engine-models.ts` |
| Claude models the organization blocks | `modelAccessCache` in `~/.claude.json` | every picker open | `engine-models.ts` |
| A saved API key's models | `GET {base}/models` (HTTPS only, no redirects) | 10 minutes per key; models.dev list when the provider can't be read | `provider-models.ts` |
| OpenRouter prices and free models | OpenRouter `/models` pricing; `/key` → `is_free_tier` | with the key's list | `provider-models.ts` |
| Plan name and 5-hour / weekly / monthly usage | `api.anthropic.com/api/oauth/usage`, `chatgpt.com/backend-api/wham/usage`, with the token the CLI saved (`~/.claude/.credentials.json` or the Keychain, `~/.codex/auth.json`) | 45 seconds | `plan-usage.ts` |

The usage endpoints are the ones Claude Code's `/usage` and Codex's `/status` call. They are not
public APIs: when one changes shape, the picker shows "returned an unexpected usage response"
and everything else keeps working. Plan usage and CLI model lists are only read when this
server is the person's own computer (`localDetectionAllowed`, `SAYABOT_LOCAL_DETECTION`).

The refresh button in the picker (`refreshModelListsAction`) re-reads everything at once.

## Prices

Usage accounting (`apps/orchestrator/src/usage.ts`) uses, in order: a row on the pricing page
(`model_pricing`), the manifest's `prices`, then models.dev. Runs on a subscription are never priced.

## Effort

Levels, lowest first: `none, low, medium, high, xhigh, max` (`effort.ts`). "Default" in the picker
saves nothing and the provider uses its own default (for API agents, Sayabot's `auto`: low, or high
on a task). Each model offers the levels models.dev or Codex lists for it, else its engine's list
(`ENGINE_EFFORT_LEVELS`). A saved level the model no longer takes is dropped when you change
model and again at run time, so a turn never fails on it.

- Claude Code: `--effort <level>`
- Codex: `-c model_reasoning_effort="<level>"`
- Anthropic API: thinking budget 1k–8k tokens (`none` turns thinking off)
- OpenAI API: `reasoningEffort` as is

## Maintaining

**A new Claude / Codex / Cursor model:** add it to `model-manifest.json` (id, name,
`status: "current"`, optional `contextWindow`, `minCliVersion`, `aliases`), add its price under
`prices` with `asOf` and an `https://` `source`, bump `updatedAt`, merge to `main`. Running servers
pick it up within the hour. A price change goes in that model's `changes: [{ from, … }]` so old usage
keeps its old price. `pnpm --filter @sayabot/llm test` checks the file.

**The bundled models.dev snapshot** (only used by a server that has never reached models.dev):
`pnpm --filter @sayabot/llm catalog:snapshot`.

**Environment:**

| Variable | Effect |
| :-- | :-- |
| `SAYABOT_DATA_DIR` | Where caches live (default `~/.sayabot`; caches under `providers/`) |
| `SAYABOT_MODEL_MANIFEST_URL` | Read the manifest from somewhere else (a fork) |
| `SAYABOT_DISABLE_MODEL_MANIFEST_FETCH=1` | Use only the bundled manifest |
| `SAYABOT_DISABLE_MODEL_CATALOG_FETCH=1` | Never call models.dev |
| `SAYABOT_CLAUDE_PATH`, `SAYABOT_CODEX_PATH`, `SAYABOT_CURSOR_PATH` | CLI locations |
