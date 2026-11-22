# Sayabot Desktop — Usage Scanning & Cloud Handoff

Two features live at the edges of the desktop app. **Usage** (`src/usage/`) reads plan limits and token history for the coding CLIs signed in on this Mac — Claude Code, Codex, Antigravity — turning provider responses and on-disk logs into dashboard-ready numbers without tokens ever leaving the process. **Cloud handoff** (`src/cloud-handoff.ts`) carries this Mac's workspace snapshot (bots, chats, routines, sealed keys) up to Sayabot Cloud while a plan is active and back down to any non-Cloud server afterwards.

Source files: `apps/desktop/src/usage/index.ts`, `src/cloud-handoff.ts`, parsers from `@sayabot/core/scanner` (see [Scanner](../core/scanner.md))

---

## 📊 Usage: How It's Built & Exposed

`src/usage/index.ts` is bundled **separately** by esbuild into `dist/usage.js` (`build:usage` script) because it imports `@sayabot/core/scanner`; `main.ts` lazily `require`s it on first IPC use (`usage()`, `src/main.ts:1027`). Both IPC handlers — `usage:plan-limits` and `usage:local` — are gated by `fromWorkspace` (`src/main.ts:1033`): only frames whose URL is `file://` (the controller page) or shares the origin of the signed-in server may call; anything else gets empty results.

Sign-in tokens are read, used for one request to the provider that issued them, and dropped; only percentages, reset times and token counts are handed back. All outbound provider calls identify themselves with `User-Agent: sayabot-desktop` and run under `AbortSignal.timeout(8_000)` (`TIMEOUT_MS`).

## 📈 Plan Limits (`readPlanLimits`, `src/usage/index.ts`)

Returns all eight providers (Claude, Codex, Antigravity, OpenCode, Pi/OMP, Cursor, Copilot, ZCode) under `Promise.all`, each failing independently into an `unavailable(...)` `PlanLimits` with a plain-language `error`. Cached for **60 seconds** (`CACHE_MS`) so the top-bar rings can poll cheaply; `force` bypasses the cache. Every reading goes through `withLastGood`: a provider that comes back without windows (rate limit, sign-in refresh, network) returns its last reading with numbers instead, as long as that reading is under 12 hours old, so a passing failure never makes a ring vanish.

Each `PlanLimits` (type from `@sayabot/core/scanner`) is `{ provider, label, plan, windows, observedAt, error }` — `plan` is the plan name when the provider reports one (Claude's OAuth `subscriptionType`, Codex's parsed plan, OpenRouter credit plan), `windows` the list of usage gauge rows (used percent + reset time) produced by the core parsers, and `error` a user-facing string when the provider could not be read (`null` on success). Timing constants: every outbound request runs under an 8-second `AbortSignal.timeout`, and the CLI/keychain helpers get 5-second timeouts with 1 MB output caps.

### Claude (`readClaudeLimits`)

1. **Credentials** (`claudeCredentials`): on macOS, `/usr/bin/security find-generic-password -s "Claude Code-credentials" -w` (the Keychain may prompt); fallback to `.credentials.json` under `$CLAUDE_CONFIG_DIR` or `~/.claude`. Only `claudeAiOauth.accessToken`, `expiresAt`, `subscriptionType` are extracted.
2. **Freshness** — tokens expiring within 60 s (or 401/403 from the API) produce "sign-in needs a refresh. Run Claude Code once, then check again."
3. **Usage** — `GET https://api.anthropic.com/api/oauth/usage` with the bearer token, `anthropic-beta: oauth-2025-04-20`, `User-Agent: sayabot-desktop`, 8 s timeout. A **429** sets a quiet period from `Retry-After` (default `CLAUDE_BACKOFF_MS = 5 min`) during which Claude is not called and "Claude is busy. Showing the last reading." is returned (so `withLastGood` shows the previous numbers). The JSON goes through `parseClaudeUsage` from `@sayabot/core` into limit windows; empty windows mean "no plan limits (an API key or a team plan without them)". The plan label is the OAuth `subscriptionType`, and connection failures degrade to "Couldn't reach Claude. Check your connection." rather than throwing.

### Codex (`readCodexLimits`)

No sign-in is needed: Codex writes its own rate-limit readings into every session log. `newestCodexLogs` walks `$CODEX_HOME` (default `~/.codex`) `sessions/<year>/<month>/<day>/*.jsonl` newest-first (directories sorted descending, files by mtime) up to 8 files; `tail` reads the **last 512 KB** of each; `lastCodexRateLimits` finds the newest recorded limits and `parseCodexRateLimits` converts them to windows plus a plan name. The first log with a usable reading wins; logs without one are skipped. No logs → "No Codex sessions on this computer yet."

### Antigravity (`readAntigravityLimits`)

