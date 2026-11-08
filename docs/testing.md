# Testing guide

## Commands

| Command | Suite | Notes |
|---|---|---|
| `pnpm test` | unit + integration (all workspaces) | turbo; 7/7 packages green (see below) |
| `pnpm test:unit` | unit + integration per package | same as `pnpm test` (turbo) |
| `pnpm test:integration` | repo-root cross-package contracts | `tests/integration/run.mjs` |
| `pnpm test:e2e` | full Playwright (seeded) | needs Supabase + `E2E_USER_*_EMAIL` |
| `pnpm test:e2e:api` | smoke lane: API + navigation + guards | `E2E_SMOKE=1`, no seeding |
| `pnpm typecheck:e2e` | e2e TS | |

## Layout

- Colocated: `foo.ts` -> `foo.test.ts` (pre-existing, kept).
- Package suites: `tests/unit/` + `tests/integration/` per package
  (orchestrator, web, egress, computerd, core, llm, db, mobile).
- Repo root: `tests/integration/cross-package.test.ts`.
- E2E: `e2e/api/health.spec.ts`, `e2e/navigation.spec.ts`,
  `e2e/api-guard.spec.ts` (new) + `e2e/chat|approval|turns.spec.ts` (seeded).

## Current results (local, 2026-11-08)

`pnpm test` — 7/7 packages green:
core 114, llm 49, db 8, orchestrator 333, web 78, egress 19,
computerd 50 (+3 skipped socket tests), mobile 2.
`pnpm test:integration` — 4/4. `pnpm typecheck` — 8/8.
`pnpm typecheck:e2e` — clean. `playwright test --list` — 29 tests.

CI: `.github/workflows/test.yml` runs unit+integration on every push/PR
and the e2e smoke lane after it.

## Known limitations

- `apps/computerd/test/agentd-exec.test.ts`: Unix sockets are EPERM under
  the macOS sandbox, so those 3 tests skip locally (they run in CI/Linux).
  Socket-free equivalents live in `apps/computerd/tests/unit/agentd-exec.test.ts`.
- `pnpm lint` in `@sayabot/web` has 4 pre-existing errors in
  `components/analytics/*` (unused vars) — unrelated to tests, untouched.
- Seeded e2e specs need a live Supabase project + two E2E users; they are
  listed but only run with `pnpm test:e2e` + `e2e/global-setup.ts`.
- Coverage: `vitest run --coverage` requires `@vitest/coverage-v8`
  (not yet a dependency); add it per package when you want reports.
