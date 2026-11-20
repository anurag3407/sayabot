# agentd — The In-Container Daemon

`agentd` is the small Node daemon that runs **inside** every agent computer (Docker image, smolvm VM, or E2B sandbox). It exposes a Unix-socket, NDJSON-framed RPC surface for shell execution, file operations, code intelligence, and environment management, and it owns the two socket conveniences of a no-network microVM: a second control listener for computerd and an egress relay. `agentd-cli` is its one-shot client, used by every CLI-based transport.

Source files: `apps/computerd/agentd/agentd.ts`, `apps/computerd/agentd/agentd-cli.ts`

---

## 🚀 Boot & Privilege Drop

`agentd.ts:20-28` drops privileges immediately when started as root: `setgid(10001)` then `setuid(10001)` (the unprivileged `bot` user); failure to drop is fatal (`process.exit(1)`). Exec'd children re-assert `uid/gid 10001` if the daemon is ever root.

The entry block (`agentd.ts:349-356`) matches `agentd.(ts|js|mjs)` in `argv[1]` and starts up to **three listeners**:

| Listener                     | Enabled when                                                                                                      | Mode / port |
| :--------------------------- | :---------------------------------------------------------------------------------------------------------------- | :---------- |
| Main agentd socket           | always — `AGENTD_SOCK` (default `/run/agentd.sock`)                                                               | `0600`      |
| Control socket for computerd | `AGENTD_CTL_SOCK` set and its directory exists                                                                    | `0666`      |
| Egress relay                 | `AGENTD_EGRESS_SOCK` set — `startEgressRelay` listens on `AGENTD_EGRESS_PORT` (default 8080) bound to `127.0.0.1` | TCP         |

The permission asymmetry is deliberate (`agentd.ts:30-34`): the in-container socket is `0600` for the bot user; the control socket that computerd reaches through the private `saaya-agentd` volume is `0666` because computerd runs as a different uid without `CAP_DAC_OVERRIDE`, and only this one container mounts that directory.

`BOT_HOME` (default `/home/bot`) sets the agent home root used across handlers.

---

## 🔌 Wire Protocol

`startAgentd(socketPath, mode)` (`agentd.ts:35-71`):

- Unlinks a stale socket, then serves a line-delimited JSON protocol: each request is one JSON object terminated by `\n`.
- A per-connection buffer enforces a **16 MB request limit** — overflow ends the connection with `{ "error": "Request exceeds byte limit" }` (`agentd.ts:47-50`).
- Invalid JSON answers `{ "error": "invalid json" }`; non-object requests are rejected; unknown `op`s answer `{ "error": "unknown op: <op>" }`; handler exceptions are caught and returned as `{ "error": message }` frames (`agentd.ts:324-326`).

`exec` is the only **streaming** op; every other op writes exactly one response frame. Transports rely on this contract via `isFinalFrame` (see [overview.md](overview.md)).

---

## 🛠️ Operations

### `exec` (`agentd.ts:90-188`)

Request fields: `cmd` (required string), `cwd` (default `BOT_HOME`), `env` (extra vars), `timeoutMs` (default 60_000, **validated to [1, 300_000]**), `stdin`, `background`. `background: true` is explicitly unsupported by this RPC and throws.

Execution details:

- **CWD self-healing**: a `cwd` that no longer exists falls back to `BOT_HOME`, then `process.cwd()` (`agentd.ts:99`) — a command that deleted its own working directory does not wedge every later call.
- Runs `bash -c <cmd>` with `detached: true` (own process group) so timeouts can kill the whole tree.
- **Non-interactive env defaults** (`agentd.ts:102-110`): `CI=true`, `DEBIAN_FRONTEND=noninteractive`, `TERM=dumb`, `PAGER=cat`, `GIT_PAGER=cat`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` — preventing pagers (`git diff`, `less`) and interactive prompts from hanging a turn.
- Environment merge order (`agentd.ts:114-120`): `process.env` **minus** the plumbing vars `AGENTD_CTL_SOCK` and `AGENTD_EGRESS_SOCK` (internal plumbing paths are not part of the user's environment), then the non-interactive defaults, then `HOME=BOT_HOME`, then the request's `env`.
- `stdin` (if provided) is written to the child and the pipe closed; stdin errors are swallowed.
- Timeout handling (`agentd.ts:141-146`): `SIGTERM` to the process group (`process.kill(-pid)`), then `SIGKILL` 5 s later (unref'd so it never holds the event loop open). Group kill matters because commands spawn test runners and dev servers that must not outlive the call.
- Output frames: `{ t: "out" | "err", d: "<text>" }` chunks as they arrive, each stream decoded with its own `StringDecoder` so multibyte characters split across chunks survive. Total output is capped at **1 MB** (`MAX_OUTPUT_BYTES`); further bytes are dropped and the exit frame reports `truncated: true`.
- Exit frame (`agentd.ts:176-186`): `{ t: "exit", code, durationMs, truncated, timedOut? }` — `code` is `124` on timeout (matching coreutils `timeout`), `128+n` for signal deaths like a shell, else the child's code.

| Exit frame field | Meaning                                                                   |
| :--------------- | :------------------------------------------------------------------------ |
| `code`           | child exit code; `124` on timeout; `128 + signal` when killed by a signal |
| `durationMs`     | wall time from spawn to close                                             |
| `truncated`      | output exceeded the 1 MB cap and some bytes were dropped                  |
| `timedOut`       | present (true) only when the timeout path fired                           |

### `read` / `write` / `edit` / `patch` — file operations

Delegated one-to-one to `files.ts`: `readFilePage`, `writeFileAtomic`, `editFileAtomic`, `applyPatchAtomic`. Full treatment (path safety, hash guards, patch grammar) in [agentd-files.md](agentd-files.md).

### `code` (`agentd.ts:202-204`)

Delegated to `codeIntelligence(req)` — AST-backed outline / definition / references / diagnostics / rename preview. See [agentd-code-intelligence.md](agentd-code-intelligence.md).

### `list` (`agentd.ts:206-242`)

Recursive directory listing from `path` (default `BOT_HOME`) down to `depth` (default 2), returning entries `{ path, type: "file" | "dir", size, mtime }`. Guards: `isSafePath` on the root and on every entry, `.git*` entries skipped below the root, and a hard cap of **2000 entries**.

### `env.reload` (`agentd.ts:244-259`)

Rewrites `${BOT_HOME}/.saaya/env` (mode `0600`, parent dirs created) with a generated header and one `export K=JSON.stringify(v)` line per entry:

```typescript
let fileContent = "# Generated by Sayabot platform\n"
for (const [k, v] of Object.entries(env)) {
  fileContent += `export ${k}=${JSON.stringify(v)}\n`
}
writeFileSync(envPath, fileContent, { mode: 0o600 })
```

This is how the platform refreshes per-agent environment variables inside a running computer. Note that the `exec` handler merges `process.env` + request env and does **not** parse this file at exec time — the file is the durable record (and the contract agents can `source` manually); injection into processes happens via container/VM env at boot plus per-request `env` fields.

### `stats` (`agentd.ts:261-273`)

Lightweight liveness probe used by the smolvm backend's `waitForAgentd`: returns `{ cpu: 0, memMb: <rss rounded>, diskMb: 0, processes: 1, browserRunning: false, browserAvailable: false }` — memory is real, the other fields are static.

### `browser` (`agentd.ts:275-319`)

**Canned responses only.** For `action: "exec" | "cdp" | "dialog" | "vault"` it returns static success payloads (`stdout: "Page evaluated successfully"`, `result: { protocolVersion: "1.3", success: true }`, `injected: true, masked: true`, …), and for any other action `{ ok: true, message: "browser session ready" }`. No browser is launched by this handler; it is a stub kept for protocol compatibility.

### `startEgressRelay` (`agentd.ts:333-347`)

In a no-network microVM, the mounted egress socket is the only way out — but ordinary HTTP clients expect a TCP proxy. The relay listens on `127.0.0.1:<port>` (default 8080, matching the `HTTP_PROXY=127.0.0.1:8080` env injected at VM creation) and pipes raw bytes both ways between the TCP client and the host-side Unix socket. Errors on either side tear down both.

---

## 🧰 `agentd-cli` — The One-Shot Client

`agentd-cli.ts` is what every non-socket transport executes (`docker exec … /opt/agentd/agentd-cli`, `smolvm machine exec …`, `node agentd-cli.mjs` on E2B). Its job: read a request, send it to the socket, stream the response frames to stdout, exit.

### Input modes (`readRequest`, `agentd-cli.ts:12-23`)

Linux caps a single argv string at **128 KiB** (`E2BIG` beyond that), so callers split large requests (file writes, patches):

- `agentd-cli <chunk1> <chunk2> …` — argv chunks are **joined in order** into one JSON string (computerd's `argvChunks` emits ≤ 100 KB pieces).
- `agentd-cli @/tmp/request.json` — the file is read and **deleted** after reading (E2B's transport writes `/tmp/saaya-req-<uuid>.json` for arbitrarily large payloads).

Unparseable input prints `Usage: agentd-cli <json-object>` to stderr and exits 1; the parsed object is only used for `op` and `timeoutMs`.

### Session behaviour (`agentd-cli.ts:34-67`)

- Connects to `AGENTD_SOCK` (default `/run/agentd.sock`) and writes the trimmed request as one line.
- Socket timeout = `request.timeoutMs` clamped to `[1_000, 300_000]` (default 60_000) **+ 15 s slack** — mirroring `responseTimeoutMs` on the computerd side.
- Each response line is echoed to stdout verbatim; completion follows the same `isFinalFrame` rule (for `op: "exec"`, until `t === "exit"` or an `error` frame; otherwise the first frame). On completion the client ends the socket.
- Frames arriving after completion are ignored (`complete` flag), which makes early exit safe even while the daemon is still streaming.
- If the daemon closes early, `agentd closed without a complete response` sets exit code 1; connection errors print `[agentd-cli] <message>` and also exit 1.

The stderr/stdout split is the transport contract: **only stdout carries frames**. The Docker transport demuxes stderr out precisely so daemon warnings can never corrupt the NDJSON stream, and the CLI transports treat stderr purely as error context.

---

## 🧪 Tests

| File                                                                          | Covers                                                                    |
| :---------------------------------------------------------------------------- | :------------------------------------------------------------------------ |
| `apps/computerd/test/agentd-exec.test.ts`                                     | exec timeout, output capping, exit-code semantics                         |
| `apps/computerd/tests/unit/agentd-exec.test.ts`                               | exec frame protocol                                                       |
| `apps/computerd/tests/unit/agentd-cli.test.ts`                                | argv-chunk joining, `@file` mode, final-frame handling                    |
| `apps/computerd/test/agentd-files.test.ts`, `tests/unit/agentd-files.test.ts` | file ops (see [agentd-files.md](agentd-files.md))                         |
| `apps/computerd/test/code-intelligence.test.ts`                               | code ops (see [agentd-code-intelligence.md](agentd-code-intelligence.md)) |

The daemon is bundled for containers by `pnpm --filter @sayabot/computerd build:agentd` (esbuild → `dist/agentd/agentd.mjs`, `dist/agentd/agentd-cli.mjs`).

## 🧾 Protocol Walkthrough

One `op: "exec"` request, end to end over the control socket:

```text
→ {"op":"exec","cmd":"npm test","cwd":"/home/bot/app","timeoutMs":60000}
← {"t":"out","d":"› running 3 tests\n"}
← {"t":"err","d":"warning: deprecated flag\n"}
← {"t":"out","d":"✔ 3 passed\n"}
← {"t":"exit","code":0,"durationMs":8412,"truncated":false}
```

And a one-frame op:

```text
→ {"op":"stats"}
← {"cpu":0,"memMb":48,"diskMb":0,"processes":1,"browserRunning":false,"browserAvailable":false}
→ {"op":"list","path":"/home/bot","depth":1}
← {"entries":[{"path":"/home/bot/app","type":"dir","size":4096,"mtime":1731648000000},…]}
```

Transports only need to honour two rules: frames are newline-delimited JSON objects, and completion follows `isFinalFrame` (`t === "exit"` or `error` for exec; one frame for everything else). Everything above this contract — Unix sockets, docker exec demuxing, smolvm socket exposure, E2B command output — is interchangeable plumbing.

---

## Related docs

- [agentd file operations & path safety](agentd-files.md)
- [agentd code intelligence](agentd-code-intelligence.md)
- [computerd overview & transports](overview.md)
- [smolvm backend (mounts the egress socket this daemon relays)](backend-smolvm.md)
- [Tool: computer (orchestrator side)](../orchestrator/tools/tool-computer.md)
