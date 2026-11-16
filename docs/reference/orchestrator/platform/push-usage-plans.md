# Push Notifications, Usage Accounting & Plan Limits

Three support services round out the platform. **Push** (`push.ts`) alerts humans when an agent is waiting on them — web push (VAPID) for browsers with the Sayabot service worker, Expo push for the mobile app — with lock-screen actions so approvals and questions can be answered without opening a tab. **Usage** (`usage.ts`) is the single funnel that turns every model call (replies, moderators, subagents, verify, memory) into a priced `usage_events` row. **Plans** (`plans.ts`) enforces Sayabot Cloud's monthly server-reply limits — self-hosted servers and Mac-hosted replies are never counted — and answers a used-up month with a friendly agent reply instead of an error.

Source files: `apps/orchestrator/src/push.ts`, `apps/orchestrator/src/usage.ts`, `apps/orchestrator/src/plans.ts`

---

## 🔔 Push (`src/push.ts`)

### Channels

| Channel | Transport | Subscriptions | Cleanup |
| :--- | :--- | :--- | :--- |
| Browsers | `web-push` (VAPID) against `push_subscriptions` rows (`endpoint`, `p256dh`, `auth`) | Registered by the web app's service worker `apps/web/src/sw.ts` | `404`/`410` responses delete the row ("the browser dropped this subscription"). Other failures logged. |
| Phones | `POST https://exp.host/--/api/v2/push/send` (Expo) against `mobile_push_tokens` rows | The React Native client | Responses with `status: "error"` + `details.error === "DeviceNotRegistered"` have their token rows deleted. 10 s timeout. |

Web push requires `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`; `pushReady()` (`push.ts:11-23`) configures `webpush.setVapidDetails` once and caches the verdict, so a server without VAPID env vars silently skips browser delivery while phone delivery still works. All web-push messages carry `TTL: PUSH_TTL_SECONDS = 300` (`push.ts:7`) — 5 minutes, because a stale approval alert is worthless.

Both channels are parallel, not either/or: `notifyHumansNeeded` sends phones first, then browsers (skipping browsers when `pushReady()` is false).

### Browser payload shape

The service worker receives a `WebPushPayload` (`push.ts:50-57`):

```typescript
interface WebPushPayload {
  title: string
  body: string
  url: string      // deep link, e.g. "/<orgSlug>/inbox"
  tag: string      // dedup/collapse key, e.g. "mesh-approval-<toolCallId>"
  kind?: "approval" | "request" | "done"
  toolCallId?: string
}
```

An approval payload with a `toolCallId` renders **Allow / Don't allow buttons** in the service worker that decide the approval without opening a tab — the module docstring calls this out explicitly ("An approval with a toolCallId gets Allow / Don't allow buttons that decide it without opening a tab", `push.ts:47-49`).

