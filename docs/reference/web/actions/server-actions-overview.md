# Server Actions Overview

Every mutation in the Sayabot web app runs as a Next.js server action under `apps/web/src/lib/actions/`. All actions share one contract — they receive either a `FormData` payload or a plain object, return an `ActionResult`, re-check org/room access themselves, write through the service-role Supabase admin client, record an audit log entry, and revalidate the workspace layout. This page documents that shared pattern and the small client used to call the orchestrator's internal API.

Source files: `apps/web/src/lib/actions/shared.ts`, `apps/web/src/lib/orchestrator.ts`, `apps/web/src/lib/auth.ts`, `apps/web/src/lib/types.ts`, `apps/web/src/lib/env.ts`, `apps/web/src/lib/supabase/admin.ts`

---

## 📦 The `ActionResult` contract

Every server action resolves to the same serializable shape (`apps/web/src/lib/types.ts:462`):

```typescript
export interface ActionResult {
  ok: boolean
  error?: string
  message?: string
  warning?: string
  data?: Record<string, unknown>
}
```

Two constructors in `apps/web/src/lib/actions/shared.ts:8` build it:

- `ok(message?, data?)` — success, with an optional toast message and extra payload (ids, tokens, paths).
- `fail(error)` — failure with a human-readable error string.

Client components feed this into `useActionState`, which is why the canonical form-action signature is:

```typescript
(_prev: ActionResult | null, formData: FormData): Promise<ActionResult>
```

(e.g. `apps/web/src/lib/actions/rooms.ts:22`, `apps/web/src/lib/actions/agents.ts:76`). Actions invoked from buttons or dialogs instead of forms take a plain typed-object argument and return the same `ActionResult` (e.g. `deleteRoomAction` at `apps/web/src/lib/actions/rooms.ts:364`, `createBotAction` at `apps/web/src/lib/actions/agents.ts:294`).

`warning` is a soft-failure variant: the action succeeded but degraded. `createBotAction` uses it when the plan does not cover a computer — the bot is still created but `capabilities.computer` is dropped and `warning` explains why (`apps/web/src/lib/actions/agents.ts:439`).

---

## 🧰 Shared helpers (`shared.ts`)

| Helper                          | Location        | Purpose                                                                                                                                                                                                                                                                                  |
| :------------------------------ | :-------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `field(form, name)`             | `shared.ts:16`  | Reads a form field as a trimmed string, non-strings become `""`.                                                                                                                                                                                                                         |
| `optionalField(form, name)`     | `shared.ts:21`  | Same, but empty string becomes `null`.                                                                                                                                                                                                                                                   |
| `parseJsonObject(text)`         | `shared.ts:26`  | Parses a JSON-object text field (agent `params`, connector config) and rejects arrays/non-objects.                                                                                                                                                                                       |
| `errorMessage(error)`           | `shared.ts:39`  | Normalizes anything thrown by Supabase into a string.                                                                                                                                                                                                                                    |
| `slugify(value)`                | `shared.ts:47`  | Lowercase, non-alphanumerics to `-`, trimmed, max 48 chars.                                                                                                                                                                                                                              |
| `uniqueOrgSlug(base)`           | `shared.ts:62`  | Slug generator for new workspaces: tries `root`, `root-2`, … `root-51`, skipping the `RESERVED_SLUGS` set (`api`, `auth`, `login`, `onboarding`, `privacy`, `terms`, …, `shared.ts:57`), falling back to a base36 timestamp suffix.                                                      |
| `adminOrgAccess(slug)`          | `shared.ts:74`  | Loads `OrgAccess` and requires the caller to be an org admin (`owner` or `admin`, see `isOrgAdmin` at `apps/web/src/lib/auth.ts:111`). Returns `{ access }` or `{ error }`.                                                                                                              |
| `adminRoomAccess(slug, roomId)` | `shared.ts:83`  | Loads `RoomAccess` and requires `access.canAdmin` — a room-level `admin` role or an org admin (`apps/web/src/lib/auth.ts:172`).                                                                                                                                                          |
| `audit(args)`                   | `shared.ts:93`  | Inserts a row into `audit_logs` with `org_id`, `actor_type` (default `"user"`), `actor_id`, `action`, `target`, `metadata`. Failure is logged, never thrown — audit must not break the mutation.                                                                                         |
| `revalidateOrg(orgSlug)`        | `shared.ts:116` | Calls `revalidatePath("/" + orgSlug, "layout")` so every server-rendered page in the workspace refreshes. The action's response already carries the re-rendered page, so client callers must **not** follow it with `router.refresh()` (that renders the whole workspace a second time). |

---

## 🔐 Auth checks and org scoping

Server actions are reachable by any authenticated (or even anonymous) browser, so every action re-establishes authorization from scratch — there is no layout-level guarantee a page check ran first (`apps/web/src/lib/auth.ts:119` documents the same rule for pages).

