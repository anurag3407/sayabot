# Integration Testing

Integration tests verify that Sayabot's modules work **together** while still touching no live infrastructure: the repo-root suite in `tests/integration/` exercises cross-package contracts and the full connector lifecycle against a mocked Drizzle database and a scripted `fetch`, and each app keeps its own package-level integration suites (in-process Hono servers, mocked orchestrator/webhook boundaries). Everything runs through Vitest — no Supabase, no LLM, no Docker required.

Source files: `tests/integration/vitest.config.ts`, `tests/integration/run.mjs`, `tests/integration/connectors.test.ts`, `tests/integration/cross-package.test.ts`, `tests/README.md`, package `tests/integration/` directories

---

## 🎯 What the Lane Covers

Per `tests/README.md`, the integration lane covers "cross-module contracts with in-process HTTP servers + mocked fetch/DB" and needs "none (no live Supabase/LLM)". Two levels exist:

1. **Repo-root suite** (`tests/integration/`) — run by `pnpm test:integration`; currently two files:
   - `connectors.test.ts` (901 lines) — the connector credential/scope/redaction/retry lifecycle.
   - `cross-package.test.ts` (42 lines) — `core ↔ llm ↔ db` contract assertions.
2. **Package-level suites** (`<pkg>/tests/integration/`) — run with the package's ordinary `pnpm --filter <pkg> test` (Vitest default include picks them up): `apps/orchestrator/tests/integration/` has 10 files (`http.test.ts`, `interrupt.test.ts`, `approvals-listener.test.ts`, `bot-reply.test.ts`, `webhook-deliver.test.ts`, `computer-client.test.ts`, `jobs-enqueue.test.ts`, `mcp-tools.test.ts`, `memory-tools.test.ts`, `summarize.test.ts`); `apps/web/tests/integration/` has 9 (API routes, proxy public paths, connectors API, desktop guest flow, message send, orchestrator client); `apps/computerd/tests/integration/` has `computerd-app.test.ts` and the socket-free `agentd-rpc` coverage noted in `tests/README.md`.

## ▶️ How to Run

```bash
pnpm test:integration          # repo-root suite (turbo is not involved)
pnpm --filter @sayabot/orchestrator test tests/integration   # one package's suite
```

`pnpm test:integration` does **not** go through Turborepo: the root script is `node tests/integration/run.mjs` (`package.json:26`), and `run.mjs` spawns the Vitest module **from the orchestrator workspace's node_modules** against the repo root as `--root` (`tests/integration/run.mjs:6-9`):

```js
const vitest = join(root, "apps/orchestrator/node_modules/vitest/vitest.mjs")
spawnSync(process.execPath, [vitest, "run", "--root", join(root, "tests/integration")], ...)
```

The suite's `vitest.config.ts` provides the same source aliasing trick as the web config — `@sayabot/core`, `@sayabot/llm`, `@sayabot/db/schema` resolve to package `src/` files, `drizzle-orm` resolves to the copy inside `packages/db/node_modules`, and test files import app code by relative path (e.g. `../../apps/orchestrator/src/connectors/service`). This is what makes cross-package integration possible without building anything. Environment: `node`; include: `**/*.test.ts`.

The aliasing detail matters for one subtle reason: the root suite imports **three** packages plus app source in one process, and each package resolves its `drizzle-orm` from a different physical copy (`packages/db/node_modules`). Without the explicit `"drizzle-orm"` alias pinning every consumer to a single copy, Drizzle's symbol-based brand checks (the `Symbol(drizzle:Name)` markers `cross-package.test.ts:27-40` walks) would fail across the duplicate module instances.

CI runs this lane in the `unit-integration` job right after `pnpm test` (`.github/workflows/test.yml:25`).

## 📦 Package-Level Integration Suites

Each app mirrors the repo-root pattern one level down. These run with the package's ordinary vitest, so they execute during `pnpm test` too — they are "integration" in scope (several modules collaborating) but still hermetic.

**`apps/orchestrator/tests/integration/` (10 files)** — the boundary between the HTTP engine, the coordinator, and their collaborators:

| File | Verified behavior |
| :--- | :--- |
| `http.test.ts` | drives the real Hono app in-process via `app.request` ("no socket, no DB needed for these routes") with a bare fetch stub keeping stray outbound calls off the network; exercises `createApp` and the `active-runs` registry |
| `interrupt.test.ts` | `handleMidRunInterrupt` against the `active-runs` registry — how a newer human message aborts in-flight runs |
| `approvals-listener.test.ts` | `waitForApproval` with zero DB rows: "the poll path must time out to 'rejected'" — the approval-gate failure path |
| `webhook-deliver.test.ts` | `deliverWebhook` with no agent row is "logged + dropped, no network" |
| `bot-reply.test.ts` | bot reply path with a fully mocked db/pool and `notify` |
| `computer-client.test.ts`, `jobs-enqueue.test.ts`, `mcp-tools.test.ts`, `memory-tools.test.ts`, `summarize.test.ts` | the same seam style for the computer client, pg-boss enqueueing, MCP tool wiring, memory tools, and summarization |

**`apps/web/tests/integration/` (9 files)** — `api-routes`, `connectors-api`, `desktop-guest`, `desktop-refresh`, `guest-merge`, `message-send`, `orchestrator-client`, `proxy-public-paths`, `routines-api`: Next.js route handlers and the web→orchestrator client exercised with mocked upstreams.

**`apps/computerd/tests/integration/`** — `computerd-app.test.ts` and the socket-free agentd RPC coverage that `tests/README.md` calls out as the sandbox-safe replacement for `apps/computerd/test/agentd-exec.test.ts` (whose Unix-socket tests hit `EPERM` under sandboxed macOS shells).

## 🔗 Case Study 1: `cross-package.test.ts` — Contract Tests

The root suite is intentionally small — two files, 943 lines total — so `test:integration` stays fast enough for CI's `unit-integration` job to run it after the full turbo unit fan-out:

| File | Size | Scope |
| :--- | :--- | :--- |
| `connectors.test.ts` | 901 lines | the connector credential/scope/redaction/retry lifecycle (case study 2 below) |
| `cross-package.test.ts` | 42 lines | `core ↔ llm ↔ db` contract assertions (below) |

Since the vitest root is `tests/integration` with include `**/*.test.ts`, adding a new root-level suite requires nothing but dropping the file in — `run.mjs` and the config need no changes.

Four assertions pin the contracts that would silently break the system if drifted (`cross-package.test.ts:8-41`):

- **Mentions**: `extractHandles("please @ada and @bolt review this")` returns `["ada", "bolt"]` — the exact handles the orchestrator will plan turns for.
- **Sealed secrets vs redaction**: a `sealSecret(...)` envelope contains no plaintext, opens back correctly, and `redactSecrets` scrubs raw secrets — proving the two safety layers compose.
- **DB/core enum parity**: the `turn_mode` enum values exported by `@sayabot/db/schema` must equal core's `TURN_MODES` (sorted compare) — a schema change without a core change fails here.
- **snake_case table names**: walks every exported object for Drizzle's `Symbol(drizzle:Name)` marker and asserts all table names match `/^[a-z_]+$/` with more than 15 tables — guarding migration snapshot stability.

## 🔌 Case Study 2: `connectors.test.ts` — Full Connector Lifecycle

The large suite wires the real `ConnectorService` (`apps/orchestrator/src/connectors/service.ts`) to three fake boundaries and asserts end-to-end behavior:

- **Mock DB via Drizzle's own dialect** (`createMockDb`, connectors.test.ts:27-61): instead of hand-faking the query builder, it renders the real Drizzle `PgDialect` SQL for each `where` clause and filters in-memory `workspace_connectors` / `agent_connector_grants` rows by parsing the generated SQL and params. That keeps the mock honest against schema changes.
- **Encrypted fixtures**: connector tokens are encrypted at test setup with `encryptSecret(token, TEST_KEK)` from `@sayabot/llm` (TEST_KEK = `Buffer.alloc(32, 42).toString("base64")`), so the service performs **real** AES-256-GCM decryption on the path under test (connectors.test.ts:73-76).
- **Scripted `fetch` router**: a `vi.fn` fetch maps URLs to canned Google Drive / Slack / GitHub responses and records every `{url, method, headers}` for later assertions (connectors.test.ts:193-411).