1. **Token** (`antigravityToken`): reads `~/.gemini/antigravity-cli/antigravity-oauth-token` (`$GEMINI_HOME` honoured) and returns the `token.access_token`, `"expired"` when its `expiry` has passed, or `null`.
2. **Quota** — Google Code Assist internal API: `POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist` to resolve `cloudaicompanionProject`, then `POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary { project }`, both bearer-authenticated with 8 s timeouts. `parseAntigravityQuota` turns the summary into windows. A missing project ("no Antigravity plan limits") or empty windows surface as unavailable states, not errors.

### OpenCode (`readOpenCodeLimits`)

Reads credentials and provider configurations from `~/.local/share/opencode/auth.json`, `~/.config/opencode/opencode.json` (`$XDG_CONFIG_HOME`), or `OPENCODE_API_KEY`. If configured with OpenRouter (`tokenrouter`/`openrouter`), queries OpenRouter key and credits endpoints. If configured with OpenCode API key, queries `https://api.opencode.ai/v1/user/quota`. Falls back to active session window if local SQLite store (`opencode.db`) is present.

### Pi & OMP (`readPiLimits`)

Reads `~/.pi/agent/auth.json` and `~/.omp/agent/auth.json`. Detects OpenRouter OAuth tokens or API keys, querying OpenRouter's `auth/key` and `credits` APIs to report live credit balance and spending percentages. For direct Anthropic/OpenAI keys, surfaces active BYOK state.

### Cursor (`readCursorLimits`)

Reads `CURSOR_API_KEY` from the environment or detects local Cursor installation (`~/.cursor`, `Library/Application Support/Cursor`). Queries Cursor's team usage endpoints (`https://api.cursor.com/teams/spend`) when keys are provided, reporting fast request allowances and monthly spend caps.

### GitHub Copilot (`readCopilotLimits`)

Reads tokens from environment variables (`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`), `~/.config/github-copilot/apps.json`, `~/.config/gh/hosts.yml`, or `gh auth token`. Queries `https://api.github.com/copilot_internal/v2/token`, extracting plan SKU and HTTP rate-limit headers into hourly and subscription limit windows.

### ZCode (`readZCodeLimits`)

Reads credentials from `ZCODE_API_KEY`, `ZAI_API_KEY`, `GLM_API_KEY`, or local configs (`~/.zcode/cli/config.json`, `~/.zcode/cli/setting.json`, `~/.zcode/v2/provider_config.json`). Queries Z.ai quota endpoint `https://api.z.ai/api/monitor/usage/quota/limit`, converting 5-hour rolling refresh cycles and 7-day weekly caps into plan limit windows.

### Token history (`readLocalUsage`, `src/usage/index.ts:264`)

`readLocalUsage(days)` calls `scanLocalUsage({ days })` from `@sayabot/core/scanner` — a read-only walk of the coding tools' own on-disk session stores producing `events` shaped like Sayabot `usage_events` rows. `days` is clamped to 1–365 (default 30), and the IPC result adds `available: true` plus `providersScanned` so the page can show which stores were found. The full scanning engine, safety properties and cost model are documented in [Scanner](../core/scanner.md) and [Cost & plan limits (core)](../core/cost-and-plan-limits.md).

---

## ☁️ Cloud Handoff (`src/cloud-handoff.ts`)

The desktop cannot import `@sayabot/core` (its tsconfig excludes the workspace package at typecheck time for the app bundle), so this file re-declares the snapshot shape — "same shape as packages/core `LocalWorkspaceSnapshot`" (`src/cloud-handoff.ts:1`):

```typescript
interface LocalWorkspaceSnapshot {
  bots: Array<{ id }>; chats: Array<{ id }>; routines: Array<{ id }>; keys: Array<{ id }>
  computers?: {                       // sealed Boat key + VPS name only
    boatCiphertext?/boatIv?/boatTag?/boatLast4?: string | null
    vpsSshAlias?: string | null
    vpsStartAutomatically?: boolean
  } | null
}
```

**No plaintext keys are stored** (`src/cloud-handoff.ts:27`): `computersFromRecord` (`src/cloud-handoff.ts:28`) returns `null` if a raw `boatToken`/`token` field is present, keeps the computer entry only when the Boat key is fully sealed (ciphertext + iv + tag + last4) or a syntactically valid `vpsSshAlias` exists, and never copies plaintext. `snapshotHasRecords` (`src/cloud-handoff.ts:50`) requires real content — a bot `handle`, chat `name`, routine `prompt`, key `ciphertext`, or a sealed computer — before anything is copied.

### The decision (`planCloudHandoff`, `src/cloud-handoff.ts:21`)

Mirrors `planCloudHandoff` in `@sayabot/core`:

| cloudReady    | planActive | copied | Step            |
| :------------ | :--------- | :----- | :-------------- |
| ✓             | ✓          | ✗      | `copy_to_cloud` |
| —             | ✗          | ✓      | `copy_back`     |
| anything else |            |        | `none`          |

### The sync (`syncCloudHandoff`, `src/cloud-handoff.ts:106`)

All calls authenticate as the computer (`x-host-id`/`x-host-token`, see [host.md](./host.md)) against `/api/desktop/cloud-home`:

```
GET /api/desktop/cloud-home → { cloudReady, planActive, copied }
├─ copy_to_cloud → POST /api/desktop/cloud-home { snapshot }      (server stores the copy)
├─ copy_back     → DELETE /api/desktop/cloud-home                (server returns + drops it)
│                    └─ writeSnapshot(body.snapshot) → onCopiedBack()
└─ none          → nothing more happens this round
```

1. `GET` the status `{ cloudReady, planActive, copied }`.
2. `copy_to_cloud` → `POST` with `{ snapshot }` (fails with "Nothing on this Mac to copy" when the snapshot is empty).
3. `copy_back` → `DELETE`; the response's `snapshot` is handed to `writeSnapshot` (persisted to `cloud-home.json`) and `onCopiedBack` fires (sets the `cloud-home-return.json` flag).

A second call while the plan is active does nothing (`none`). Errors thrown by the sync are caught by the callers — `maybeCloudHandoff` logs "cloud copy skipped" and waits for the next 10-minute window; `leaveCloudHome` in `useServer` is `.catch(() => false)`'d, so a failed handoff never blocks switching servers.

Where the desktop state lives on disk (`app.getPath("userData")`):

| File                     | Writer                                             | Purpose                                                                                               |
| :----------------------- | :------------------------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `cloud-home.json`        | `useServer` / `syncCloudHandoff`'s `writeSnapshot` | This Mac's last known snapshot (bots/chats/routines/keys/computers)                                   |
| `cloud-home-return.json` | `onCopiedBack` / `useServer`                       | Flag `{ cloudUrl }` meaning "the Cloud copy came back down; import it into the next non-Cloud server" |
| `sayabot-host.json`      | host registration                                  | `hostId`/`hostToken` used to authenticate all handoff calls                                           |

On first launch — no snapshot file yet — `readCloudSnapshot` (`src/host.ts:132`) substitutes the bots found on this computer by `detectLocalAgents` as a minimal `{ bots, chats: [], routines: [], keys: [] }`, so a brand-new Mac still has something to copy up when a plan activates.

### Companion helpers

- `fetchWorkspaceSnapshot` (`src/cloud-handoff.ts:61`) — `GET /api/desktop/workspace-snapshot`; returns the server's copy only if it has records.
- `importWorkspaceSnapshot` (`src/cloud-handoff.ts:76`) — `POST /api/desktop/workspace-import` with the snapshot; existing rows on the target server are left as they are. Returns success boolean.
- `leaveCloudHome` (`src/cloud-handoff.ts:149`) — when this Mac stops pointing at Cloud (`nextEdition !== "cloud"`), runs the sync against the Cloud server so an active plan's copy comes back down; returns whether `copy_back` happened. Going **to** Cloud is a no-op here.

### Who calls what

- `main.ts` `useServer` (`src/main.ts:111`): leaving a non-Cloud server → `leaveCloudHome` (writes `cloud-home-return.json` on success); leaving Cloud → `fetchWorkspaceSnapshot` saved to `cloud-home.json`. In both directions the current snapshot file is written **before** the config/session changes, so a crash mid-switch cannot lose the copy.
- `DesktopHost.maybeCloudHandoff` / `importReturnedHome` (`src/host.ts:318,339`, at most every 10 minutes inside the heartbeat): keeps the copy in sync while signed in, and imports the returned snapshot into whichever non-Cloud server the Mac now uses, clearing the return flag when it succeeds — see [host.md](./host.md).

The server-side storage and gating of these routes (what Cloud keeps, what a self-hosted server accepts) are in [api-desktop.md](../web/api/api-desktop.md), and the billing side of `planActive` in [editions-and-licensing.md](../architecture/editions-and-licensing.md). The core package's shared implementation of the same decision lives beside its tests in `packages/core/src/cloud-handoff*` — the desktop copy exists purely because the app's main-process tsconfig cannot import that package.

---

## Related docs

- [Overview (lifecycle, IPC, storage)](./overview.md)
- [Host service (registration & heartbeat)](./host.md)
- [Scanner (core usage engine)](../core/scanner.md)
- [Cost & plan limits (core)](../core/cost-and-plan-limits.md)
- [Desktop Host API (server side)](../web/api/api-desktop.md)
- [Editions & licensing](../architecture/editions-and-licensing.md)
- [Sayabot Cloud](../../sayabot-cloud.md)
