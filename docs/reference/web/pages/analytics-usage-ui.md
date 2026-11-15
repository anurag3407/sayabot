# Usage & Analytics Screens

The Usage page (`/[org]/analytics`) answers "how much did my agents work and what did it cost?" over a 1/7/30/90-day window. It combines an exact database rollup (for totals) with the newest raw `usage_events` (for charts and latency), estimates spend from a `model_pricing` table, and — when opened on the person's own computer — can also show local coding-tool usage (Claude Code, Codex, Antigravity sessions) read through the Mac app or a local-only API route. Plan-limit "fuel gauge" rings from the Mac app render above the dashboard.

Source files: `apps/web/src/app/(workspace)/[org]/analytics/page.tsx`, `apps/web/src/components/analytics/usage-dashboard.tsx`, `apps/web/src/components/analytics/usage-bars.tsx`, `apps/web/src/components/usage/plan-rings.tsx`, `apps/web/src/lib/plan-limits-store.ts`, `apps/web/src/lib/usage.ts`, `apps/web/src/lib/usage-math.ts`, `apps/web/src/lib/usage-summary.ts`, `apps/web/src/lib/actions/pricing.ts`

---

## 🖥️ Server Page (`(workspace)/[org]/analytics/page.tsx`)

- Accepts `?days=` and snaps it to one of `{1, 7, 30, 90}` (default 30, `page.tsx:14-26`); `since` is `now - days * 86_400_000`.
- `requireOrgAccess(orgSlug)` gates membership; data loads in one `Promise.all` (`page.tsx:31-37`):
  - `loadRecentUsageEvents(orgId, since)` — raw events sample.
  - `loadUsageRollup(orgId, since)` — exact totals (or `null`).
  - `listOrgAgents` / `listRooms` — names for labels and links.
  - `model_pricing` read directly via the Supabase server client (`provider, model, input_per_mtok, output_per_mtok`), coerced to numbers.
- Renders `<UsageDashboard>` with `canEditPrices` set for owners/admins and `sinceIso` for chart bucketing.

## 📊 Usage Dashboard (`components/analytics/usage-dashboard.tsx`)

A large client component. State: `source` (`"sayabot"` | `"local"`), `metric` (`"tokens"` | `"cost"`), `groupBy` (`"agent"` | `"model"`), and a `local` loader `{ available, loading, events }`.

### Local coding-tool source

On mount (and whenever `days` changes) it tries `readDesktopLocalUsage(days)` from `lib/desktop-bridge.ts` (the Mac app reading logs on that computer); if unavailable it falls back to `fetch("/api/usage/local?days=N")`, which only answers when Sayabot itself runs on this computer (`usage-dashboard.tsx:204-225`). When local data exists, a segmented control offers "Agents in Sayabot" vs "Coding tools on this computer"; local mode forces `groupBy: "model"`, hides the Agents/Chats cards, and relabels stats ("Would cost at API prices", "Requests", "Coding session").

### Totals vs sample

`exactRows` come from the rollup when present, else from the sample; `sampleRows` are always the real events (`usage-dashboard.tsx:232-239`). Totals/summary use `exactRows`; the time chart and speed metrics use `sampleRows`. When `eventsComplete` is false a Notice explains either that "Totals count every call" (rollup installed) or that only the newest 20,000 calls are included and the admin should apply the latest database update.

### The numbers (`summarize`)

