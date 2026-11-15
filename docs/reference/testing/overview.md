# Testing Overview & Strategy

Sayabot has four test lanes, all runnable from the repo root: colocated **unit** tests (Vitest) per workspace package, cross-module **integration** tests (Vitest, in-process servers, no live infra), **E2E browser** journeys (Playwright against running services), and an **E2E API smoke** lane (Playwright, servers only). `pnpm test` drives the unit + integration lanes through Turborepo; CI runs typecheck, lint, both lanes, and the API smoke suite. There are currently **205 colocated `*.test.ts` files** across the workspaces.

Source files: `package.json`, `turbo.json`, `.github/workflows/test.yml`, `tests/README.md`, `tests/integration/`, `e2e/`, `playwright.config.ts`, `apps/web/vitest.config.ts`

---

## 🧵 The Four Lanes

| Lane | Command | Runner | Infra needed |
| :--- | :--- | :--- | :--- |
| Unit | `pnpm test:unit` | Vitest per workspace (via turbo) | none |
| Integration | `pnpm test:integration` | Vitest rooted at `tests/integration` | none (mocked fetch/DB) |
| E2E browser | `pnpm e2e` / `pnpm test:e2e` | Playwright | running web + orchestrator + Supabase (seeded by `e2e/global-setup.ts`) |
| E2E API smoke | `pnpm test:e2e:api` | Playwright | running web server only |

Root scripts (`package.json:11-29`):

```jsonc
"test": "turbo run test",
"test:unit": "turbo run test --filter=@sayabot/core --filter=@sayabot/llm --filter=@sayabot/orchestrator --filter=@sayabot/web --filter=@sayabot/egress --filter=@sayabot/computerd --filter=@sayabot/mobile",
"test:integration": "node tests/integration/run.mjs",
"e2e": "playwright test",
"test:e2e:api": "E2E_SMOKE=1 playwright test api navigation.spec.ts api-guard.spec.ts",
"test:e2e": "playwright test",
"test:coverage": "turbo run test:coverage"
```

