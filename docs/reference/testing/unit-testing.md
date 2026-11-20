# Unit Testing

Unit tests in Sayabot are Vitest files **colocated next to the source** (`foo.ts` → `foo.test.ts`), run per workspace through Turborepo with no external infrastructure: databases, network calls, and LLM completions are replaced by `vi.mock`/`vi.fn()` seams, environment is controlled with `vi.stubEnv`, and time with `vi.useFakeTimers`. This page documents the conventions and walks through three representative suites: envelope crypto, the cron parser, and the audited-tool wrapper.

Source files: `packages/llm/src/crypto.test.ts`, `packages/core/src/cron.test.ts`, `apps/orchestrator/src/tools/audited.test.ts`, `packages/db/tests/unit/client.test.ts`, `apps/orchestrator/src/runner/local-events.test.ts`, `apps/web/vitest.config.ts`, `tests/README.md`

---

## 📁 Layout & Runner

- Tests sit beside the code they cover — `packages/llm/src/crypto.test.ts` for `packages/llm/src/crypto.ts`, `apps/orchestrator/src/tools/audited.test.ts` for `tools/audited.ts`. Package-level suites that don't belong to one module live in the package root's `tests/unit/` (picked up by Vitest's default include alongside `src/`).
- Every workspace runs `vitest run` (see the table in [overview.md](overview.md)); only `apps/web` defines a `vitest.config.ts`, needed to alias `@sayabot/core`, `@sayabot/llm`, and `@sayabot/db` to their TypeScript sources so tests execute without building packages first.
- Run one file directly, as AGENTS.md recommends for new tools:
  ```bash
  pnpm --filter @sayabot/orchestrator test src/tools/builtins/my-custom-tool.test.ts
  pnpm --filter @sayabot/orchestrator typecheck
  ```
- Style rules that apply to tests (AGENTS.md §7): unused variables get an `_` prefix, `any` is avoided in application code but tolerated in tests, and non-null assertions (`!`) are **permitted only in test files**.

## 🧪 Patterns

### Pure round-trip tests — `packages/llm/src/crypto.test.ts`

The smallest pattern: construct deterministic fixtures and assert round-trips and failures. The KEK is not stubbed from the environment — the crypto functions take it as a parameter, so the test builds one inline:

```typescript
const kek = Buffer.alloc(32, 7).toString("base64")
```

Six cases (`crypto.test.ts:13-51`) cover exactly the security properties that matter operationally:

- **Fresh IV per encryption** — encrypting the same plaintext twice yields different `iv`/`ciphertext` (line 14-20).
- **Tamper rejection** — a flipped auth tag or modified ciphertext throws on decrypt (GCM authenticity, lines 22-31).
- **Wrong key throws** — encrypting with one 32-byte key and decrypting with another throws (lines 33-37); this is the behavior behind the KEK-mismatch failure mode in [troubleshooting.md](../operations/troubleshooting.md).
- **Key validation** — a 16-byte base64 key triggers `parseKek`'s `/32 bytes/` error (lines 39-41).
- **Single-column envelope** — `sealSecret`/`openSecret` round-trip a JSON payload through the base64 `{ciphertext, iv, tag}` wrapper (lines 43-46).
- **`last4`** display helper (lines 48-50).

No mocks, no env, no network — the suite is fully hermetic.

### Reference-data and time math — `packages/core/src/cron.test.ts`

`cron.test.ts` shows the repo's approach to time-dependent code: pin an explicit reference `Date` instead of using the wall clock.

- Alias and natural-language normalization: `@daily` → `0 0 * * *`, `"every 15m"` → `*/15 * * * *`, `"weekdays at 10:15 am"` → `15 10 * * 1-5` (lines 10-24).
- Validation of field ranges and structure: `60 * * * *` and `* * * *` are invalid (lines 26-37).
- **Next-run computation from a fixed reference**: `const ref = new Date("2026-06-10T08:00:00Z")`, then asserting `getNextCronRun("0 9 * * 1-5", fridayRef, "UTC")` lands on Monday June 15 (lines 39-56). Passing the reference date as a parameter is what makes the test deterministic — no `vi.useFakeTimers` needed because the unit under test takes time as input.
- Human-readable descriptions (lines 58-64).

### Module-seam mocking — `apps/orchestrator/src/tools/audited.test.ts`

The dominant pattern for DB-touching code (per `tests/README.md`: "DB-touching code is tested through the seam the module exposes (`vi.mock` of `../db`, an injected client, or an in-process Hono app), never a live database"). `audited.test.ts` mocks three module boundaries at the top of the file:

```typescript
vi.mock("../realtime", () => ({
  broadcast: (roomId: string, event: any) => {
    broadcastEvents.push({ roomId, event })
    return Promise.resolve()
  },
}))
vi.mock("../db", () => ({ getDb: () => ({ insert: ..., update: ... }) }))
vi.mock("./approvals", () => ({ waitForApproval: vi.fn().mockResolvedValue("approved") }))
```

- The **`../db` mock** fakes just the Drizzle chain the code uses — `insert().values().returning()` resolves `[{ id: "tool-call-123" }]`, and every inserted value is recorded in `lastInsertedValues` for later assertions (audited.test.ts:14-33).
- The **`./approvals` mock** makes the human-in-the-loop gate resolve instantly (`"approved"`), so dangerous-tool flows can be tested without a human; conversely `runner/local-events.test.ts:34` mocks it with `waitForApproval: () => new Promise(() => {})` — a promise that never resolves — to assert that a dangerous call first records `status: "pending_approval"` and broadcasts an approval event (line 103) **while the gate is still open**.
- Assertions then check observable side effects: `toolCallId` threading into `ctx` (line 74-80), `tool.started`/`tool.finished` broadcasts (lines 78-88), secret redaction in both success results and thrown errors (lines 90-99 — the `runtime.scrub` seam replaces "private-value" with "[REDACTED]"), no execution when the abort signal is already aborted (lines 101-106), and non-UUID `runId`/`messageId` sanitized to `null` before insert (lines 108-132).

### Environment stubbing — `vi.stubEnv`

`tests/README.md` mandates `vi.stubEnv` + `vi.unstubAllEnvs()` for env isolation. Real examples:

- `packages/db/tests/unit/client.test.ts:11` calls `vi.unstubAllEnvs()` in `afterEach`, then `vi.stubEnv("DATABASE_POOL_MAX", "9")` and `vi.stubEnv("DATABASE_URL", "")` to prove `createDb` reads the pool size from the environment and `requireDatabaseUrl` throws a `/DATABASE_URL/` error when unset. The `pg` module itself is mocked with a fake `Pool` class so no connection is attempted (client.test.ts:3-8). The stub-then-cleanup pairing (`afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })`) is the pattern `tests/README.md` mandates for keeping env state out of sibling tests.
- `apps/web/tests/unit/env.test.ts:16-17` bulk-stubs a list of keys (`ORCHESTRATOR_URL`, `NEXT_PUBLIC_APP_URL`, `SAYABOT_KEK`, `MESH_KEK`, …) to `undefined` before re-stubbing the fixture, then asserts the precedence rule: `getKek()` prefers `SAYABOT_KEK`, falls back to `MESH_KEK`, and throws `/SAYABOT_KEK/` when neither is set (env.test.ts:38-42) — the same legacy-name fallback the deploy scripts accept.
- `packages/llm/src/models/models.test.ts:33-34` stubs `SAYABOT_DATA_DIR` and `SAYABOT_DISABLE_MODEL_MANIFEST_FETCH` to keep model-catalog tests offline and filesystem-isolated.

Note for crypto code: AGENTS.md mentions `vi.stubEnv("MESH_KEK", "k")` as the general recipe for providing dummy keys; in the current tree the crypto unit itself takes the KEK as an argument (so `crypto.test.ts` builds one inline), while env-derived KEK selection is covered by `env.test.ts` as above.

### Naming and structure conventions

Observed across the suites: one `describe` per unit under test, `it` sentences written as behavioral claims ("round-trips a column envelope with a fresh IV", "does not execute a cancelled non-dangerous call", "sanitizes non-UUID runId and messageId to null"), error assertions via `toThrow(/regex/)` on the message fragment, and mock state stored in module-scope arrays cleared in `beforeEach`. Security-relevant assertions prefer "absence of plaintext" checks — `expect(json).not.toContain(token)` — over presence checks of the redaction marker alone.

### The `apps/mobile` special runner

`apps/mobile` does not use Vitest. Its `test` script first typechecks with a dedicated tsconfig (`tsc --noEmit -p tests/unit/tsconfig.json`) and then runs five named files with Node's type-stripping loader:

```
node --no-warnings --experimental-strip-types tests/unit/env.test.ts
node ... workspace-draft.test.ts markdown.test.ts server-url.test.ts server-check.test.ts
```

(env, workspace-draft, markdown, server-url, server-check — package.json:16). The files must therefore be plain-TypeScript-compatible with Node's built-in stripping rather than Vitest-transformed; `env.test.ts` still follows the same `vi.stubEnv`-style discipline conceptually, importing test helpers from `node:test`-compatible paths. This is why `test:unit`'s turbo filter includes `@sayabot/mobile` even though the lane is not vitest-based.

### Never-resolving and fake timers

- The pending-approval gate uses a never-resolving promise (see above) rather than sleeps.
- Where the unit under test **is** a timer, `tests/README.md` directs tests to `vi.useFakeTimers()`; otherwise wall-clock waits are banned.

### Mock-hoisting pitfalls

Two Vitest mechanics the suites code around:

- **`vi.mock` calls are hoisted** to the top of the file, above imports — so the factory cannot reference variables declared later unless they are also moved into the factory or the module under test is imported dynamically. `runner/local-events.test.ts:36` uses `const { recordMacToolEvents, requestMacApproval, storedArgs } = await import("./local-events")` _after_ all `vi.mock` declarations for exactly this reason.
- **Shared mock state must be reset.** Arrays like `broadcastEvents` and `lastInsertedValues` are module-scope so assertions can inspect them; `audited.test.ts:45-47` clears them in `beforeEach`, and one test clears `lastInsertedValues` again before its own insert-count assertion (line 109) — a reminder that insert-recording mocks accumulate across tests in the same file.

## ✅ Writing a New Unit Test (recipe)

1. Colocate it: `apps/orchestrator/src/tools/builtins/my-custom-tool.test.ts`.
2. Import from Vitest: `describe`, `expect`, `it` (plus `vi`/`beforeEach`/`afterEach` only when mocking or stubbing).
3. Mock module boundaries with `vi.mock` **before** importing the module under test, or use dynamic `await import()` after the mocks (as `local-events.test.ts:36` does).
4. For tools, follow the AGENTS.md §5 shape — assert the `dangerous` flag both ways (boolean or function of args) and that `execute` returns an `{ ok: ... }` result.
5. Keep it hermetic: no live DB, no fetch, no sleeps; use `vi.stubEnv` for env and reference dates/fake timers for time.
6. Run it: `pnpm --filter @sayabot/orchestrator test src/tools/builtins/my-custom-tool.test.ts`, then `pnpm --filter @sayabot/orchestrator typecheck`.

---

## Related docs

- [overview.md](overview.md) — lanes, CI, per-workspace counts
- [integration-testing.md](integration-testing.md) — cross-module suites with in-process servers
- [e2e-testing.md](e2e-testing.md) — Playwright journeys
- [../../testing.md](../../testing.md) — top-level testing guide
- [../operations/deployment.md](../operations/deployment.md) — where the KEK comes from in production