- Three stat cards: **Spent** (`money(summary.cost)`, annotated when `subscriptionTokens > 0`: tokens that ran on the user's own coding plan at no extra cost), **Replies** (plus background steps like summaries and checks when `backgroundCalls > 0`, else chat count via `summary.sessions`), and **Tokens** (with a "≈ N words" hint at 0.75 words/token and a title-tooltip token explainer).
- **Agents / Models / Chats lists** (top 8/8/6 buckets) each with call count, percent share and a `ShareBar` whose colour matches the chart series (`colorFor`, `usage-dashboard.tsx:295-299`). Chats link to `/[org]/r/<roomId>`; missing rooms read "Private or deleted chat", missing agents "Removed agent", null ids "Behind the scenes" / "Outside a chat".
- **Unpriced warning**: models with `price === "unpriced"` produce a warn Notice that those tokens are "counted as free and the real spend is higher", with a "Set prices" link to `/[org]/settings/pricing` for managers (`usage-dashboard.tsx:378-393`).
- **The details** (collapsed `<details>`): token split tiles — Read fresh, Read from cache (`cacheHitRate`), Saved to cache (only when `cacheWrite > 0`), Written — plus a caching-savings line computed with `computeCacheSavingsUsd` from `@sayabot/core` (`usage-dashboard.tsx:262-269`), and speed tiles (median first word, median whole reply, p95 "slowest replies") from `speed(sampleRows)`.
- **Empty state**: a sleeping `Mascot seed="Usage"` card with "Nothing to count yet" and, for the Sayabot source, a "Go to chats" button.
- The period nav in the header is server-rendered `Link`s to `?days=N` (the only URL state); metric/group-by are client-local.

## 📈 Stacked Bars (`components/analytics/usage-bars.tsx`)

`UsageBars` renders the time chart with plain divs (no chart library):

- `SERIES_COLORS` (`usage-bars.tsx:11`) is five categorical slots (`#3987e5`, `#d95926`, `#199e70`, `#c98500`, `#d55181`) validated for the dark surface and colour-blind separation; `seriesColor(index, id)` returns `OTHER_COLOR` (`#55555c`) for the `other` series.
- `niceMax(peak)` rounds the y-max to a 1/2/2.5/5×10ⁿ step; dashed tick lines at max and max/2.
- Bars are stacked per series with `flexGrow` proportional to value; non-active bars dim to 45% opacity. Hover/click selects a bar; the group is keyboard-focusable with ArrowLeft/ArrowRight to move the selection and Escape to clear (`usage-bars.tsx:45-56`), announced via `role="status"` tooltip showing `longLabel`, total, and per-series breakdown.
- X labels show every `ceil(points.length / 7)`-th bar; the last bar is labelled "Now" (hourly) or "Today".

## ⏱️ Series Math (`lib/usage-summary.ts`)

The pure computation layer for everything the dashboard shows (unit-tested):

- **Row conversion** — `rowFromEvent` maps a raw `usage_events` row to `UsageRow` (clamping negatives, `cached = min(input, cached_input_tokens)`, `cost = Number(cost_usd)`); `rowFromRollup` maps a rollup row with `calls = requests` and no timing/session data. Token convention documented in the module header: `input` already includes cache reads/writes; `cached` is the part read from cache; `output` is what the model wrote.
- **`SUBSCRIPTION_PROVIDERS`** = `claude-code`, `codex`, `cursor` — runs on the person's own plan, so `priceState()` returns `"subscription"` (no per-token cost) before consulting `pickModelPrice` from `@sayabot/core` (`usage-summary.ts:14,95-98`). `"priced"` vs `"unpriced"` follows the pricing table.
- **`summarize(rows, prices, names)`** builds `UsageSummary`: `replies` (rows with `kind === "llm"`), `backgroundCalls` (other kinds), `sessions` (distinct `sessionId` falling back to `roomId`), token totals, `fresh = max(0, input - cached - cacheWrite)`, cost rounded to 6 decimals, `cacheHitRate = cached / input`, `unpricedTokens` / `subscriptionTokens`, and `byAgent` / `byModel` / `byRoom` bucket lists ranked by tokens then cost, each with `share` and `costShare`. Room bucket key is `roomId ?? sessionId ?? "none"`.
- **`speed(rows)`** filters to `kind === "llm"` ("background calls have no one waiting on them") and computes quantiles of `ttftMs` (median first word), `latencyMs` (median reply, p95 slow) via a nearest-rank `quantile` helper.
- **`timeSeries(rows, opts)`** pre-creates every bucket from `sinceIso` to now — per hour when `hourly` (24-hour view) else per local day via `localDayKey`/`localHourKey` (viewer's own time zone, `usage-math.ts:72-81`) — so empty days still render. Values group by the `groupBy` callback; the top `MAX_SERIES = 5` groups get colours, the rest fold into an `"other"` / "Everything else" series. The `keep` list is passed across metric switches so an agent keeps its colour between Tokens and Spend (`usage-dashboard.tsx:272-275`).
- **`prettyModelName`** turns `claude-sonnet-4-5-20250929` → "Claude Sonnet 4.5" and `openai/gpt-oss-120b` → "GPT OSS 120B" (via `baseModelName` + a `WORD_CASE` map); `providerLabel` maps provider ids to display names (`claude`/`claude-code` → "Claude Code", `gemini` → "Google", etc.).

## 🧮 Rollup & Events (`lib/usage.ts`, `lib/usage-math.ts`)

`lib/usage.ts` is `server-only`:

- `loadUsageRollup(orgId, sinceIso)` calls the Postgres function `usage_rollup` via `supabase.rpc(...)`; **any error returns `null`** — the documented meaning is "the rollup function isn't installed yet (migration 0022 not applied)" and the dashboard silently falls back to the event sample (`usage.ts:32-35`).
- `loadRecentUsageEvents(orgId, sinceIso)` pages through `usage_events` newest-first in 1,000-row pages up to `EVENT_SAMPLE_CAP = 20_000` (`usage.ts:28-29`), then reverses to oldest-first for charting. `complete` is false when the period had more calls than the cap.

`lib/usage-math.ts` is the pure, shared part: the `UsageRollupRow` / `AgentUsage` types and `usageByAgent(rows)` which aggregates rollup rows per agent (totals, `lastAt`, per-model breakdown sorted by tokens, `topModel`, cost rounded to 1e-6). It is re-exported through `lib/usage.ts`.

## 💍 Plan Rings (`components/usage/plan-rings.tsx`)

Local plan-limit UI driven entirely by the Mac app bridge (`lib/desktop-bridge.ts`: `canReadPlanLimits`, `readPlanLimits`, `resetsIn`, types `PlanLimits`/`PlanWindow`):

- `usePlanLimits()` reads one module-level store through `useSyncExternalStore`, so every ring (top bar, model picker, Usage page) shares one reading that survives remounts. Polling starts with the first subscriber and stops with the last: every `POLL_MS = 5 * 60_000` and on window focus, with concurrent reads de-duplicated. Each read is folded in by `mergePlanLimits` (`lib/plan-limits-store.ts`): an empty result (the app could not be asked) changes nothing, and a provider without windows keeps its last good windows while they are younger than `STALE_READING_MS` (12 h). This, with the desktop's own `withLastGood` and 429 back-off, fixes Claude's ring disappearing on rate limits or token refreshes. `supported` is false outside the desktop app, so all of this renders nothing in a plain browser.
- `PlanRing` draws up to two nested SVG arcs per provider (outer = first window, usually 5-hour; inner = second, usually weekly); the arc shows **what's left** with `toneColor`: green, amber ≤ 25%, red ≤ 10% (`plan-rings.tsx:53-57`). The provider icon sits in the middle; no windows renders a dashed grey ring.
- `TopBarPlanRings({ usageHref })` — the gauges in the workspace's top-right corner (rendered by `WorkspaceShell`): one 26px ring per plan with readings, linking to the usage page with an aria-label/title composed by `describeLimits` ("<label>: 62% left of 5-hour, resets in 2h 14m; …"). `tightest()` (the window with the least remaining) is still exported.
- `PlanLimitsSection` — the card `UsageDashboard` renders at the top: one tile per provider (Claude, Codex, Antigravity) with ring, plan name, per-window percentages and reset times, a refresh button, and for Codex a staleness note ("As Codex last saw it, N min ago", from `observedAt`).

## 💵 Pricing Action (`lib/actions/pricing.ts`)

`upsertModelPricing(_prev, formData)` is a form-action server handler: `adminOrgAccess` gate, Zod coercion of `inputPerMtok`/`outputPerMtok` (0–10,000), `model_pricing` upsert on conflict `(provider, model)` with `updated_at`, audit entry `pricing.updated` with the prices in metadata, `revalidateOrg`, "Price saved". It backs the "Set prices" flow at `/[org]/settings/pricing` that the dashboard's unpriced-model warning links to.

## Related docs

- [Settings UI](./settings-ui.md) — the pricing page (`settings/pricing`) where model prices are edited
- [App overview](./app-overview.md) — workspace shell and the `planUsageNotice` banner fed from the same usage data
- [Agents UI](./agents-ui.md) — agents/models that appear as buckets here
- [Room chat UI](./room-chat-ui.md) — the rooms the Chats card links into
- [lib-reference](./lib-reference.md) — `desktop-bridge.ts` plan-limit bridge functions
- ../../architecture/system-overview.md — where `usage_events` are written during turns
- ../../database/schema.md — `usage_events`, `model_pricing`, and the `usage_rollup` routine
- ../../../models-and-pricing.md — pricing concepts behind the cost estimates
