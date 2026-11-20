# Local AI CLI Usage Scanner

`packages/core/src/scanner/` reads the **on-disk session stores of local AI coding agents** — Claude Code, Codex CLI, and Antigravity — on the user's machine and turns them into a unified usage ledger: per-call token records, cost estimates, provider/model/daily aggregations, dashboard-shaped event rows, and locally-estimated plan-limit gauges. It is the engine behind "how much have my local CLIs cost me and how much of my plan allowance is left", running entirely read-only against the user's home directory.

Source files: `packages/core/src/scanner/index.ts`, `types.ts`, `claude.ts`, `codex.ts`, `antigravity.ts`, `limits.ts`, `pricing.ts`, `plan-limits.ts` (tests: `scanner.test.ts`, `plan-limits.test.ts`)

---

## 📦 Types (`types.ts`)

The vocabulary every other module shares:

- **`LocalProvider`** — `"antigravity" | "claude" | "codex" | "cursor" | "opencode" | "other"` (the scanner itself only scans the first three).
- **`UsageSpeed`** — `"standard" | "fast" | "ultrafast"` (service tiers; `fast` costs 1.5x, `ultrafast` 2x).
- **`UsageTokenTotals`** — the five channels: `uncachedInputTokens`, `cachedInputTokens`, `cacheCreationTokens`, `outputTokens`, `reasoningTokens`.
- **`ScannedUsageRecord`** — one billable model call: `id` (dedupe key), `provider`, `sessionId`, `timestampMs`/`isoDate`/`createdAt`, `model` (+ optional `rateModel`), `totals`, `costUsd`, `cacheSavingsUsd`, `reportedCostUsd` (provider-stated, nullable), `speed`, `dedupeKey`.
- **`ScannedUsageSummary`** — grand totals plus `byProvider` (each a `ProviderSummary` with token mix and `sharePercent`), `byModel` (`ModelSummary`), and `byDay` (`DailySummary[]`).
- **`ScannedUsageEventRow`** — a record formatted **identically to Sayabot DB `usage_events` rows** (`agent_id`, `room_id`, `provider`, `model`, `input_tokens`, `output_tokens`, `cached_input_tokens`, `cache_creation_tokens`, `session_id`, `cost_usd`, `ttft_ms`, `latency_ms`, `created_at`) "for instant drop-in dashboard compatibility"; scanned rows carry `agent_id`/`room_id = null` and `ttft_ms`/`latency_ms = null`.
- **`ProviderLimitGroup` / `ProviderLimitWindow`** — the locally-estimated limit gauges (see [limits.ts](#-local-limit-estimates-limitsts)) with `kind: "session" | "weekly" | "monthly" | "other"`, `usedPercent`, `resetsAt`, `resetsInText`, and `pace: "ahead" | "on" | "under"`.
- **`ScanOptions`** — `days?`, `sinceMs?`, per-provider `antigravityDirs?`/`claudeDirs?`/`codexDirs?` overrides, `includeProviders?`.
- **`ScannedUsageResult`** — `{ records, summary, events, limits, scannedAt, providersScanned }`.

---

## 🚀 Orchestrator (`index.ts`)

`scanLocalUsage(options?)` (`scanner/index.ts:30`) is the single entry point:

1. **Window** — `days` defaults to 30 (values ≤ 0 fall back to 30); `sinceMs` defaults to `Date.now() - days * 86_400_000`.
2. **Provider selection** — `includeProviders` defaults to `["antigravity", "claude", "codex"]`.
3. **Parallel scan** — the three provider scanners run under `Promise.allSettled`, so a failed provider (missing directory, unreadable DB, no `node:sqlite`) never breaks the others; failed results are simply skipped.
4. **Cross-provider dedupe** — records are deduped by `id` across providers (a `Set`), then sorted ascending by `timestampMs`.
5. **Aggregation** — one pass builds grand totals (reasoning tokens are summed separately and **not** added to `totalTokens`, which is input + cached + cache-creation + output), plus `byProvider` / `byModel` / `byDay` maps keyed by provider / model / ISO date with session-`Set` counting. Money is rounded to 4 decimals, `sharePercent` to 0.1.
6. **Event rows** — every record maps to a `ScannedUsageEventRow`, with `input_tokens = uncached + cached + cacheCreation`.
7. **Limits** — `estimateLocalLimits(records)` computes the local gauges.

The module re-exports everything: `types`, `pricing`, all three provider scanners, `limits`, and `plan-limits`.

---

## 🟠 Claude Code Scanner (`claude.ts`)

### What it reads on disk

- Default directories: `~/.claude/projects` and `~/.config/claude/projects` (override with `directories`).
- Walks each base recursively **up to depth 3**, collecting `*.jsonl` files; a base path may itself be a `.jsonl` file. Files whose `mtimeMs` is older than `sinceMs - 24h` are skipped without opening (scanner-level pre-filter; the timestamp filter is applied again per record).
- These JSONL files contain full session transcripts, including the model's own replies. Only `type: "assistant"` lines with a `message.usage` object are considered; nothing but counters is retained.

### Line parsing (`parseClaudeLine`, `claude.ts:33`)

- Fast reject: lines without the substring `"usage"`, unparseable JSON, non-`assistant` types, missing `usage`, missing/unparseable `timestamp`, and models that are empty or `"<synthetic>"` (`CLAUDE_SYNTHETIC_MODEL` — Claude Code writes synthetic entries for local bookkeeping which must not be billed).
- Session id: `record.sessionId` → `record.session_id` → the file's basename minus `.jsonl`.
- Token channels map directly (`input_tokens` → uncached, `cache_read_input_tokens` → cached, `cache_creation_input_tokens` → creation, `output_tokens` → output); reasoning comes from `output_tokens_details.thinking_tokens` or `thinking_tokens`. All values go through `tokenCount()` which truncates and coerces junk to 0.
- Dedupe key: `message.id` + `requestId` when present, else `claude:<sessionId>:<timestampMs>`.
- `speed`: `usage.speed === "fast"` → `"fast"`, else `"standard"`.
- `costUSD` on the record is captured as `reportedCostUsd`.
- **Advisor iterations**: if `usage.iterations` exists, each `type: "advisor_message"` entry becomes an additional record with its own model and totals, keyed `"<dedupeKey>:advisor:<i>"`.

### File scanning (`scanClaudeFile`)

Streams the file with `fs.createReadStream` + `readline`. Claude Code streams **progressive partial blocks**, so duplicate keys are merged by taking the **max of each token channel** (and max of reported cost) rather than summing — this is what prevents double-counting streamed responses. Entries with zero total tokens are dropped. Cost = `reportedCostUsd` when positive, else `computeUsageCost(...)`; `id = "claude:" + dedupeKey`.

---

## 🟢 Codex Scanner (`codex.ts`)

### What it reads on disk

- Default directory: `~/.codex/sessions` (override with `directories`), recursive to **depth 5**, same `.jsonl` + mtime pre-filter.
- Session JSONLs with typed records. Lines are pre-filtered on five keywords: `"session_meta"`, `"turn_context"`, `"thread_settings_applied"`, `"token_usage_record"`, `"token_count"`.

### Stateful file scan (`scanCodexFile`)

The parser carries rolling state across lines: `currentSessionId`, `currentModel`, `currentSpeed`, `currentTurnId`, plus fork suppression:

- `session_meta` — adopts `payload.id`/`payload.session_id`; marks the session **forked** when `forked_from_id` or `source.subagent.thread_spawn.parent_thread_id` exists, anchoring `forkAnchorMs`.
- `turn_context` — updates `currentModel` and `currentTurnId`.
- `thread_settings_applied` — updates `service_tier` (`priority`/`fast` → `fast`, `ultrafast` → `ultrafast`, else `standard`) and model.
- **Fork burst suppression** — events within 1000 ms of the fork anchor are skipped (they are copied parent history, not new usage); the flag clears after that window.
- `token_usage_record` — the modern path: builds `UsageTokenTotals` where `uncachedInputTokens = max(0, input - cached_input - cache_write_input)`, costing and pushing immediately. Dedupe key / record id: `codex:<sessionId>:<turnId|lineIndex>:<timestampMs>`.
- `token_count` — collected as a **fallback** list; used only when the file contained _zero_ `token_usage_record` entries (older Codex builds), producing identical records. This makes the scanner robust across Codex versions without double-counting either format.

---

## 🟣 Antigravity Scanner (`antigravity.ts`)

The most involved scanner: Antigravity stores conversations as **SQLite databases whose metadata columns are raw protobuf blobs**.

### What it reads on disk

- Default directories: `~/.gemini/antigravity/conversations`, `~/.gemini/antigravity-cli/conversations`, `~/.gemini/antigravity-ide/conversations`, `~/.config/antigravity/conversations`, plus a comma-separated `ANTIGRAVITY_DATA_DIR` env override (each entry getting `/conversations` appended unless it already ends with it).
- Each `*.db` file is one conversation (session id = basename). The DB is opened with **`readOnly: true`** via `node:sqlite`, and closed in a `finally`.
- **`node:sqlite` availability guard** (`loadSqlite`, `antigravity.ts:12`): the module is looked up via `process.getBuiltinModule` at call time because it only exists on Node 22.5+; Electron 34 (the Mac app) runs Node 20, so there Antigravity history is _skipped_ instead of crashing every scan.

### Protobuf decoding (`parseProtobufFields`)

A dependency-free wire-format decoder: varints (up to 70 bits, returned as `Number` when safe), fixed 64-bit (wire 1), fixed 32-bit (wire 5), and length-delimited (wire 2) fields, collected into a `Map<fieldNumber, value[]>`. Wire types 3/4 (groups) stop parsing. Helpers: `numberAt`, `bytesAt`, `nested`, `textAt`, `timestampFromFields` (field 1 seconds + field 2 nanos).

### Metadata parsing (`parseMetadata`)

Two layouts exist — the trajectory `steps` table (`step: true`) and `gen_metadata` rows (`step: false`) — with different field numbers for model name, usage blob, and retry list. It extracts:

- The **model**: candidate names are normalized by `normalizeAntigravityModel` (`"Claude Opus 4.5"` → `claude-sonnet-4-5`-style kebab, with Claude's `claude-<ver>-<tier>` re-ordered to `claude-<tier>-<ver>`), then the first **concrete** name wins (`isConcreteModel`: `/^(?:gemini-\d|claude-(?:sonnet|opus|haiku)-\d|gpt-)/` minus the `gemini-3-flash-agent/-a/-b` pseudo-models), else a non-`model_*` text name.
- The **model id** (numeric), falling back to the usage blob's own field 1.
- **Usages**: the main usage blob plus one per retry record (field 28/17).
- The **timestamp** with a quality ranking: step-provided → trajectory → file mtime.

Usage fields decode as: field 2 = uncached input, 3/9+10 = output (max of the two readings), 4 = cache creation, 5 = cached input, 9 = reasoning (clamped to output). Records with all-zero tokens are skipped. Identity keys come from usage fields 11, 12, 7.

### Dedup via union-find (`deduplicateCandidates`)

Steps, generations, and retries frequently describe the **same call**. Candidates are merged with a DSU over shared keys (`antigravity:id:<id>` identity keys plus the positional composite `antigravity:<sessionId>:<idx>:<uIdx>`). Each merged group keeps: the max of each token channel, the highest-quality model name (concrete 4 → text 2 → unknown 0, resolved against the per-DB `learnedModels` map, then the static `ANTIGRAVITY_MODEL_IDS` table, then `antigravity-model-<id>`), the highest-quality timestamp, and an `antigravity:id:` dedupe key when available.

`ANTIGRAVITY_MODEL_IDS` (`antigravity.ts:21`) is a large numeric-id → model-name table (e.g. `246 → gemini-2.5-pro`, `333 → claude-sonnet-4-5`, `1318 → gemini-3.8-flash-high`, `1402 → claude-opus-5-5`, `1417-1419 → gemini-4-argon`), used when no text name was recoverable.

---

## 🏷️ Pricing (`pricing.ts`)

- **`DEFAULT_MODEL_PRICES`** — a static table of `ModelPrice { inputPerMtok, outputPerMtok, cacheReadPerMtok, cacheWritePerMtok? }` covering Gemini/Antigravity models (flash tiers at $0.15/$0.60, pro at $1.25/$5.00, `gemini-4-argon` at $2.00/$8.00), Anthropic (opus $15/$75 with $18.75 cache-write, sonnet $3/$15, haiku $0.80/$4.00), OpenAI (`gpt-4o`, o1, `o3-mini`, …), and OpenRouter/OpenCode entries.
- **`DEFAULT_FALLBACK_PRICE`** — `$1.00` input / `$3.00` output / `$0.10` cache-read per Mtok for unknown models.
- **`normalizeModelKey`** — lowercases, strips known provider prefixes (`anthropic/`, `google/`, `openai/`, `bedrock/`, `vertex/`) and `[...]` context suffixes.
- **`getModelPrice(model, overrides?)`** — exact match on the normalized key, then caller overrides, then bidirectional prefix matching (`claude-3-5-sonnet-20241022` → `claude-3-5-sonnet`), then a suffix strip (`-extra-low|-low|-medium|-high|-tiered|-control|-thinking|-agent`, `-YYYYMMDD`, `-latest`), then fallback.
- **`computeUsageCost(totals, price, speed)`** — `input + cacheRead + cacheWrite + output` per Mtok, × speed multiplier (`standard` 1.0, `fast` 1.5, `ultrafast` 2.0); missing cache prices default to `0.1 × input` (read) and `1.0 × input` (write); rounded to 6 decimals.
- **`computeUsageCacheSavings`** — dollars saved by cache hits: `cachedTokens × max(0, inputPrice − cacheReadPrice)`.

`scanner.test.ts` verifies the arithmetic exactly (e.g. a 100k/900k/50k/20k mix at sonnet prices = $1.0575, and $2.43 of cache savings).

---

## 📊 Local Limit Estimates (`limits.ts`)

`estimateLocalLimits(records)` (`scanner/limits.ts:22`) produces the dashboard gauges **estimated purely from scanned history** — these are Sayabot's own approximations, distinct from the provider-reported values in `plan-limits.ts`. A provider group is only emitted when that provider has records in the window.

| Group                                | Windows                      | Caps                         | Reset rule                                                        |
| :----------------------------------- | :--------------------------- | :--------------------------- | :---------------------------------------------------------------- |
| Antigravity ("Google CloudCode Pro") | 5-hour session + weekly      | 250k tokens / 5 h, 5M / week | 5 h: oldest record in window + 5 h; weekly: next Sunday 00:00 UTC |
| Claude Code ("Anthropic Max Tier")   | 5-hour sliding + weekly pool | 300k / 5 h, 6M / week        | same rules                                                        |
| Codex ("OpenAI Codex Subscription")  | weekly only                  | 10M / week                   | next Sunday 00:00 UTC                                             |

Token sums count `uncached + cached + output` (cache-creation excluded). `usedPercent` is capped at 100. The 5-hour `pace` is derived by comparing usage against the _elapsed fraction_ of the window (±15pp tolerance → `ahead`/`on`/`under`); weekly windows use fixed thresholds (`>50%` → `ahead`); Codex is always reported `pace: "under"`. `resetsInText` renders as `"Resets in 2d 3h"` / `"3h 10m"` / `"12m"` / `"Resetting now"` via `formatDurationRemaining`. Display metadata is fixed per provider (`color: "#6366f1"` / `"#d97706"` / `"#10a37f"`), with `accountName` strings like `"Personal (Gemini 3.8 & Claude 4.5)"`.

---

## 📡 Provider-Reported Plan Limits (`plan-limits.ts`)

> "Pure parsers only: the reading (Keychain, files, network) lives in the Mac app, so sign-in tokens never leave it. Every value here comes from the provider; when a reading is missing the window is left out rather than guessed." — module header, `plan-limits.ts:1`

These functions parse the **providers' own usage answers** — the numbers Claude Code's `/usage`, Codex's logged `rate_limits`, and Google's quota summary show. The Mac app fetches/reads the raw material and calls these parsers; no network or token handling happens in core.

Shared types: `PlanWindow { label, usedPercent, resetsAt, windowMinutes }` and `PlanLimits { provider, label, plan, windows, observedAt, error }` (`error` explains a missing reading in plain words). Helpers: `clampPercent` (0-100), `isoOrNull` (ISO strings, or epoch seconds/milliseconds distinguished by the `1e12` bound), and `windowLabel(minutes)` which names common windows (`300` → `"5-hour"`, `10_080` → `"Weekly"`, 40000-45000 → `"Monthly"`, whole days/hours/minutes otherwise).

- **`parseClaudeUsage(answer)`** — Anthropic's plan-usage answer (`{ five_hour: { utilization, resets_at }, seven_day, seven_day_opus, seven_day_sonnet }`) → windows labelled `"5-hour"`, `"Weekly"`, `"Weekly · Opus"`, `"Weekly · Sonnet"`. Unrecognized shapes return `[]`.
- **`parseCodexRateLimits(rateLimits, now?)`** — the `rate_limits` object Codex writes into session logs (`{ primary: { used_percent, window_minutes, resets_at }, secondary, plan_type }`) → windows from `primary`/`secondary` plus the `plan_type` string. A window whose reset time has already passed is reported **fresh** (`usedPercent: 0`, no `resetsAt`) rather than stale.
- **`lastCodexRateLimits(logText)`** — scans a chunk of session log lines **backwards** for the newest line containing `"rate_limits"` under `payload.rate_limits`, returning it with its `observedAt` timestamp; broken/truncated lines are skipped, and `null` is returned when nothing qualifies.
- **`parseAntigravityQuota(answer)`** — Google Code Assist's `retrieveUserQuotaSummary` answer (`{ groups: [{ displayName, buckets: [{ window, displayName, resetTime, remainingFraction }] }] }`) → windows with `usedPercent = 100 − remainingFraction × 100`, labels like `"<Group> · 5-hour"`, window minutes inferred from the bucket text (`/week/i` → 10 080, `/5\s*-?\s*h|five/i` → 300, else `null`).

`plan-limits.test.ts` covers each parser's happy path and rejection path, including the "reset since logged → fresh" rule and `windowLabel` naming.

---

## 🔒 What it touches, what it returns, and safety

**Read-only disk access, nothing written.** The scanner opens these user-owned paths on the user's Mac:

| Provider    | Paths read                                                                                                                  | Format                                                                          |
| :---------- | :-------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------ |
| Claude Code | `~/.claude/projects/**`, `~/.config/claude/projects/**` (depth ≤ 3)                                                         | session `.jsonl` transcripts (assistant lines only)                             |
| Codex       | `~/.codex/sessions/**` (depth ≤ 5)                                                                                          | session `.jsonl` event logs                                                     |
| Antigravity | `~/.gemini/antigravity{,-cli,-ide}/conversations/*.db`, `~/.config/antigravity/conversations/*.db`, `$ANTIGRAVITY_DATA_DIR` | SQLite (`gen_metadata`, `steps`, `trajectory_metadata_blob`), opened `readOnly` |

Safety properties, all visible in the code:

- **No writes**: SQLite is opened `readOnly: true` (`antigravity.ts:400`); JSONL is streamed, never modified. Every parse/stat/read error is swallowed into an empty result for that file or directory — a scan can never corrupt the source agents' data.
- **No token harvesting**: only usage counters, model names, session ids, and timestamps are extracted. Provider _sign-in tokens never enter this package_ — `plan-limits.ts` is parsers-only by design, with the Keychain/network side kept in the Mac app so credentials never leave it.
- **Transcript content is not returned**: no prompts, replies, or file contents from the scanned sessions appear in `ScannedUsageResult`.
- **Graceful degradation**: `Promise.allSettled` per provider, per-file try/catch, the `node:sqlite` capability guard, and mtime-based pre-filtering keep a partially-installed or actively-being-written environment from failing the scan.
- **Determinism**: dedupe keys and max-merge semantics make repeated scans of the same stores converge to the same records (ids like `claude:<messageId>:<requestId>` and `codex:<session>:<turn>:<ts>` are stable), so the dashboard can re-scan without double counting.

Related docs: [./platform-utilities.md](./platform-utilities.md), [./cost-and-plan-limits.md](./cost-and-plan-limits.md), [./engine-and-computers.md](./engine-and-computers.md)
