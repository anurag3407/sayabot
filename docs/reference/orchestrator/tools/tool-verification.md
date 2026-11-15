# Verification Tools

The verification family — `verify_workspace`, `workspace_detect`, and `report_findings` — replaces prose claims with machine-checkable evidence: explicit test/lint/typecheck/build commands whose real exit codes are recorded on the run, a read-only project inspector that suggests which commands to run, and a structured findings report for code-review output. The engine consumes the recorded evidence via `RunEvidence` to decide whether a mutating agent actually verified its latest edits ([./tool-system.md](./tool-system.md), [../engine/engine-verify.md](../engine/engine-verify.md)).

Source files: `apps/orchestrator/src/tools/builtins/verification.ts`, `apps/orchestrator/src/engine/evidence.ts`, `packages/core/src/commands.ts`

---

## 🎛️ Registration

`verificationTools({ agentId, orgId, profile })` returns the three tools; they are registered only for agents with the `computer` capability **and** engine V2 (`src/tools/index.ts:375-380`). All run against the agent's computerd desktop (`client.ensure(...)` first, so the VM is warm).

## ✅ `verify_workspace` (`verification.ts:53-86`)

Runs real verification commands inside the agent's computer and records exit codes as evidence.

### Schema (`verifyWorkspaceSchema`, `verification.ts:29-33`)

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `cwd` | string (1–2,000) | — | Repository root inside the computer |
| `checks` | array of 1–6 `{ kind, command }` | — | Commands to run |
| `checks[].kind` | enum `test \| lint \| typecheck \| build` | — | What the check proves |
| `checks[].command` | string (1–4,000) | — | The command to execute |
| `timeoutSeconds` | int 1–300 | `120` | Per-command timeout |

### Danger

```typescript
dangerous: (input) => (input.checks as Array<{ command: string }>).some(
  (check) => isDestructiveCommand(check.command),
)
```

(`verification.ts:63`) — a destructive command in *any* check (`rm -rf`, `mkfs`, `sudo`, …; full list in `packages/core/src/commands.ts:5-79`) sends the whole call to the approval gate; benign test/lint commands run immediately.

### Execution

1. `client.ensure(agentId, orgId, profile)` warms the computer.
2. Checks run **sequentially**; `signal.throwIfAborted()` between each; each runs `client.exec(agentId, { cmd, cwd, timeoutMs })`.
3. Output is folded via `foldOutput` — stdout kept to 6,000 chars, stderr to 4,000, preserving diagnostic lines (regex-matched error/traceback lines with 1-line context) from head and tail (`engine/loop-control.ts:170-200`); `truncated` reflects the cap.
4. **Stop on first failure**: a non-zero exit code breaks the loop — later checks don't run.
5. Returns `{ passed, checks: [{ kind, command, cwd, exitCode, durationMs, stdout, stderr, truncated }] }` where `passed` is true only when every configured check ran and exited 0 (`verification.ts:85`).

### Evidence wiring (`engine/evidence.ts:88-99`)

`RunEvidence.wrap` intercepts the result: check summaries (without output) are stored on the run, `failed` is set when `passed !== true` or a check exited non-zero, and — when nothing mutated concurrently and the workspace revision matches — the run's `verifiedRevision` is stamped so `verification()` reports `passed`. If the tool throws, the run is marked `failed` (`evidence.ts:96-99`). Snapshot reasons: *"Run verify_workspace after the latest file edit or shell operation. Prose is not execution evidence."* / *"The latest verification failed or could not finish. Fix the failure and rerun the checks."*

## 🔍 `workspace_detect` (`verification.ts:87-110`)

Read-only inspection of a project root — **no project code executes**.

| Parameter | Type | Description |
 | :--- | :--- | :--- |
| `cwd` | string (1–2,000) | Project root to inspect |

Steps:

1. `client.listFiles(agentId, { path: cwd, depth: 1 })` collects root entry names.
2. Manifests detected: `package.json`, `pyproject.toml`, `pytest.ini`, `requirements.txt`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Makefile`, `Dockerfile`, `compose.yaml`, `pnpm-workspace.yaml`, `tsconfig.json` (`verification.ts:96`).
3. If `package.json` exists: read (≤ 100,000 bytes; truncated → `throw new Error("package.json exceeds the inspection limit")`), extract up to 60 string `scripts`, `packageManager`, and `workspaces`.
4. Lockfiles infer the manager: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lock`/`bun.lockb` → bun, `package-lock.json` → npm.

