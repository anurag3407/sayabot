# Sandbox Tools (`code_sandbox`, `terminal_exec`)

When an agent has the `sandbox` capability **and no `computer`**, the orchestrator registers two ephemeral execution tools: `code_sandbox` (Python/JavaScript/Bash snippets) and `terminal_exec` (raw shell commands). Both dispatch through one `runSandboxExecution()` function across six selectable backends — local host process, Docker, Modal Labs, Daytona, remote SSH, and serverless microVM (E2B) — with credentials resolved from the org's `terminal_sandbox` tool config. Enabling the `computer` capability replaces both tools with the persistent computer suite ([./tool-computer.md](./tool-computer.md)).

Source files: `apps/orchestrator/src/tools/builtins/sandbox.ts`, `apps/orchestrator/src/tools/secrets.ts:36-104`, `apps/orchestrator/src/tools/builtins/sandbox.test.ts`

---

## 🧱 Backends (`SANDBOX_BACKENDS`, `sandbox.ts:32-132`)

The exported `SANDBOX_BACKENDS` catalog (used by settings UIs and asserted in tests, `sandbox.test.ts:9-32`) describes six execution environments:

| id | Name | Tag | Isolation | Requires |
| :--- | :--- | :--- | :--- | :--- |
| `local` | Local (Host OS) | Free / Local | Host process isolation (scoped directory & timeout) | nothing |
| `docker` | Docker (Persistent Sandbox) | Self-Hosted | Docker container (dropped capabilities, isolated network) | a host running computerd |
| `modal` | Modal Labs (Serverless Cloud) | Cloud / BYOK | Serverless ephemeral Linux container | API key |
| `daytona` | Daytona (Cloud Workspaces) | Cloud / BYOK | Automated cloud dev environment | API key + host |
| `ssh` | Remote SSH (Homelab / VPS) | Self-Hosted | Remote execution over SSH | host (`user@host`) |
| `serverless_vm` | Serverless MicroVM (E2B / Singularity) | HPC / MicroVM | Firecracker microVM boundary | `E2B_API_KEY` |

## 🛠️ `code_sandbox` (`sandbox.ts:352-399`)

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `language` | enum `python \| javascript \| bash` | `"bash"` | Snippet language |
| `code` | string | — (1–20,000 chars) | Code to execute |
| `backend` | enum `local \| docker \| modal \| daytona \| ssh \| serverless_vm` | optional | Target environment; defaults to the org-configured backend, then `local` |
| `timeoutSeconds` | int 1–60 | optional | Per-run timeout |

- `dangerous: (input) => input.backend === "local" || input.backend === "ssh" || isDestructiveCommand(...)` — executes without approval only in fully isolated container/microVM backends for non-destructive commands. Any execution on the host OS (`local`), remote SSH host (`ssh`), or involving destructive patterns (`rm -rf`, `mkfs`, fork bombs, DROP TABLE) triggers human approval per AGENTS.md Rule 4.
- Credential resolution: `resolveToolCredential({ orgId, agentId, tool: "terminal_sandbox" })` (`sandbox.ts:379-381`); the config's `provider` selects the default backend, `apiKey`/`baseUrl` feed the remote backends.
- Returns the `ExecutionResult` described below.

## 🖥️ `terminal_exec` (`sandbox.ts:401-449`)

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `cmd` | string (min 1) | — | Shell command string |
| `cwd` | string | optional | Working directory |
| `backend` | same enum as `code_sandbox` | optional | Target environment |
| `timeoutSeconds` | int 1–120 | `30` | Timeout |

Same credential path and dynamic `dangerous` human approval evaluation as `code_sandbox`, always executing with `language: "bash"` (`sandbox.ts:439`).

## ⚙️ Dispatcher — `runSandboxExecution` (`sandbox.ts:314-348`)

```typescript
export async function runSandboxExecution(args: {
  code: string
  language?: "python" | "javascript" | "bash"
  backend?: SandboxBackend
  timeoutSeconds?: number
  apiKey?: string
  baseUrl?: string
  cwd?: string
  signal?: AbortSignal
}): Promise<ExecutionResult>
```

Timeout is clamped to `min(timeoutSeconds ?? 30, 120) * 1000` (`sandbox.ts:325`). Dispatch:

