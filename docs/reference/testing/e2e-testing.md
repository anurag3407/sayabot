# E2E Testing (Playwright)

The Playwright suite lives in `e2e/` at the repo root and covers the system the way users hit it: real browser sessions against the running web app and orchestrator, backed by a real Supabase project. A **seeded browser lane** (`chat`, `turns`, `approval`) needs Supabase credentials and provisions users, orgs, rooms, agents, and pending approvals through the service-role key; a **smoke lane** (`api/health.spec.ts`, `navigation.spec.ts`, `api-guard.spec.ts`) needs only running HTTP servers and is what CI executes.

Source files: `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/fixtures.ts`, `e2e/navigation.spec.ts`, `e2e/chat.spec.ts`, `e2e/turns.spec.ts`, `e2e/approval.spec.ts`, `e2e/api-guard.spec.ts`, `e2e/api/health.spec.ts`, `tsconfig.e2e.json`

---

## ⚙️ Playwright Setup (`playwright.config.ts`)

```typescript
testDir: "./e2e"
fullyParallel: false, workers: 1          // rooms and shared seed state are order-sensitive
timeout: 180_000                          // agent turns can take minutes
expect: { timeout: 20_000 }
globalSetup: smokeOnly ? undefined : "./e2e/global-setup.ts"
reporter: [["list"]]
trace / video: "retain-on-failure"
viewport: { width: 1440, height: 900 }
```

Two knobs drive everything (`playwright.config.ts:4-8,16`):

- `E2E_SMOKE=1` — smoke lane. Disables `globalSetup` (no Supabase seeding), drops the orchestrator `webServer`, and the root script `pnpm test:e2e:api` additionally restricts tests to `api navigation.spec.ts api-guard.spec.ts`.
- `E2E_BASE_URL` (default `http://localhost:3000`) and `ORCHESTRATOR_URL` (default `http://localhost:4000`) — targets.

`webServer` entries start missing services automatically with `reuseExistingServer: true`: always `pnpm --filter @sayabot/web dev` (URL-checked against `baseURL`, 180s timeout) and, outside smoke mode, `pnpm --filter @sayabot/orchestrator dev` (checked against `/health`) — so `pnpm e2e` boots what it needs but reuses a dev stack you already have running. One Chromium project only.

Type safety: `pnpm typecheck:e2e` runs `tsc -p tsconfig.e2e.json` over the specs; CI does exactly this after the unit/integration lanes without executing browsers (`.github/workflows/test.yml:26`).

## 🌱 Seeding (`e2e/global-setup.ts`)

Runs before the seeded specs (skipped entirely in smoke mode). Requires in `.env`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `E2E_USER_A_EMAIL`, `E2E_USER_B_EMAIL` — it throws with those exact names if any are missing (global-setup.ts:12-17). Using the service-role admin client it:

1. **Ensures two users** ("Ada E2E", "Bilal E2E") — paginates `auth.admin.listUsers` (10 pages x 200) or creates the user with a confirmed random password, then upserts `profiles.display_name` (global-setup.ts:23-52).
2. **Ensures the org** `E2E_ORG_SLUG` (default `mesh-e2e`, name "Mesh E2E") and memberships: user A `owner`, user B `member` in `org_members` (global-setup.ts:54-84).
3. **Wipes and recreates fixtures** — deletes all `rooms`, `agents`, `mcp_servers` for the org (so runs are repeatable), then inserts:
   - `e2e-general` room: private, `turn_mode: "mentions"`, **`turn_cap: 3`**; `e2e-cap` room: same but **`turn_cap: 1`**.
   - `room_members` rows (A admin, B member in both rooms).
   - Two LLM agents `e2e-a` and `e2e-b` with one-sentence system prompts, added to both rooms at positions 0/1 — deliberately with `model: null, provider_key_id: null` so no LLM provider is needed.
   - Two `tool_calls` rows named `github_bridge` (`commit_file` action) with `status: "pending_approval"` — one to approve, one to reject (global-setup.ts:164-189).