The resolution chain in `apps/web/src/lib/auth.ts`:

1. `getCurrentUser()` (`auth.ts`) — Supabase session user from the cookie-bound server client, memoised per request with React `cache()`.
2. `requireUser(nextPath?)` (`auth.ts:15`) — redirects to `/login` (with a `next` param) when there is no session.
3. `getOrgAccess(slug)` (`auth.ts`) — joins `org_members` with `orgs` on the caller's user id; returns `null` for non-members. Without `options` the lookup is shared per request (`cache()`). The result carries the org, the caller's `OrgRole`, and the profile.
4. `getRoomAccess(slug, roomId)` (`auth.ts:125`) — resolves the room within the org plus the caller's `room_members` row; `canAdmin` is true for room admins and org admins.

Actions then pick their gate:

- Org-admin mutations (agents, connectors, keys, workspace settings) call `adminOrgAccess`.
- Room mutations (room settings, members, agents in rooms) call `adminRoomAccess`.
- Member-level reads and self-service actions (profile, facts, message sends) call `getOrgAccess` / `getRoomAccess` directly and check membership as needed.

### Why queries are re-scoped manually

All writes go through `createAdminClient()` (`apps/web/src/lib/supabase/admin.ts:7`), a cached Supabase client built with `SUPABASE_SERVICE_ROLE_KEY`. It bypasses Row Level Security, so the access checks above are the only thing standing between the caller and another tenant's data. The consistent idiom is: resolve the row, compare its `org_id` against `check.access.org.id`, and `fail("... not found")` on mismatch (e.g. `apps/web/src/lib/actions/agents.ts:176`, `apps/web/src/lib/actions/bots.ts:23`). Row-level authorization errors deliberately return generic "not found" messages instead of "not yours".

---

## ✅ Validation conventions

Validation happens inline with Zod before any write:

- Enum fields are parsed with `z.enum(...).safeParse` (room kind and turn mode at `apps/web/src/lib/actions/rooms.ts:31`, agent kind at `apps/web/src/lib/actions/agents.ts:83`).
- Numeric ranges use `z.coerce.number()` with min/max (turn cap 1–10, RPM 1–1000, daily budget 0–1,000,000 at `apps/web/src/lib/actions/rooms.ts:130`).
- Handles must match `/^[a-z][a-z0-9-]{0,38}$/` and dodge the reserved set `all_bots`, `human`, `system`, `moderator` (`apps/web/src/lib/actions/agents.ts:35`).
- JSON object fields go through `parseJsonObject` rather than a bare `JSON.parse`.
- Postgres `23505` (unique violation) is translated into a friendly message such as "`@handle` already exists" (`apps/web/src/lib/actions/agents.ts:119`).

Multi-step mutations undo themselves on partial failure: `createRoom` deletes the room if member insertion fails (`apps/web/src/lib/actions/rooms.ts:94`), and approving a bot invite deletes the created agent if the invite row can no longer be claimed (`apps/web/src/lib/actions/bot-invites.ts:176`).

---

## 🌉 Calling the orchestrator (`lib/orchestrator.ts`)

Web mutations that must trigger engine work go through `apps/web/src/lib/orchestrator.ts`. It is a thin internal-API client: every call is a `POST` with JSON to `ORCHESTRATOR_URL` (default `http://localhost:4000`, trailing slashes stripped — `apps/web/src/lib/env.ts:35`), authenticated with the `x-internal-secret` header carrying `ORCHESTRATOR_INTERNAL_SECRET` (`apps/web/src/lib/env.ts:43`), `cache: "no-store"`, and an `AbortSignal.timeout`.

Two wrappers exist:

- `callOrchestrator(path, body, timeoutMs = 15_000)` (`orchestrator.ts:4`) — ignores the response body, returns `{ ok, status, error? }`. Network/timeout errors yield `status: 0` instead of throwing, so callers decide whether a failure blocks the UI.
- `callOrchestratorJson<T>(path, body, timeoutMs = 15_000)` (`orchestrator.ts:196`) — same transport, parses the JSON reply and hands back `{ ok: true, data }` or `{ ok: false, status, error }`.

### Endpoints invoked from the web app