- **`local`** (and **`docker`**, which currently falls through to local execution, `sandbox.ts:344-347`): `executeLocalProcess` (`sandbox.ts:146-219`) spawns `bash -c <cmd>` with a minimal env (`PATH`, `HOME`, `LANG`, `LC_ALL`), cwd defaulting to the orchestrator process directory. Output capped: stdout 50,000 chars, stderr 10,000 chars. Timeout kill returns `exitCode: 124` with `"Execution timed out"` appended to stderr; abort kills the child with `SIGKILL` and throws `"Execution aborted by user"`. Spawn errors resolve (not reject) with `exitCode: 1`.
- **`serverless_vm`**: `executeE2bSandbox` (`sandbox.ts:221-260`) dynamically imports `@e2b/code-interpreter`, creates an E2B `Sandbox` with `E2B_API_KEY` (missing key → `throw new Error("E2B_API_KEY is not configured for Serverless MicroVM sandbox.")`), runs the code with the chosen language, and always kills the sandbox afterwards. Abort kills the sandbox. `results` carries rich-cell text outputs; `error` carries `{ name, value, traceback }`.
- **`modal`**: `executeModalCloud` (`sandbox.ts:262-277`) requires an API key and returns a placeholder result — `stdout: "[Modal Labs Sandbox] Job executed in ephemeral container:\n<cmd>"` (the code comments call this a simulated/webhook dispatch; no live Modal SDK call exists).
- **`daytona`**: `executeDaytonaCloud` (`sandbox.ts:279-294`) similarly requires a token and returns `"[Daytona Workspace: <baseUrl>] Executed command: <cmd>"` without a live network call.
- **`ssh`**: `executeRemoteSsh` (`sandbox.ts:296-310`) requires a host string (passed via the `baseUrl` config field) and returns `"[SSH Remote: <host>] Executed: <cmd>"` — likewise a stub in the current code.

`ExecutionResult` (`sandbox.ts:134-142`):

```typescript
export interface ExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
  backend: SandboxBackend
  executionTimeMs: number
  results?: string[]                                                     // E2B rich cells
  error?: { name: string; value: string; traceback?: string } | null     // E2B exception
}
```

## 🗃️ Tables and events

No database tables are read or written by the tools themselves. The audit layer ([./tool-system.md](./tool-system.md)) records every call in `tool_calls`, and `resolveToolCredential` reads `agent_secret_grants` ⋈ `vault_secrets` (for `GITHUB_TOKEN`-style canonical envs — not applicable to `terminal_sandbox`) or `org_tool_configs` (sealed `configEnc` JSON, `src/tools/secrets.ts:102-104`). No realtime events are emitted by the sandbox tools beyond the standard `tool.started`/`tool.finished`.

## 🧾 Backend configuration fields (`OrgToolConfig` → dispatch)

The `terminal_sandbox` org config's JSON maps to dispatcher arguments (`sandbox.ts:384-387`):

| Config field | Used as |
| :--- | :--- |
| `provider` | Default backend when the call omits `backend` |
| `apiKey` | E2B `Sandbox.create`, Modal token check, Daytona token check |
| `baseUrl` | Daytona workspace name; SSH `host` string (via `executeRemoteSsh(args.baseUrl)`) |
| `token`, `connectionString`, … | Ignored by these two tools |

Resolution failures are swallowed (`.catch(() => null)`), so a missing/broken org config degrades silently to the `local` backend rather than failing the call (`sandbox.ts:380-381, 429-430`).

## ⚠️ Notes and caveats

1. **`docker` backend is not a container path in this file.** Despite the catalog text, the `docker` case falls through to `executeLocalProcess` (`sandbox.ts:344-347`). Container isolation comes from the `computer` capability's computerd tools, not from `code_sandbox`.
2. **Modal/Daytona/SSH are placeholders.** They validate credentials and return canned output; results should not be treated as real remote execution output.
3. **Local backend has no filesystem confinement** beyond the orchestrator process cwd — the capability is intended for environments where the agent's other tools already scope it.
4. The `sandboxTool()`/`terminalExecTool()` factories accept either a string org id or an `{ orgId, agentId }` object for backwards compatibility (`sandbox.ts:352-354`).

## 🧪 Examples (from `sandbox.test.ts`)

```typescript
// Local shell execution
const result = await runSandboxExecution({
  code: "echo 'hello from sayabot sandbox'",
  language: "bash",
  backend: "local",
})
expect(result.exitCode).toBe(0)
expect(result.stdout).toContain("hello from sayabot sandbox")

// Backend catalog assertions
expect(SANDBOX_BACKENDS.length).toBe(6)

const sTool = sandboxTool({ orgId: "org-1" })
expect(sTool.name).toBe("code_sandbox")     // dangerous === false
const tTool = terminalExecTool({ orgId: "org-1" })
expect(tTool.name).toBe("terminal_exec")    // dangerous === false
```

Related docs: [./tool-system.md](./tool-system.md) · [./tool-computer.md](./tool-computer.md) · [./secrets-broker.md](./secrets-broker.md) · [./tool-web.md](./tool-web.md) · [../../database/schema-connectors-and-vault.md](../../database/schema-connectors-and-vault.md)