The six `describe` blocks then assert the lifecycle:

1. **DB & decryption** (`:415-464`): active connectors decrypt to the original token; missing source throws "No connector configured for 'google_drive' in this workspace."; revoked connectors throw; agents without an explicit grant get "Access Denied: This agent is not granted access to this connector."
2. **Google Drive flow** (`:467-551`): search injects `allowedFolders` scope clauses (`'folder-roadmaps-101' in parents`) into the Drive query; the decrypted bearer token appears in the `Authorization` header; docs export as `text/plain`, sheets as `text/csv`.
3. **Slack flow** (`:554-636`): `allowedChannels` scoping (`in:C01_general`), `<@U111>` mention resolution to `@alice`, explicit-channel parameter outside the grant rejected, thread reads rejected for unauthorized channels.
4. **GitHub flow** (`:639-733`): `repo:sayalabs/...` scoping in code search, base64 file content decoding, issue/PR reads with comments — each rejecting unauthorized repos with the exact "Access Denied" message.
5. **Security & redaction contracts** (`:736-778`): ciphertext/IV/tag and serialized DB rows never contain plaintext tokens; `redactSecrets` maps Slack tokens to `[REDACTED:slack_token]` and GitHub PATs to `[REDACTED:github_token]`; `createRunScrubber([token])` scrubs custom run secrets.
6. **Rate limiter backoff** (`:781-899`): `fetchWithRetry` succeeds without retry; retries 429 honoring `Retry-After`; retries 503; gives up after `maxRetries` (3 total attempts for `maxRetries: 2`); retries transient `ECONNRESET`; and **never** retries `AbortError`.

## 🧯 What the Lane Deliberately Does Not Cover

Being hermetic is the point, but it bounds what these suites can prove:

- **No real SQL execution.** The connector mock DB filters rows by parsing the SQL Drizzle *renders* (`dialect.sqlToQuery`) — the query shape is verified, but indexes, RLS policies, and triggers never run. Those paths are only exercised against a real Postgres in deployment.
- **No realtime authorization.** Private-channel access depends on RLS on `realtime.messages` (`packages/db/sql/0003_realtime.sql`), which needs a live Postgres + Supabase; the browser-side proof lives in the e2e `chat.spec.ts` instead.
- **No multi-instance behavior.** Room advisory locks, pg-boss retry scheduling across processes, and LISTEN/NOTIFY fan-out are mocked at the pool boundary (`approvals-listener.test.ts` stubs `getPool` with an inert connection), so serialization bugs between orchestrator instances are out of scope here.
- **No outbound network.** Every suite injects a `fetchFn` or stubs global fetch; an integration test that hits the network is a bug by the repo's own conventions.

## 🧪 How to Write a New Integration Test

Follow the established seams (`tests/README.md` conventions apply verbatim):

1. **Choose the level**: cross-package contract → `tests/integration/`; single-app module graph → the package's own `tests/integration/` (e.g. an in-process Hono app like `apps/orchestrator/tests/integration/http.test.ts`).
2. **Fake boundaries, not internals**: inject a `fetchFn` where the module accepts one (connectors), `vi.mock("../db")` where it doesn't, and use Drizzle's `PgDialect` if you need SQL-accurate DB stubs.
3. **Encrypt fixtures with a deterministic test KEK** (`Buffer.alloc(32, n).toString("base64")`) — never hardcode plaintext secrets into fixtures that flow through serialization assertions.
4. **Assert authorization boundaries explicitly** — the connector suite's value is as much in its "Access Denied" paths as in its happy paths.
5. Run:
   ```bash
   pnpm test:integration
   ```
   or, while iterating on one file: `pnpm --filter @sayabot/orchestrator exec vitest run --root tests/integration connectors.test.ts`.

---

## Related docs

- [overview.md](overview.md) — lanes, CI ordering, runner details
- [unit-testing.md](unit-testing.md) — colocated unit conventions
- [e2e-testing.md](e2e-testing.md) — full-stack Playwright journeys
- [../../testing.md](../../testing.md) — top-level testing guide
- [../operations/troubleshooting.md](../operations/troubleshooting.md) — the KEK/decryption behavior these tests pin down