The Expo message shape (`push.ts:111-121`): `priority: "high"`, `channelId: "agents"`, `threadId = roomId` (threaded notifications), body clipped to 180 chars, and a `categoryId` the phone maps to actions — `"question"` (answer with a text box), `"approval"` (Allow / Don't allow), or `"info"`.

### Recipient resolution

`roomApprovers(roomId)` (`push.ts:26-44`) computes who can act:

```typescript
const [admins, orgAdmins] = await Promise.all([
  db.select({ userId: roomMembers.userId }).from(roomMembers)
    .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.role, "admin"))),
  db.select({ userId: orgMembers.userId }).from(orgMembers)
    .where(and(eq(orgMembers.orgId, room.orgId), inArray(orgMembers.role, ["owner", "admin"]))),
])
return { orgId: room.orgId, userIds: [...new Set([...admins, ...orgAdmins].map(r => r.userId))] }
```

i.e. room-level admins plus org-level owners/admins, deduped. `agentName(agentId)` resolves the agent's display name (fallback `"An agent"`), and the org `slug` is fetched because every web push URL is org-scoped (`"/<slug>/inbox"`, `"/<slug>/cron"`). A missing org slug aborts delivery.

### `notifyHumansNeeded({ roomId, agentId, kind: "approval" | "request", detail, refId? })` (`push.ts:152-190`)

The "an agent is waiting on you" alert — called by the collab layer (stuck tasks, human decisions, see [collab-tasks.md](./collab-tasks.md)) and the approval flow. Fire-and-forget (`void (async () => …)().catch(log)`): push **never** blocks or fails the agent turn, and "the Inbox still has the item" if delivery fails.

- Phones: title `"<agent> needs your approval"` or `"<agent> has a question"`; for approvals the body is `"Wants to use <detail with _ → spaces>. It expires in 5 minutes."`; `data: { kind, refId, roomId, orgSlug }`; category `"approval"`/`"question"` when a `refId` exists (so the lock screen can act on the specific tool call or task), else `"info"`.
- Browsers: same title; `url: "/<orgSlug>/inbox"`, `tag: "mesh-<kind>-<refId|roomId>"`, `kind`, and `toolCallId` for approval refids.

### `notifyRoutineFinished({ roomId, agentId, routineName, ownerUserId, summary, failed })` (`push.ts:203-239`)

Called by `recordRoutineResult` when a scheduled run's turn ends (see [scheduler-routines.md](./scheduler-routines.md)). Goes to the routine's `ownerUserId`, or the room's approvers when nobody owns it (agent/API-created routines). Title `"<routine> is done"` / `"<routine> didn't finish"`; body is `preview(summary)` — the `preview()` helper (`push.ts:193-196`) strips `#*_``>` Markdown markers, collapses whitespace, and truncates to ~160 chars with an ellipsis — or `"<agent> finished."` when the summary is empty. Web payload deep-links to `/<orgSlug>/cron` with `tag: "mesh-done-<roomId>"` and `kind: "done"`.

## 📊 Usage (`src/usage.ts`)

One place turns a model call into a `usage_events` row "so every path (replies, moderator turns, subagents, critic checks, memory consolidation) is counted and priced the same way" (`usage.ts:7-11`).

- **`tokensFrom(usage: LanguageModelUsage)`** (`usage.ts:44-52`): normalizes the AI SDK's usage object — `inputTokens`, `outputTokens`, plus `cachedInputTokens`/`cacheWriteTokens` from `inputTokenDetails`, missing fields → 0. Returns `null` for a nullish input, which `recordUsageEvent` treats as "nothing to record".

```typescript
export interface UsageTokens {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
}
```

- **Pricing** (`priceUsage`, `usage.ts:69-80`): the `model_pricing` table (the org-editable pricing page) is loaded through a **60-second cache** (`PRICE_TTL_MS = 60_000`, `priceRows` at `usage.ts:18-34`), so pricing edits apply within a minute; `resetPriceCache()` (`usage.ts:127-129`) exists for tests. A row on the pricing page wins (`pickModelPrice` from `@sayabot/core`); otherwise `listPriceFor(provider, model)` from `@sayabot/llm/models` supplies list price — "so a new model is priced the day it ships instead of counting as free" (`usage.ts:54-57`). `computeCostUsd` from `@sayabot/core` does the arithmetic over input/output/cache-read/cache-write rates.
- **`recordUsageEvent(args)`** (`usage.ts:83-124`): skips null token objects and zero-token calls (`inputTokens === 0 && outputTokens === 0`); `billing: "subscription"` forces cost `0` while the tokens are still recorded; inserts into `usage_events` (`orgId`, `roomId?`, `agentId?`, `provider`, `model`, token counts, `kind` default `"llm"`, `costUsd`, `ttftMs?`, `latencyMs?`) and returns the cost. **Never throws** — "accounting must not break a reply"; failures are logged and return 0.

The docstring is explicit about the design goal (`usage.ts:7-11`): every path that calls a model on the server — replies, moderator turns, subagents, critic checks, memory consolidation — funnels through this one function so token counting and pricing stay consistent. The `billing` option documents the subscription case: '"subscription" for runs on someone's own Claude Code / Codex / Cursor plan: the tokens still show on Usage, but they cost nothing per token, so they are never priced' (`usage.ts:93-97`). Replies that run in an app on the owner's Mac are recorded separately, when the Mac posts the job done (`recordMacJobUsage` in `apps/web/src/lib/mac-usage-store.ts`), because that path never calls the server model.

`UsageKind = "llm" | "moderator" | "subagent" | "verify" | "memory" | "summary"`. Callers: `src/coordinator/index.ts`, `src/engine/run.ts`, `src/engine/verify.ts`, `src/engine/subagents.ts`, `src/runner/llm.ts`, `src/runner/cli.ts`, and `src/memory/modules/dream.ts`.

## 💳 Plans (`src/plans.ts`)

The plan definitions themselves live in `@sayabot/core` (`packages/core/src/edition.ts`): `PlanId = "free" | "pro" | "team"`, with monthly `serverTurnsPerMonth` limits **300 / 3 000 / 15 000** (plus `agents` 3/20/∞, `computers` 0/2/10, `members` 3/5/50):

| Plan | Price | `serverTurnsPerMonth` | Agents | Computers | Members |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Free | $0 | 300 | 3 | 0 | 3 |
| Pro | $12 | 3 000 | 20 | 2 | 5 |
| Team | — | 15 000 | ∞ (`null`) | 10 | 50 |

`null` means unlimited. The `serverTurnsPerMonth` docstring defines the metric precisely (`edition.ts:36-39`): "Agent replies a month that run on the server (server models, your keys, agent computers). Replies that run on the person's own Mac don't count: they cost the server almost nothing."

Limits only exist on the **`cloud` edition** — `readEdition(env)` checks `SAYABOT_EDITION` (or `NEXT_PUBLIC_SAYABOT_EDITION` in the browser build); anything other than the literal `"cloud"` (case-insensitive) is `self-hosted`, "no plans, no limits, no billing" (`edition.ts:1-24`). `effectivePlan(plan, status)` demotes a paid plan to `free` unless the subscription status is `active`, `trialing`, or `past_due` (`edition.ts:103-108`). The generic `checkLimit(edition, plan, kind, used)` helper exists for the other limit kinds (`agents`, `computers`, `members`) and always allows on self-hosted.

### `workspacePlan(orgId)` (`plans.ts:25-32`)

Reads the org's `org_plans` row; missing/unknown plan → `"free"`:

```typescript
const [row] = await getDb()
  .select({ plan: orgPlans.plan, status: orgPlans.status })
  .from(orgPlans).where(eq(orgPlans.orgId, orgId)).limit(1)
return effectivePlan(isPlanId(row?.plan) ? row.plan : "free", row?.status ?? "active")
```

### `admitServerTurn(orgId)` (`plans.ts:35-59`)

The gate for agent replies that run on the server, called at the top of the engine (`src/engine/index.ts:29-30`):

1. **Self-hosted → always allowed** (`readEdition(process.env) !== "cloud"`).
2. Loads the plan and its `serverTurnsPerMonth` limit, then runs an atomic SQL counter:

```sql
select allowed, used from public.bump_server_turns(${orgId}::uuid, ${usageMonth()}, ${limit})
```

`bump_server_turns` (`packages/db/sql/0033_cloud_plans.sql:49-77`, `security definer`, executable only by `service_role`) upserts the org's `org_usage_monthly` row for the UTC calendar month (`usageMonth()` → `"2026-11"`) and increments `server_turns` **only when** `server_turns < limit` — the conditional `UPDATE` returning is the whole admission decision, race-free without an application-level lock. `limit = null` means unlimited.

3. **Denied** replies build a human message from `limitMessage("serverTurnsPerMonth", plan, limit)` ("This workspace has used its 300 server replies for this month on the Free plan."), a note that "Agents that run on your Mac keep working, with no limit.", and an upgrade pointer from `upgradeFor(plan, "serverTurnsPerMonth", limit + 1)` — the next plan whose limit lifts it — linking to `/[org]/settings/billing` (prefixed with `SAYABOT_DOMAIN` when set) or "The count starts again on the 1st of next month." when no upgrade exists.

### `planLimitTurn(args, message)` (`plans.ts:62-105`)

The denied reply is *an ordinary-looking agent message*, not an error: it records an `agent_runs` row with `engine: "plan-limit"`, `finishReason: "plan_limit"`, posts the message as the agent (`metadata.planLimit: true`), links it to the run, and broadcasts `message.done` — so the room sees a friendly note and the UI's usage dashboards see the refusals too. Returns the same `TurnResult` shape as a real turn (`{ messageId, runId, content, error: null, aborted: false }`).

## 🧪 Tests

| Test file | Covers |
| :--- | :--- |
| `apps/orchestrator/src/usage.test.ts` | Token normalization and pricing fallback (`priceUsage`, `tokensFrom`, cache reset). |
| `apps/orchestrator/src/plans.test.ts` | Plan admission messaging (`admitServerTurn` composition, `upgradeFor`, `limitMessage`). |
| `packages/core/src/edition.test.ts` | Edition detection, `effectivePlan`, `checkLimit`, `usageMonth`. |

There is no `push.test.ts`; push is exercised indirectly through the approval tests in `apps/orchestrator/src/tools/audited.test.ts`.

---

Related docs:
- [Collab & task board](./collab-tasks.md) — the `notifyHumansNeeded` call sites (stuck tasks, human decisions)
- [Scheduler: Routines](./scheduler-routines.md) — `notifyRoutineFinished` producer
- [Approvals](../tools/approvals.md) — the approval cards the push actions answer
- [Engine loop](../engine/engine-loop.md) — where `admitServerTurn` gates server replies
