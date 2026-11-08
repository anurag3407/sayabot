# Sayabot test suites

| Suite | Command | What it covers | Needs infra |
|---|---|---|---|
| Unit | `pnpm test:unit` | Pure functions / single-module behaviour, colocated `*.test.ts` next to source | none |
| Integration | `pnpm test:integration` | Cross-module contracts with in-process HTTP servers + mocked fetch/DB | none (no live Supabase/LLM) |
| E2E (browser) | `pnpm test:e2e` | Playwright user journeys (`e2e/*.spec.ts`) | running web+orchestrator, Supabase (see `e2e/global-setup.ts`) |
| E2E (API) | `pnpm test:e2e:api` | Health/contract checks against deployed services | running services |

`pnpm test` runs unit + integration across every workspace package via turbo.
Coverage: `pnpm test:coverage` (vitest `--coverage`, needs `@vitest/coverage-v8`).

## Conventions

- Unit tests live **next to the source** (`foo.ts` → `foo.test.ts`); package-level
  integration/unit tests live in `tests/unit/` / `tests/integration/` at the
  package root and are picked up by vitest's default include.
- Deterministic: no wall-clock sleeps except where the unit under test is a
  timer (use `vi.useFakeTimers`), no network, no `process.env` leakage
  (use `vi.stubEnv` + `vi.unstubAllEnvs`).
- DB-touching code is tested through the seam the module exposes
  (`vi.mock` of `../db`, an injected client, or an in-process Hono app),
  never a live database.

## Platform note (macOS sandbox)

Unix sockets under `$TMPDIR` fail with `EPERM` in sandboxed shells
(`apps/computerd/test/agentd-exec.test.ts`). Those 3 tests pass when run
unsandboxed / in CI; the file is kept as-is and the same RPC paths are
covered without sockets in `apps/computerd/tests/integration/agentd-rpc.integration.test.ts`.
