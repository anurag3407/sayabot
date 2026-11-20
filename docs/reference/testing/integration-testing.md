# Integration Testing

Integration tests verify that Sayabot's modules work **together** while still touching no live infrastructure: the repo-root suite in `tests/integration/` exercises cross-package contracts and the full connector lifecycle against a mocked Drizzle database and a scripted `fetch`, and each app keeps its own package-level integration suites (in-process Hono servers, mocked orchestrator/webhook boundaries). Everything runs through Vitest — no Supabase, no LLM, no Docker required.

Source files: `tests/integration/vitest.config.ts`, `tests/integration/run.mjs`, `tests/integration/connectors.test.ts`, `tests/integration/connectors-stub.test.ts`, `tests/integration/connector-dispatch.test.ts`, `tests/integration/connector-turn.test.ts`, `tests/integration/connector-fixtures.ts`, `tests/integration/cross-package.test.ts`, `apps/web/tests/integration/connector-probe.test.ts`, `apps/web/tests/integration/mcp-marketplace.test.ts`, `tests/README.md`, package `tests/integration/` directories

---

## 🎯 What the Lane Covers

Per `tests/README.md`, the integration lane covers "cross-module contracts with in-process HTTP servers + mocked fetch/DB" and needs "none (no live Supabase/LLM)". Two levels exist:

1. **Repo-root suite** (`tests/integration/`) — run by `pnpm test:integration`; currently five files (58 passing tests):
   - `connectors.test.ts` (936 lines) — the connector credential/scope/redaction/retry lifecycle against a scripted `fetch`.
   - `connectors-stub.test.ts` (1123 lines) — every native source driven end to end against a local stub vendor over real HTTP (see case study 3 below).
   - `connector-dispatch.test.ts` (533 lines) — every connector source through the real agent tool registry and audited dispatch: registration, danger flags, approval gate, refusals (case study 4 below).
   - `connector-turn.test.ts` (690 lines) — every connector source through a real engine turn with a scripted model: tool list handed to the model, emitted call, approval, result back into the conversation (case study 5 below). `connector-fixtures.ts` holds the stub vendor and in-memory DB both suites share.
   - `cross-package.test.ts` (46 lines) — `core ↔ llm ↔ db` contract assertions.
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

`ai/test` (the scripted `MockLanguageModelV4` the turn suite drives the engine with) is resolved through the orchestrator's own dependency with `createRequire`, so the test and the engine share one copy of the AI SDK.

The subpath aliases (`@sayabot/llm/models`, `@sayabot/llm/models/effort`, `@sayabot/llm/local-apps`) must be declared **before** the bare `@sayabot/llm` alias: the bare one points at a file, so a subpath import would otherwise resolve to `index.ts/models` once a suite reaches the orchestrator's tool registry.

The aliasing detail matters for one subtle reason: the root suite imports **three** packages plus app source in one process, and each package resolves its `drizzle-orm` from a different physical copy (`packages/db/node_modules`). Without the explicit `"drizzle-orm"` alias pinning every consumer to a single copy, Drizzle's symbol-based brand checks (the `Symbol(drizzle:Name)` markers `cross-package.test.ts:27-40` walks) would fail across the duplicate module instances.

CI runs this lane in the `unit-integration` job right after `pnpm test` (`.github/workflows/test.yml:25`).

## 📦 Package-Level Integration Suites

Each app mirrors the repo-root pattern one level down. These run with the package's ordinary vitest, so they execute during `pnpm test` too — they are "integration" in scope (several modules collaborating) but still hermetic.

**`apps/orchestrator/tests/integration/` (10 files)** — the boundary between the HTTP engine, the coordinator, and their collaborators:

