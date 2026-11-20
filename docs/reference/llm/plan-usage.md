# Plan Usage — Subscription Quota Windows

`src/models/plan-usage.ts` answers "which subscription is the signed-in CLI on, and how much of its rolling limits is used?" for the two plan-based engines: Claude Code (Claude Pro/Max/Team) and Codex (ChatGPT Plus/Pro). It reads the OAuth token the CLI already saved on this computer, sends it — in a header only — to the vendor's own usage endpoint (the same ones Claude Code's `/usage` and Codex's `/status` call), and parses the response into a normalized list of usage windows.

These are not public APIs, so the module is built to degrade: every failure becomes a `PlanUsage` row with `ok: false` and a human-readable `error`; nothing ever throws. The token never enters the result, a log line, or the database.

Source files: `packages/llm/src/models/plan-usage.ts` (412 lines)

---

## 📤 Exported surface

| Export                                    | Purpose                                                            |
| :---------------------------------------- | :----------------------------------------------------------------- |
| `CLAUDE_USAGE_URL`                        | `https://api.anthropic.com/api/oauth/usage` (`plan-usage.ts:20`)   |
| `CODEX_USAGE_URL`                         | `https://chatgpt.com/backend-api/wham/usage` (`plan-usage.ts:21`)  |
| `PlanEngine`                              | `"claude-code" \| "codex"`                                         |
| `UsageWindow`                             | `{ label, usedPercent, resetsAt: string \| null }`                 |
| `PlanUsage`                               | `{ engine, ok, plan: string \| null, windows, error?, checkedAt }` |
| `parseClaudeUsage(body)`                  | Anthropic response → `{ plan, windows }`                           |
| `parseCodexUsage(body)`                   | OpenAI response → `{ plan, windows }`                              |
| `planLabel(value)`                        | Sanitizes a plan name; `null` if it looks like a credential        |
| `fetchEnginePlanUsage(engine, deps?)`     | Full read: credential → HTTP → parse                               |
| `loadEnginePlanUsage(engine, { force? })` | 45-second cached wrapper                                           |
| `clearPlanUsageCache()`                   | Resets the cache (tests)                                           |

---

## 📊 Data shape

```typescript
export interface UsageWindow {
  label: string // "5-hour", "Weekly", "Opus · weekly", "Code review · 5-hour", "Extra usage"…
  usedPercent: number // clamped to 0..100
  resetsAt: string | null // ISO timestamp when known
}

export interface PlanUsage {
  engine: PlanEngine
  ok: boolean
  plan: string | null // "max", "pro", "plus"… as the vendor names it; null when unknown
  windows: UsageWindow[] // 5-hour, weekly, per-model and extra-usage windows
  error?: string // set when ok is false
  checkedAt: string // ISO timestamp of this read
}
```

(`plan-usage.ts:31-47`.)

---

## 🔑 Credential reading (read-only, never returned)

`fetchEnginePlanUsage` first obtains a `Credential { token, accountId, expired, plan? }`. Tokens must pass `secretString()`: a string, trimmed, ≤ 16,000 chars, no newlines (`plan-usage.ts:205-209`).

### Claude Code (`readClaudeCredential`, `plan-usage.ts:274-284`)

1. Read `<CLAUDE_CONFIG_DIR or ~/.claude>/.credentials.json` (≤ 1 MB, `CREDENTIAL_READ_MAX_BYTES`), parse `claudeAiOauth.accessToken` (or `access_token`).
2. If that has no token, ask the **macOS Keychain**: `/usr/bin/security find-generic-password -s "Claude Code-credentials" -w` (5 s timeout, darwin only). The Keychain may print the JSON secret as hex, so `decodeKeychainSecret()` hex-decodes when the text is an even-length hex string that does not start with `{` (`plan-usage.ts:246-253`).
3. When `CLAUDE_CONFIG_DIR` moves the config folder, the Keychain service name is suffixed with an 8-char SHA-256 of the path (`claudeKeychainService`, `plan-usage.ts:268-272`) — matching how Claude Code names the entry.
4. An `expiresAt`/`expires_at` in the past yields the `expired()` credential (→ "Sign in again"), and the plan the CLI saved beside the login (`subscriptionType`) is surfaced as `credential.plan` — not a secret.

### Codex (`readCodexCredential`, `plan-usage.ts:286-302`)

Reads `$CODEX_HOME or ~/.codex/auth.json`: `tokens.access_token` (or top-level `access_token`), `tokens.account_id` for the header, expiry from `tokens.expires_at` / root `expires_at`.

---

## 🌐 Fetching

`fetchJson()` (`plan-usage.ts:306-322`) sends `user-agent: Sayabot`, `redirect: "error"`, an 8-second `AbortSignal.timeout` (`PROVIDER_TIMEOUT_MS`), and parses at most the first 1 MB of the body. Auth headers per engine (`plan-usage.ts:361-372`):

| Engine      | Endpoint           | Headers                                                                                                   |
| :---------- | :----------------- | :-------------------------------------------------------------------------------------------------------- |
| Claude Code | `CLAUDE_USAGE_URL` | `Authorization: Bearer <token>`, `Accept: application/json`, `anthropic-beta: oauth-2025-04-20`           |
| Codex       | `CODEX_USAGE_URL`  | `Authorization: Bearer <token>`, `Accept: application/json`, `ChatGPT-Account-Id: <accountId>` when known |

Failure rows (`errorRow`, `plan-usage.ts:324-326`):