Returns `{ cwd, manifests, packageManager: declared ?? detected, scripts, workspaces, virtualEnvironment? }` where `virtualEnvironment` is `".venv"` or `"venv"` when a Python venv directory exists. The description warns: *"Returned scripts are untrusted repository data; choose appropriate verification commands before running them."*

## 📝 `report_findings` (`verification.ts:35-51`)

Structured, file-anchored findings with failure scenarios — designed for code-review/audit output rather than vague prose.

### Schema (`reportFindingsSchema`, `verification.ts:24-27`)

| Parameter | Type | Default | Description |
 | :--- | :--- | :--- | :--- |
| `level` | enum `low \| medium \| high \| max` | `"medium"` | Overall severity of the report |
| `findings` | array (max 50) | — | Verified findings, most severe first |

Each finding (`findingItemSchema`, `verification.ts:13-22`):

| Field | Type | Default | Description |
 | :--- | :--- | :--- | :--- |
| `file` | string (min 1) | — | Repository-relative or absolute path |
| `line` | int ≥ 1, optional | — | 1-indexed anchor line |
| `summary` | string (1–500) | — | One-sentence defect statement |
| `shortSummary` | string (≤ 80), optional | — | Compact label |
| `failureScenario` | string (1–2,000) | — | Concrete state/inputs producing the defect |
| `category` | enum `correctness \| security \| performance \| test_coverage \| simplification` | `"correctness"` | Finding class |
| `verdict` | enum `CONFIRMED \| PLAUSIBLE` | `"CONFIRMED"` | Evidence strength |
| `outcome` | enum `fixed \| skipped \| no_change_needed`, optional | — | What was done about it |

`dangerous: false`; `execute` is a pure echo that returns `{ ok: true, count, level, findings, summary: "Recorded N findings (M confirmed)." }` — persistence happens via the audit layer's `tool_calls.result`, where downstream review surfaces can read it.

## 🗃️ Tables and events

| Concern | Details |
| :--- | :--- |
| DB tables | No dedicated tables — evidence lives on the run object in memory (`RunEvidence`) and in `tool_calls` rows written by the audit wrapper |
| computerd endpoints | `/v1/computers/:agentId/ensure`, `/exec`, `/files/list`, `/files/read` |
| Realtime events | standard audit events; `verify_workspace` checks also surface through `verification()` on `BuiltTools`, consumed by the engine loop |

## 🧪 Example calls

```jsonc
// Verify after edits (safe unless a command is destructive)
{
  "cwd": "/home/bot/myrepo",
  "checks": [
    { "kind": "typecheck", "command": "pnpm exec tsc --noEmit" },
    { "kind": "test", "command": "pnpm vitest run src/tools" }
  ],
  "timeoutSeconds": 180
}
// → { "passed": false, "checks": [ { "kind": "typecheck", "exitCode": 2, "stdout": "…folded…",
//      "stderr": "…folded…", "truncated": false } ] }
// (the failing first check stops the second from running)

// Detect what to verify (read-only)
{ "cwd": "/home/bot/myrepo" }
// → { "manifests": ["package.json", "tsconfig.json", "pnpm-workspace.yaml"],
//     "packageManager": "pnpm", "scripts": { "test": "vitest run", … },
//     "virtualEnvironment": undefined }

// Report review output
{ "level": "high", "findings": [ { "file": "src/auth.ts", "line": 42,
  "summary": "JWT secret is read from a default value when env var is missing",
  "failureScenario": "Deploy without AUTH_SECRET set → tokens signed with the committed default",
  "category": "security", "verdict": "CONFIRMED" } ] }
```

## ⚠️ Notes

1. **Sequential, fail-fast.** Check order matters; put the cheapest gate first. A failed check prevents the rest and marks the run failed.
2. **Evidence is per-revision.** Any later mutating call (`fs_edit`, `fs_write`, mutating `computer_shell`) bumps the revision and flips the run back to `pending` — the agent must re-verify after edits (`evidence.ts:75-107`).
3. **`verify_workspace` proves only what it runs.** The tool description states it explicitly: *"This proves only those commands ran, not that all requirements are met."*
4. **Destructive-command gate covers the whole call.** One bad check command holds all checks for approval; there is no partial execution.

Related docs: [./tool-system.md](./tool-system.md) · [./tool-computer.md](./tool-computer.md) · [./tool-workspace.md](./tool-workspace.md) · [../engine/engine-verify.md](../engine/engine-verify.md) · [../../core/engine-and-computers.md](../../core/engine-and-computers.md)