| File                                                                                                                | Verified behavior                                                                                                                                                                                                            |
| :------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http.test.ts`                                                                                                      | drives the real Hono app in-process via `app.request` ("no socket, no DB needed for these routes") with a bare fetch stub keeping stray outbound calls off the network; exercises `createApp` and the `active-runs` registry |
| `interrupt.test.ts`                                                                                                 | `handleMidRunInterrupt` against the `active-runs` registry — how a newer human message aborts in-flight runs                                                                                                                 |
| `approvals-listener.test.ts`                                                                                        | `waitForApproval` with zero DB rows: "the poll path must time out to 'rejected'" — the approval-gate failure path                                                                                                            |
| `webhook-deliver.test.ts`                                                                                           | `deliverWebhook` with no agent row is "logged + dropped, no network"                                                                                                                                                         |
| `bot-reply.test.ts`                                                                                                 | bot reply path with a fully mocked db/pool and `notify`                                                                                                                                                                      |
| `computer-client.test.ts`, `jobs-enqueue.test.ts`, `mcp-tools.test.ts`, `memory-tools.test.ts`, `summarize.test.ts` | the same seam style for the computer client, pg-boss enqueueing, MCP tool wiring, memory tools, and summarization                                                                                                            |

**`apps/web/tests/integration/` (11 files)** — `api-routes`, `connectors-api`, `connector-probe`, `mcp-marketplace`, `desktop-guest`, `desktop-refresh`, `guest-merge`, `message-send`, `orchestrator-client`, `proxy-public-paths`, `routines-api`: Next.js route handlers and the web→orchestrator client exercised with mocked upstreams, plus the real connector probe and MCP client against local stub servers.

**`apps/computerd/tests/integration/`** — `computerd-app.test.ts` and the socket-free agentd RPC coverage that `tests/README.md` calls out as the sandbox-safe replacement for `apps/computerd/test/agentd-exec.test.ts` (whose Unix-socket tests hit `EPERM` under sandboxed macOS shells).

## 🔗 Case Study 1: `cross-package.test.ts` — Contract Tests

The root suite stays deliberately thin — five files, ~4 000 lines, running in a few seconds — so `test:integration` stays fast enough for CI's `unit-integration` job to run it after the full turbo unit fan-out:

| File                         | Size       | Scope                                                                                     |
| :--------------------------- | :--------- | :---------------------------------------------------------------------------------------- |
| `connectors.test.ts`         | 936 lines  | the connector credential/scope/redaction/retry lifecycle (case study 2 below)             |
| `connectors-stub.test.ts`    | 1123 lines | every native source against a stub vendor over real HTTP (case study 3 below)             |
| `connector-dispatch.test.ts` | 533 lines  | every connector source through the real tool registry and audited dispatch (case study 4) |
| `connector-turn.test.ts`     | 690 lines  | every connector source through a real engine turn with a scripted model (case study 5)    |
| `connector-fixtures.ts`      | 656 lines  | shared stub vendor, in-memory DB and sealed workspace for cases 4 and 5                   |
| `cross-package.test.ts`      | 46 lines   | `core ↔ llm ↔ db` contract assertions (below)                                             |

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
2. **Google Drive flow** (`:467-551`): search injects `allowedFolders` scope clauses (`'folder-roadmaps-101' in ancestors`, so nested files are found too) into the Drive query; the decrypted bearer token appears in the `Authorization` header; docs export as `text/plain`, sheets as `text/csv`.
3. **Slack flow** (`:554-636`): `allowedChannels` scoping (`in:C01_general`), `<@U111>` mention resolution to `@alice`, explicit-channel parameter outside the grant rejected, thread reads rejected for unauthorized channels.
4. **GitHub flow** (`:639-733`): `repo:sayalabs/...` scoping in code search, base64 file content decoding, issue/PR reads with comments — each rejecting unauthorized repos with the exact "Access Denied" message.
5. **Security & redaction contracts** (`:736-778`): ciphertext/IV/tag and serialized DB rows never contain plaintext tokens; `redactSecrets` maps Slack tokens to `[REDACTED:slack_token]` and GitHub PATs to `[REDACTED:github_token]`; `createRunScrubber([token])` scrubs custom run secrets.
6. **Rate limiter backoff** (`:781-899`): `fetchWithRetry` succeeds without retry; retries 429 honoring `Retry-After`; retries 503; gives up after `maxRetries` (3 total attempts for `maxRetries: 2`); retries transient `ECONNRESET`; and **never** retries `AbortError`.

## 🛰️ Case Study 3: `connectors-stub.test.ts` — Stub Vendor, Real Wiring

`connectors.test.ts` mocks `fetch`, which proves payload parsing but not the wiring between the pieces: which connector the agent was granted, which URL the client built, whether the scope check ran before the request. `connectors-stub.test.ts` closes that gap by replacing the vendor with a real HTTP server on `127.0.0.1`:

- **Four real boundaries**: the actual `ConnectorService` (with `endpoints` pointed at the stub), real AES-256-GCM decryption, a Drizzle-`PgDialect` in-memory DB holding `workspace_connectors` / `agent_connector_grants` / `messaging_inbound`, and real `fetch` from the client libraries. Only the vendor is fake.
- **Per source, one flow**: `connectorTools()` builds the agent's tools from the grant, the connector table is asserted, the tool executes, and the request that reached the stub is checked (path, query, auth header). Grant/scope refusals are asserted to throw **before** any request is recorded.
- **Storage-target resolution**: a workspace with two active storage connectors proves the connector the agent was _granted_ is the one used (`getStorageTarget`), with its `allowedPrefixes` enforced.
- **Telegram webhook mode**: a bot with an active webhook cannot `getUpdates`, so reads fall back to the messages already delivered to the room.
- **Composio**: the connected-apps catalog through a stub API — app list with connection status, tool search with write flags, an execution whose body carries `user_id: "org:<orgId>"` (never a caller-supplied one), a connect link, an `allowedApps` refusal that issues no request, and a `readOnly` grant that blocks `GMAIL_SEND_EMAIL` while `GMAIL_FETCH_EMAILS` runs.
- **Jira**: asserted to have no native tools — `connectorTools` returns `[]` — while still decrypting for the settings test; the Atlassian marketplace app is the route.

## 🧭 Case Study 4: `connector-dispatch.test.ts` — The Agent's Own Tool Path

`connectors-stub.test.ts` calls `connectorTools(...)` directly. The agent never does: it goes through `buildTools()` (grants → registered specs → `toAuditedTools`) and the model calls `tools[name].execute(...)`. That middle layer is where a tool can silently disappear:

- **Registration is asserted per source.** The suite builds the tool set for an agent granted every source and checks the exact tool names the table in [tool-connectors.md](../orchestrator/tools/tool-connectors.md) promises — including all four `composio_*` tools and the four `storage_*` tools — and the `dangerous` flag of every one (writes and password reads `true`; searches/reads `false`). `builtin-specs.test.ts` in the orchestrator package catches a spec with no `execute`; this catches an `execute` with no spec.
- **Dispatch, not a function call.** Each tool runs through the audited wrapper with a real audit row in a fake `tool_calls` table, so a successful call is asserted to end `status: "done"`, and a fresh tool set is built per storage source to prove `storageTools` follows the granted provider.
- **Approval is exercised for real.** A dangerous call is started, the `pending_approval` row is read, and `resolveApprovalWaiter(id, "approved")` is called — exactly what the approvals listener does — then the tool result and row status are checked. A second case never approves: it gets `{ ok: false, rejected: true }` after the runtime's timeout, the row is `rejected`, and the vendor stub saw no request.
- **Refusals stay results.** Slack/Discord channels, GitHub repos, composio `allowedApps` and storage prefixes outside the grant return `{ ok: false, error }` with the service's message and no vendor data request (Slack may still call `conversations.list` to resolve grant names, which the test allows explicitly).
- **Composio stays workspace-scoped.** The execution body reaching the stub carries `user_id: "org:<orgId>"` and the caller's arguments; a `readOnly` grant refuses `GMAIL_SEND_EMAIL` while `GMAIL_FETCH_EMAILS` still runs.

## 🎬 Case Study 5: `connector-turn.test.ts` — A Real Turn With a Scripted Model

The registry proof stops one layer short of the agent: it calls `tools[name].execute(...)` itself. The model never does that — it asks, and the engine's turn loop resolves the call, gates it, runs it and feeds the result back. `connector-turn.test.ts` drives `runEngineTurn` (what `runTurn` calls for a chat turn; `engine/index.ts`, default engine `v2`) with `MockLanguageModelV4` from `ai/test`:

- **Same run, two assertions per source.** For each of the fifteen connector sources the scripted model first receives the tool list — the suite asserts the connector's tool is in `options.tools` with a description and a schema — then emits that exact call. The next request's prompt must contain the matching `tool-result` with the vendor's data (or a grant refusal), and the audit row must exist.
- **The human gate is real.** `pending_approval` rows are answered by calling `resolveApprovalWaiter(id, "approved")` — the approvals listener's own entry point — from a poller, so a dangerous tool that skipped the gate would finish without an entry in `gates.approved` and fail the case. A rejection case instead proves `{ rejected }` reaches the model and the vendor is never called.
- **Refusals stay model-visible.** An ungranted composio app, an out-of-scope Slack channel and a storage prefix outside the grant arrive as tool results the model can read, with no data request reaching the stub.
- **Absent means absent.** With only Slack granted, the tool list for that turn contains no Drive/GitHub/Discord/Telegram/WhatsApp/password-manager/composio/storage tool.
- **The search threshold does not strand connectors.** With every source granted (plus the optional families) the set exceeds `TOOL_SEARCH_THRESHOLD` (40): the first tool list holds `find_tools` and not `slack_send_message`; after the model calls `find_tools`, the next list contains the tool and the call executes (through approval).

Only the provider, `broadcast`, the context/memory helpers and the local skills lookup are stubbed; the tool registry, `toAuditedTools`, `ConnectorService`, the KEK and the vendor HTTP are real.

The web app's own connect path is covered the same way in `apps/web/tests/integration/connector-probe.test.ts` (all 15 sources through `probeConnector`, including a vendor rejection) and `apps/web/tests/integration/mcp-marketplace.test.ts` (a stub MCP JSON-RPC server driven through `listMcpServerTools` / `callMcpServerTool`, then through `connectMcpServers` for the agent path, with `@writes` approval gating and the marketplace catalog's OAuth/token split).

## 🧯 What the Lane Deliberately Does Not Cover

Being hermetic is the point, but it bounds what these suites can prove:

- **No real SQL execution.** The connector mock DB filters rows by parsing the SQL Drizzle _renders_ (`dialect.sqlToQuery`) — the query shape is verified, but indexes, RLS policies, and triggers never run. Those paths are only exercised against a real Postgres in deployment.
- **No realtime authorization.** Private-channel access depends on RLS on `realtime.messages` (`packages/db/sql/0003_realtime.sql`), which needs a live Postgres + Supabase; the browser-side proof lives in the e2e `chat.spec.ts` instead.
- **No multi-instance behavior.** Room advisory locks, pg-boss retry scheduling across processes, and LISTEN/NOTIFY fan-out are mocked at the pool boundary (`approvals-listener.test.ts` stubs `getPool` with an inert connection), so serialization bugs between orchestrator instances are out of scope here.
- **No outbound network.** Every suite injects a `fetchFn`, stubs global fetch, or points the client at a loopback stub server (`127.0.0.1`); a test that reaches the internet is a bug by the repo's own conventions.

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