| Web helper                                                                        | Orchestrator endpoint                              | Used for                                                                                                   |
| :-------------------------------------------------------------------------------- | :------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `queueRoomMessage(roomId, messageId)` (`orchestrator.ts:34`)                      | `POST /internal/room-message`                      | Kicks the turn coordinator after a message row is committed.                                               |
| `stopRunInOrchestrator(runId)` (`orchestrator.ts:38`)                             | `POST /internal/runs/:runId/stop`                  | Halt buttons in traces and rooms.                                                                          |
| `runRoutineInOrchestrator(routineId)` (`orchestrator.ts:42`)                      | `POST /internal/routines/:routineId/run`           | Run-now buttons on routines.                                                                               |
| `testWebSearchInOrchestrator(payload)` (`orchestrator.ts:46`)                     | `POST /internal/tools/test-web-search` (20 s)      | Search-provider settings test.                                                                             |
| `testDocumentOcrInOrchestrator(payload)` (`orchestrator.ts:74`)                   | `POST /internal/tools/test-document-ocr` (25 s)    | Document-tool settings test.                                                                               |
| `testAgentInOrchestrator(agentId, orgId)` (`orchestrator.ts:112`)                 | `POST /internal/agents/:agentId/test` (30 s)       | "Test agent" button; returns reply text, model, latency.                                                   |
| `restoreCanvasInOrchestrator(canvasId, userId, snapshot)` (`orchestrator.ts:147`) | `POST /internal/canvases/:canvasId/restore` (30 s) | Canvas version rollback.                                                                                   |
| `mutateTaskInOrchestrator(input)` (`orchestrator.ts:155`)                         | `POST /internal/tasks/mutate`                      | Task board writes (status, assignment, comments) that must flow through the orchestrator's event pipeline. |
| `recordMacToolEvents(jobId, hostId, events)` (`orchestrator.ts:220`)              | `POST /internal/local-jobs/:jobId/events`          | Tool cards from agents running on a user's Mac.                                                            |
| `requestMacApproval(jobId, hostId, input)` (`orchestrator.ts:228`)                | `POST /internal/local-jobs/:jobId/approval`        | Approval requests raised by Mac-side jobs.                                                                 |

Callers treat orchestrator errors as user-facing `ActionResult` failures (for example `testAgent` maps a failed test to `fail("Agent test failed: …")` with the error scrubbed through `redactSecrets` — `apps/web/src/lib/actions/agents.ts:269`).

---

## ✍️ Mutation conventions in practice

Reading any action file you will find the same sequence:

1. `"use server"` directive as the first line of the module.
2. Gate: `requireUser` for plain authenticated actions, or `adminOrgAccess` / `adminRoomAccess` for admin ones.
3. Validate the payload (Zod or plain length/regex checks) and return `fail(...)` early.
4. Plan gates where quantity is limited (`planGate(orgId, "agents")` before creating agents/bots — `apps/web/src/lib/actions/agents.ts:88`; see the billing reference for details).
5. Write with the admin client, scoped by the org id resolved in step 2, compensating (delete/rollback) when a later step fails.
6. `audit({ orgId, actorId, action: "<domain>.<verb>", target, metadata })`.
7. `revalidateOrg(orgSlug)` so all workspace pages pick up the change.
8. Return `ok(message, data)` — or `redirect(...)` for creates that navigate (`createRoom` ends with `redirect("/" + orgSlug + "/r/" + room.id)`; `redirect` throws, so no return follows — `apps/web/src/lib/actions/rooms.ts:116`).

Secrets never appear in action results in plaintext unless they were just generated for the caller to copy once (webhook secrets and agent API keys return their value exactly once, e.g. `apps/web/src/lib/actions/bots.ts:43`; at-rest secrets are sealed with `sealSecret(..., getKek())` — `apps/web/src/lib/actions/agents.ts:113`).

---

## 🗂️ Action file map

| File                                                                                                                                                   | Domain                                                                   |
| :----------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- |
| `agents.ts`, `bots.ts`, `bot-invites.ts`, `templates.ts`                                                                                               | Agent/bot CRUD, invites, templates                                       |
| `rooms.ts`, `room-state.ts`, `messages.ts`                                                                                                             | Rooms, memberships, message sending                                      |
| `connectors.ts`, `keys.ts`, `vault.ts`, `vector-keys.ts`, `mcp.ts`                                                                                     | Connectors, provider keys, vault, MCP                                    |
| `orgs.ts`, `invites.ts`, `workspace-invites.ts`, `profile.ts`, `facts.ts`, `memory.ts`, `computers.ts`, `onboarding.ts`, `guest-merge.ts`, `phones.ts` | Workspace lifecycle and personal data                                    |
| `tasks.ts`, `canvas.ts`, `trace.ts`, `meetings.ts`, `marketplace.ts`, `desktop.ts`, `auth.ts`                                                          | Task board, canvas, traces, meetings, marketplace, desktop pairing, auth |
| `pricing.ts`                                                                                                                                           | Model pricing table (billing reference)                                  |

Each domain file is documented in the sibling pages of this section.

---

Related docs: [Auth & authorization](../../architecture/auth-and-authorization.md), [Security model](../../architecture/security-model.md), [System overview](../../architecture/system-overview.md), [Agents UI](../pages/agents-ui.md), [Room chat UI](../pages/room-chat-ui.md), [Settings UI](../pages/settings-ui.md)