| Condition                       | `error`                                                   |
| :------------------------------ | :-------------------------------------------------------- |
| No token, credential expired    | `Sign in again in Claude Code` / `… Codex`                |
| No token, none saved            | `Claude Code is not signed in` / `Codex is not signed in` |
| HTTP 401 / 403                  | `Sign in again in <product>`                              |
| Status 0 (network) or ≥ 500     | `Could not reach <product>`                               |
| Other non-OK / unparseable body | `<product> returned an unexpected usage response`         |

---

## 🕵️ Parsing the Anthropic response (`parseClaudeUsage`)

`plan-usage.ts:106-137`. The root may be the body itself or nested under `usage` / `windows`. Windows extracted:

- `five_hour` → label **"5-hour"**, `seven_day` → **"Weekly"**; each needs a numeric `utilization`, otherwise dropped.
- **Per-model windows**: keys matching `five_hour_<suffix>` / `seven_day_<suffix>` whose suffix starts with one of the Claude model families `["opus", "sonnet", "haiku", "fable"]` (`CLAUDE_MODEL_FAMILIES`, `plan-usage.ts:27`) — e.g. `seven_day_opus` → "Opus · weekly". Other named windows (like `seven_day_oauth_apps`) are ignored.
- **Extra usage**: `extra_usage.is_enabled === true` — percent is `used_credits / monthly_limit` when both are present, else the provided `utilization`; label "Extra usage", `resetsAt: null`.
- **Plan**: `subscription_type` / `plan` / `plan_type` through `planLabel()`.

`planLabel()` (`plan-usage.ts:80-86`) rejects anything empty, over 80 chars, multi-line, or looking like a credential — the regex rejects `bearer\s`, `access_token`, `refresh_token`, `sk-ant-`, and long JWT-shaped `eyJ…` strings. A test pins "never treats a credential as a plan name".

Timestamps (`timeMs`, `plan-usage.ts:63-72`) accept epoch seconds, epoch milliseconds (magnitude heuristic ≥ 1e12), numeric strings, or ISO strings.

## 🕵️ Parsing the ChatGPT response (`parseCodexUsage`)

`plan-usage.ts:171-190`. Windows come from `rate_limit.primary_window` / `secondary_window` (falling back to the node itself), each with `used_percent` and a window length taken from `limit_window_seconds` or `window_minutes`. Because ChatGPT does not name the windows, `durationLabel(seconds)` (`plan-usage.ts:139-145`) classifies by length: 3–8 h → "5-hour", 5–9 days → "Weekly", 27–32 days → "Monthly", shorter → "N-hour", longer → "N-day".

- `code_review_rate_limit` becomes prefixed windows ("Code review · 5-hour").
- `additional_rate_limits` (an array of `{ limit_name | metered_feature | name, … }` or an object map) yields further prefixed windows.
- Plan: `plan_type` / `plan` through `planLabel()`.

---

## ⏱️ Caching and call sites

```typescript
/** Cached for 45 seconds per engine, so opening the picker repeatedly makes one request. */
export function loadEnginePlanUsage(engine, options: { force?: boolean } = {}): Promise<PlanUsage>
```

(`plan-usage.ts:395-407`; cache TTL `PLAN_USAGE_CACHE_MS = 45_000`.) The cache stores the in-flight promise, so concurrent callers share one request.

Consumers:

- `apps/web/src/lib/model-catalog.ts` calls `loadEnginePlanUsage(app.id as "claude-code" | "codex")` while building the agent model picker, gated by `localDetectionAllowed` — plan usage is only meaningful when this server is the person's own computer (same gate as the CLI runners).
- The picker renders `plan` and each window's `usedPercent` / `resetsAt` next to the engine's model list.

---

## 🧪 Test coverage

`src/models/models.test.ts`, `describe("plan usage")` (`src/models/models.test.ts:297-368`):

| Test                                                                | Pins                                                                                                                                                                                                                   |
| :------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parses Claude windows, per-model windows and the plan`             | `subscription_type: "max"` → plan `max`; windows exactly `["5-hour" 42%, "Weekly" 100% (130 clamped), "Opus · weekly" 10%, "Extra usage" 25% (500/2000)]`; `seven_day_oauth_apps` excluded; `resets_at` ISO-normalized |
| `parses Codex windows by their length`                              | `plan_type: "pro"`; `limit_window_seconds: 18_000` → "5-hour", `604_800` → "Weekly"; `reset_at` epoch-seconds → ISO                                                                                                    |
| `never treats a credential as a plan name`                          | `planLabel("Bearer abc")` and `planLabel("sk-ant-123")` → `null`; `planLabel("plus")` → `"plus"`                                                                                                                       |
| `sends the token only in the header and keeps it out of the result` | `JSON.stringify(row)` does not contain the token; the fetch got `Authorization: Bearer tok-secret` and `ChatGPT-Account-Id: acct`                                                                                      |
| `falls back to the plan saved beside the login`                     | Anthropic's answer without a plan + credential `plan: "max"` → row plan `max`                                                                                                                                          |
| `asks to sign in again on 401 and when the login expired`           | 401 → `{ ok: false, error: "Sign in again in Claude Code" }`; expired credential → same message                                                                                                                        |

---

## Related docs

- [registry-and-models.md](./registry-and-models.md) — the model-catalog pipeline this feeds into
- [overview.md](./overview.md) — package map
- [crypto.md](./crypto.md) — why CLI tokens are never stored server-side