4. **Writes `.e2e-state.json`** in the repo root: `{baseURL, orgSlug, orgId, generalRoomId, capRoomId, emailA, emailB, approveToolCallId, rejectToolCallId}` — the contract consumed by `fixtures.ts`.

## 🧰 Fixtures (`e2e/fixtures.ts`)

A thin layer over Playwright's base test:

- `state()` — reads and caches `.e2e-state.json` (fixtures.ts:20-27).
- `admin()` — service-role Supabase client (no session persistence).
- **`signIn(page, email)`** (fixtures.ts:39-55) — passwordless auth: `auth.admin.generateLink({ type: "magiclink" })` with `redirectTo: <baseURL>/auth/complete`, then `page.goto(action_link)` and wait until the URL leaves `/auth` (60s). This avoids email delivery entirely.
- `openRoom(page, roomId)` — navigates to `/{orgSlug}/r/{roomId}` and waits for the `[data-testid="composer"]` (30s).
- `send(page, content)` — fills `composer` and clicks `send-message`.

The specs rely on stable test IDs: `composer`, `send-message`, `message` (with `data-sender-type` / `data-sender-handle` / `data-status` attributes), `system-message`, `approval-card` (with `data-tool-call-id`), `tool-call`, `approve-tool`, `reject-tool`.

## 🧭 What Each Spec Covers

### `navigation.spec.ts` — unauthenticated navigation matrix

Parameterized over two route lists (navigation.spec.ts:5-6): the 10 **public** paths (`/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/terms`, `/privacy`, `/security`, `/help`, `/offline`) must render without redirecting to `/login` (enforced by `proxy.ts` middleware); the 2 **protected** paths (`/onboarding`, `/new-workspace`) must redirect signed-out users to `/login`. Plus: unknown routes return HTTP 404, and the landing page mentions Sayabot.

### `chat.spec.ts` — multiplayer realtime delivery

Opens **two separate browser contexts** signed in as users A and B in `e2e-general`. A sends a timestamped message; it must appear for B within 30s, and vice versa — the end-to-end proof of Supabase realtime broadcast delivery to a second session (chat.spec.ts:3-29).

### `turns.spec.ts` — deterministic multi-agent turns

- **Sequential mention order**: sends `@e2e-a @e2e-b ...` in `e2e-general`; asserts the first two agent messages complete (up to 150s each — real turn duration) and their `data-sender-handle` values are exactly `["e2e-a", "e2e-b"]` in order, and that **no** "turn cap" system message appears (turns.spec.ts:3-22).
- **Turn cap enforcement**: in `e2e-cap` (`turn_cap: 1`), the same double mention must produce a system message containing "turn cap of 1", exactly one agent message, and it must be from `e2e-a` (turns.spec.ts:24-36) — the visible behavior of the coordinator's cap logic.

### `approval.spec.ts` — human-in-the-loop gates

Signs in as user A (the admin) in `e2e-general`, where seeding pre-created two `pending_approval` `github_bridge` tool calls. Clicks `approve-tool` on the first card and expects the corresponding `tool-call` element to show `data-status="approved"`; clicks `reject-tool` on the second and expects `data-status="rejected"` (approval.spec.ts:3-28). This exercises the full approval round-trip: card visibility → decision → status broadcast back into the room.

### `e2e/api-guard.spec.ts` — auth guards without a session

Plain API matrix against the web app: `POST /api/messages` without a session is 401 (400 tolerated when the session layer is stubbed); `POST /api/push` is strictly 401; `GET /api/v1/definitely-not-a-route` is not 200; and `GET /api/health` stays public with `cache-control: no-store` (api-guard.spec.ts:7-27).

### `e2e/api/health.spec.ts` — service health contracts

Contract checks across all four services, header comment noting it "runs in the smoke lane too" (health.spec.ts:3-5):