The `test` turbo task is defined in `turbo.json:10` with no `dependsOn` and no cached outputs (`"test": { "outputs": [] }`), so every `pnpm test` runs all matching workspaces fresh. `test:unit` pins the seven workspaces that have meaningful unit suites (`@sayabot/db` and `@sayabot/desktop`'s Electron main are excluded from the filter — db has test directories but no `test` script).

## 📦 What Runs Where

Each workspace's `test` script and colocated test count (found with `find … -name "*.test.ts"`, excluding node_modules):

| Workspace | `test` script | Colocated `*.test.ts` |
| :--- | :--- | :--- |
| `apps/orchestrator` | `vitest run` | 81 |
| `apps/web` | `vitest run` | 47 |
| `packages/core` | `vitest run` | 31 |
| `apps/computerd` | `vitest run` | 16 |
| `apps/desktop` | `vitest run` | 9 |
| `packages/llm` | `vitest run` | 10 |
| `apps/mobile` | plain `node --experimental-strip-types` on five named files in `tests/unit/` (env, workspace-draft, markdown, server-url, server-check), plus `tsc --noEmit` on a dedicated tsconfig first | 5 |
| `apps/egress` | `vitest run` | 4 |
| `packages/db` | none (tests exist under `tests/unit`/`tests/integration` but the package has no test script) | 2 |

Only **`apps/web`** has a `vitest.config.ts`; it exists to alias workspace packages to their TypeScript sources so tests run without pre-building packages (`apps/web/vitest.config.ts`): `@sayabot/core/server` → `packages/core/src/server/index.ts`, `@sayabot/llm` → `packages/llm/src/index.ts`, `@sayabot/db` → `packages/db/src/index.ts`, with `environment: "node"` and the default `**/*.test.ts` include. Every other workspace relies on Vitest defaults, which pick up both colocated `src/**/*.test.ts` files and the package-root `tests/unit/` + `tests/integration/` directories (e.g. `packages/core/tests/unit/clients.test.ts`).

The repo-root-level integration suite lives in `tests/integration/` and is *not* part of `pnpm test`'s turbo fan-out — `test:integration` invokes it directly through `tests/integration/run.mjs`, which spawns the orchestrator workspace's Vitest binary with `--root tests/integration` (run.mjs:1-8). See [integration-testing.md](integration-testing.md).

## 🤖 CI (`.github/workflows/test.yml`)

Two jobs:

1. **`unit-integration`** — "Unit + integration (vitest)" on every push to `main` and every PR: pnpm 10.33.0 + Node 24, `pnpm install --frozen-lockfile`, then in order:
   - `pnpm typecheck` (turbo, dependency-ordered)
   - `pnpm lint`
   - `pnpm test` (unit via turbo)
   - `pnpm test:integration`
   - `pnpm typecheck:e2e` (`tsc -p tsconfig.e2e.json` — the Playwright specs are typechecked but not run)
2. **`e2e-smoke`** — "E2E smoke (Playwright, API + navigation)", `needs: unit-integration`, **pushes only** (`if: github.event_name == 'push'`). It sets CI-only env (fake `DATABASE_URL`, `SAYABOT_KEK`/`MESH_KEK = ci-test-kek`, `SUPABASE_URL = https://ci.supabase.co`, `ORCHESTRATOR_INTERNAL_SECRET`), installs Playwright + Chromium, builds and starts `@sayabot/web`, waits for `http://localhost:3000/api/health` (30 x 2s, then fails with the web log), and runs `pnpm test:e2e:api` — marked `continue-on-error: true` (test.yml:66-67), so smoke failures do not fail the workflow.

The full browser E2E suite (`chat.spec.ts`, `turns.spec.ts`, `approval.spec.ts`) is **not** in CI; it needs a real Supabase project and seeded credentials (see [e2e-testing.md](e2e-testing.md)). Separate workflows (`deploy.yml`, `desktop-release.yml`, `mobile-updates.yml`) handle releases, not tests.

## 📏 Conventions (from `tests/README.md`)

The repo documents its own rules in `tests/README.md`:

- Unit tests are **colocated** next to the source (`foo.ts` → `foo.test.ts`); package-level suites live in `tests/unit/` / `tests/integration/` at the package root.
- **No live infrastructure** in unit/integration: no network, no real database, no LLM calls. DB-touching code is tested "through the seam the module exposes (`vi.mock` of `../db`, an injected client, or an in-process Hono app)".
- **Determinism**: no wall-clock sleeps except when the unit under test is a timer (use `vi.useFakeTimers`); no `process.env` leakage (use `vi.stubEnv` + `vi.unstubAllEnvs`).
- Known platform caveat: Unix sockets under `$TMPDIR` fail with `EPERM` in sandboxed macOS shells, so `apps/computerd/test/agentd-exec.test.ts` passes only unsandboxed/CI; the same RPC paths are additionally covered socket-free in `apps/computerd/tests/integration/agentd-rpc.integration.test.ts`.

The macOS sandbox caveat is worth restating concretely: it is not a test bug but an environment restriction — sandboxed shells deny `EPERM` on Unix sockets created under `$TMPDIR`, which is why a socket-driving test can pass on CI and fail in a local sandboxed shell. The repo's chosen fix is redundancy: keep the socket test as-is and add socket-free RPC coverage alongside it.

Coverage: `pnpm test:coverage` runs `turbo run test:coverage` for workspaces that define the task (Vitest `--coverage`, requires `@vitest/coverage-v8`).

## 🧰 Running a Subset

Vitest accepts file filters after the workspace filter, so a single unit file runs without the full turbo fan-out:

```bash
pnpm --filter @sayabot/orchestrator test src/tools/builtins/my-custom-tool.test.ts
pnpm --filter @sayabot/core test                      # one workspace's whole suite
pnpm test:integration                                 # repo-root integration only
pnpm --filter @sayabot/orchestrator exec vitest run --root tests/integration connectors.test.ts
pnpm e2e api navigation.spec.ts api-guard.spec.ts     # subset of Playwright specs
```

Turbo caches nothing for `test` (`"outputs": []`), so repeated `pnpm test` runs never serve stale results; conversely there is no result caching to lean on for large suites — filter when iterating.

## 📋 Package-Level Suite Inventory

Beyond colocated files, several packages keep `tests/` directories that Vitest's default include sweeps in:

- `packages/core`: `tests/unit/clients.test.ts`, `tests/integration/public-api.test.ts`.
- `packages/llm`: `tests/unit/`, `tests/integration/` (same layout).
- `apps/orchestrator`: `tests/integration/` — 10 suites (`http`, `interrupt`, `approvals-listener`, `bot-reply`, `webhook-deliver`, `computer-client`, `jobs-enqueue`, `mcp-tools`, `memory-tools`, `summarize`); see [integration-testing.md](integration-testing.md).
- `apps/web`: `tests/integration/` — 9 suites (API routes, proxy paths, connectors, desktop flows); `tests/unit/` including `env.test.ts`.
- `apps/computerd`: `tests/integration/computerd-app.test.ts` plus the socket-free agentd RPC coverage.
- `apps/mobile`: `tests/unit/` run by plain `node --experimental-strip-types` (see [unit-testing.md](unit-testing.md)).
- `packages/db`: `tests/unit/` (e.g. `client.test.ts`) and an empty `tests/integration/` — but **no `test` script**, so these run only via direct vitest invocation and are excluded from the `test:unit` filter.

## 🗺️ Coverage by Area

- **`packages/core`** (31 files): capabilities parsing, secret redaction, fold keys, cron expressions, turn tokens, webhook signing, SSRF guards (`src/server/ssrf.test.ts`), ask/response protocol.
- **`packages/llm`** (10 files): envelope crypto (`src/crypto.test.ts`), provider adapters, MCP client.
- **`packages/db`** (2 files, no test script): schema/seed helpers only — the DB layer is otherwise exercised through module-seam mocks and integration tests.
- **`apps/orchestrator`** (81 files): the largest suite — tools and danger evaluation, coordinator/turn state, connectors, cron, plans, bot routes/stream parsing, webhook jobs, memory, MCP.
- **`apps/web`** (47 files): components, server actions, rooms UI logic, push, providers.
- **`apps/computerd`** (16 files): backends (docker/smolvm/e2b selection), lifecycle, capacity, transport, agentd RPC.
- **`apps/egress`** (4 files): proxy behavior, secret placeholder swapping, scrubbing.
- **`apps/mobile`** (5 files) and **`apps/desktop`** (9 files): env/server-url validation, workspace drafts, markdown rendering, Electron main-process units.

Details and walkthroughs: [unit-testing.md](unit-testing.md), [integration-testing.md](integration-testing.md), [e2e-testing.md](e2e-testing.md).

---

## Related docs

- [unit-testing.md](unit-testing.md) — conventions and representative unit tests
- [integration-testing.md](integration-testing.md) — the `tests/integration` suite
- [e2e-testing.md](e2e-testing.md) — Playwright setup, fixtures, specs
- [../../testing.md](../../testing.md) — top-level testing guide
- [../architecture/monorepo-and-build.md](../architecture/monorepo-and-build.md) — turbo pipeline and CI scripts