- **web** `/api/health` → `{ok: true, service: "sayabot-web"}` (always runs).
- **orchestrator** `/health` → `{ok: true, service: "sayabot-orchestrator"}` plus a numeric `activeRuns` — skipped in smoke mode.
- **computerd** `/health` is public (`service: "computerd"`) while `POST /v1/computers/a1/ensure` is **401** without the internal secret — skipped in smoke mode.
- **egress** `/health` → `{service: "egress"}` — skipped in smoke mode.
- Orchestrator `/internal/room-message` rejects unauthenticated callers (401) — skipped in smoke mode.
- Public/protected page behavior (no `/login` bounce on `/`, heading on `/login`, `/terms` title, protected page returns 200/307/308).
- `/.well-known/oauth-authorization-server` returns 200 with `S256` among `code_challenge_methods_supported`.

## ▶️ How to Run

```bash
# Full seeded browser lane — needs Supabase + E2E_USER_* env, boots web+orchestrator
pnpm e2e            # or: pnpm test:e2e

# API smoke lane — only needs the web server (starts it for you), no Supabase seeding
pnpm test:e2e:api   # E2E_SMOKE=1 playwright test api navigation.spec.ts api-guard.spec.ts

# Typecheck the specs without running them
pnpm typecheck:e2e
```

Environment for the full lane (read from `.env` by `dotenv/config` in the config and global setup):

| Variable                                                | Read by                | Purpose                                             |
| :------------------------------------------------------ | :--------------------- | :-------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | global-setup, fixtures | Supabase admin client for seeding and magic links   |
| `E2E_USER_A_EMAIL`, `E2E_USER_B_EMAIL`                  | global-setup           | the two seeded users (A = owner/admin, B = member)  |
| `E2E_ORG_SLUG`                                          | global-setup           | org slug, default `mesh-e2e`                        |
| `E2E_BASE_URL`                                          | config, specs          | web target, default `http://localhost:3000`         |
| `ORCHESTRATOR_URL`, `COMPUTERD_URL`, `EGRESS_URL`       | `api/health.spec.ts`   | service targets, defaults `:4000`, `:4100`, `:8081` |
| `E2E_SMOKE`                                             | config, root script    | selects the smoke lane                              |

CI runs only `pnpm test:e2e:api` (and `continue-on-error: true` at that) plus `pnpm typecheck:e2e` — the seeded lane is a local activity because it mutates a real Supabase project.

Note the seeded lane is **stateful by design**: `global-setup.ts` deletes the org's rooms/agents on every run, rooms have `turn_cap` 3/1, and `.e2e-state.json` pins the tool-call IDs — re-running mid-run or pointing two runs at the same project concurrently will interfere (hence `workers: 1, fullyParallel: false`).

## 🐞 Debugging Failures

The config sets `trace: "retain-on-failure"` and `video: "retain-on-failure"` with the `list` reporter, so after a failing run the artifacts are under `playwright-report/` and `test-results/` in the repo root (standard Playwright layout); open the trace with `pnpm exec playwright show-trace <trace.zip>`. Because the seeded specs wait on real agent turns, the two most common non-product failures are timing (the 150s turn timeouts in `turns.spec.ts` exist because LLM-backed turns can be slow) and Supabase state (a stale org from a previous run is wiped by `global-setup.ts`, but a _concurrent_ run is not). `.e2e-state.json` is also handy for manual inspection — the approve/reject tool-call IDs in it can be cross-checked against `tool_calls` rows in Supabase.

---

## Related docs

- [overview.md](overview.md) — lane map and CI
- [integration-testing.md](integration-testing.md) — mocked cross-module suites
- [unit-testing.md](unit-testing.md) — colocated unit conventions
- [../../testing.md](../../testing.md) — top-level testing guide
- [../operations/troubleshooting.md](../operations/troubleshooting.md) — realtime/approval failure modes the specs would surface
