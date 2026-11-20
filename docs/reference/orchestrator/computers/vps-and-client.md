# VPS Computers, the Sleep Scan & the Computerd Client

Three pieces of the computer layer live beside the Boat code: the Docker-over-SSH driver that turns a person's own server into a desktop surface (`computers/vps.ts`), the idle scan that stops forgotten Boat desktops after 10 minutes while never touching a VPS (`computers/sleep.ts`), and the orchestrator-side HTTP client that talks to `computerd`/`agentd` for the local-VM surface (`computer/client.ts`). The VPS path deliberately has no client class — it shells out to `ssh`; the sleep path is a scheduled maintenance pass; the client path is the one every local-VM tool call and the memory mirror use.

Source files: `apps/orchestrator/src/computers/vps.ts`, `apps/orchestrator/src/computers/open-vps.ts`, `apps/orchestrator/src/computers/sleep.ts`, `apps/orchestrator/src/computer/client.ts`

---

## 🖥️ VPS desktops (`computers/vps.ts`, `computers/open-vps.ts`)

A "VPS" is the person's own Linux server with Docker. Settings → Computers saves it one of two ways in `org_computer_settings`:

| Way             | Columns                                                | How Sayabot connects                                                                                                                                                      |
| :-------------- | :----------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Address and key | `vps_host`, `vps_user`, `vps_port`, sealed `vps_key_*` | `ssh -i <0600 temp file> -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=<SAYABOT_SSH_DIR or ~/.sayabot>/known_hosts -p <port> user@host` |
| SSH config name | `vps_ssh_alias`                                        | `ssh <alias>`, using the orchestrator machine's own `~/.ssh/config` and agent; no key stored                                                                              |

`vpsTargetFromSettings(row, kek)` (`open-vps.ts`) turns the row into a `VpsTarget` — `{ kind: "host", host, user, port, privateKey }` (host wins; user defaults to `root`, port to 22; a key that will not decrypt becomes `null`) or `{ kind: "alias", alias }` — and `vpsTargetForOrg(orgId)` reads it for one workspace. Every ssh call starts with `-o BatchMode=yes -o ConnectTimeout=15 -o LogLevel=ERROR`, so key-based auth is mandatory and no prompt can hang a turn. `validateVpsTarget` refuses aliases outside `/^[A-Za-z0-9_.:@-]+$/` (_"Use the SSH config name of your server"_), hosts or aliases starting with `-`, bad user names and ports outside 1–65535. For a host target the private key is written to a fresh `mkdtemp` directory with mode 0600 for that one call and removed in `finally`; the server's host key is pinned on first use, so a changed host key is refused later.

For orientation, the three surfaces these files serve differ sharply in transport and ownership:

| Surface    | Transport                                  | Home                  | Who sleeps it                                      |
| :--------- | :----------------------------------------- | :-------------------- | :------------------------------------------------- |
| `local_vm` | `ComputerClient` HTTP → computerd → agentd | `/home/bot`           | computerd idle scan (10 min)                       |
| `boat`     | `BoatClient` REST → boat.dev               | `/home/user` + `/tmp` | `sleepIdleBoats` scan (10 min idle, routine-aware) |
| `vps`      | `ssh` + `docker exec`                      | `/home/bot`           | Nobody — Sayabot never stops the server            |
| `e2b`      | E2B SDK → e2b.dev ([./e2b.md](./e2b.md))   | `/home/user`          | E2B itself pauses it after 10 idle minutes         |

### One container per bot

`vpsContainerName(agentId)` is `sayabot-bot-<agentId>` (the id must match `/^[A-Za-z0-9_.-]{1,80}$/`), with a Docker volume of the same name at `/home/bot`. Bots never share a container, so files, processes and secret identity stay apart.

### Lifecycle command: `vpsDesktopRemote(agentId, decision)`

| `decision.action`    | Remote command                                                                                                                                          |
| :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provision` / `wake` | `docker start <name> >/dev/null 2>&1 \|\| docker run -d --name <name> --restart unless-stopped -v <name>:/home/bot -w /home/bot <image> sleep infinity` |
| `use`                | `docker inspect -f '{{.State.Running}}' <name>`                                                                                                         |

`<image>` is `SAYABOT_VPS_IMAGE` or `ubuntu:24.04`; `docker run` pulls it when the server does not have it, so `runVpsDesktop(target, agentId, decision)` allows 300 s. The remote string is refused if it contains `shutdown`, `poweroff`, `reboot` or `halt` (_"Sayabot does not turn that server off"_). `--restart unless-stopped` brings containers back after a server reboot. After a successful provision the select_computer apply callback stores `params.computer.vpsReady = true` on the bot.

Placement: a bot **pinned** to `vps` (Works on → Cloud desktop → Self-hosted VPS) may start its container when it calls `select_computer`; a bot on Auto may do so only when `vps_start_automatically` is on (see [../../core/engine-and-computers.md](../../core/engine-and-computers.md)).

### Execution: `vpsExecRemote`, `runVpsShell`, `runOnVps`

`vpsExecRemote(agentId, command)` builds `docker exec -i -w /home/bot <name> sh -lc '<command>'` (single-quoted with `shellQuote`; empty commands and `\0` are refused, newlines are allowed). `runVpsShell(target, agentId, command, timeoutMs = 60_000)` runs it through `runOnVps`, which spawns `ssh` and returns `VpsResult = { ok, output, stdout }`:

- `stdout` is capped at 2 MiB and is what file reads (`fs_read`, `fs_edit`, `computer_list`) use, so ssh or shell warnings never leak into file contents;
- `output` is stdout plus stderr (stderr capped at 64 KB), for people and shell results;
- `ok` is exit code 0 without a timeout; a timeout kills ssh and appends `(timed out after Ns)`;
- nothing throws — invalid input or spawn errors come back as `{ ok: false, output }`.

### Connection check

`POST /internal/computers/vps/check { orgId }` (`internal/routes.ts`, behind the internal secret) runs `VPS_CHECK_REMOTE` = `docker version --format '{{.Server.Version}}'` with a 25 s timeout and answers `{ ok: true, docker }` or `{ ok: false, error }` with a plain hint for "SSH works but this login cannot use Docker" and "Docker is not installed". The web "Check connection" button calls it, so the check runs from the machine that will run the bots' commands.

## 😴 The Boat sleep scan (`computers/sleep.ts`)

`sleepIdleBoats(now = Date.now())` (`sleep.ts:47-126`) is the companion to `boatShouldSleep` in `@sayabot/core`. It stops Boats that have been idle for 10 minutes and marks them `"sleeping"` on their agent row. Files stay on Boat and wake with the desktop; **a VPS is never stopped** — the scan only looks at `params.computer.boatState === "running"` Boats (`sleep.ts:98`), and its doc comments state the rule twice.

### Inputs gathered in one `Promise.all` (`sleep.ts:49-64`)

| Query                                                             | Purpose                                                                |
| :---------------------------------------------------------------- | :--------------------------------------------------------------------- |
| `agents` (id, orgId, params), limit 200                           | The bots whose `params.computer` may hold a running Boat               |
| `routines` where `enabled = true` (agentId, nextRunAt), limit 200 | Earliest upcoming routine per agent — a desktop must stay awake for it |
| `orgComputerSettings` (all rows)                                  | Per-org Boat key (sealed) for the stop calls                           |

The routine rows fold into a `nextByAgent` map of the smallest `nextRunAt` per agent (`sleep.ts:65-71`). Org keys are decrypted with `MESH_KEK` and passed through `boatCredential(own, process.env.SAYABOT_BOAT_TOKEN)` into a `orgId → token` map; orgs without their own key fall back to the Cloud relay token via `boatCredential(null, SAYABOT_BOAT_TOKEN)` (`sleep.ts:72-91`). A missing `MESH_KEK` is tolerated (`kek = ""`), as are per-row decryption failures.

### The decision: `idleBoatIds` + `boatShouldSleep` (`sleep.ts:21-35`, `packages/core/src/computers.ts:223-244`)

For each running Boat the scan evaluates one row:

```typescript
boatShouldSleep({ now, lastUsedAt, nextRoutineAt, backgroundStartedAt, watching })
```

`boatShouldSleep` keeps the desktop awake when any of these hold:

| Condition                                                             | Effect                                                                                                                                                                                                                    |
| :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `watching === true`                                                   | Someone is watching the screen or holding the desktop — never sleep                                                                                                                                                       |
| `now - backgroundStartedAt < BOAT_BACKGROUND_MAX_MS` (2 h)            | A background command is inside its keep-awake window                                                                                                                                                                      |
| `nextRoutineAt` within ±30 min of `now` (`BOAT_ROUTINE_LOOKAHEAD_MS`) | A routine is about to run or just started — the desktop must be there                                                                                                                                                     |
| `lastUsedAt === null`                                                 | `boatShouldSleep` alone would return true, but `idleBoatIds` pre-filters `row.lastUsedAt !== null`, so a Boat whose use was never recorded is **left alone** (`sleep.ts:21-25`: "A missing last-used time is left alone") |

Otherwise it sleeps when `now - lastUsedAt >= BOAT_IDLE_MS` (10 minutes).

### The stop (`sleep.ts:93-125`)

For each due Boat: `new BoatClient({ token, api: process.env.SAYABOT_BOAT_API || undefined }).stop(boatId)` (the `POST /sandboxes/:id/stop` from [./boat.md](./boat.md)), then the agent row's `params.computer.boatState` is rewritten to `"sleeping"` — keeping all other computer fields intact — and `stopped` increments. Failures to find a token skip the bot silently; the whole scan is invoked defensively from the routine scheduler so it can never break the routine loop (`apps/orchestrator/src/scheduler/routines.ts:226-231`):

```typescript
try {
  await sleepIdleBoats(now.getTime())
} catch (error) {
  console.warn("[computers] boat sleep scan skipped", error)
}
```

It runs at the end of every routine-scheduler scan pass, under the scheduler's advisory lock — the same instance that claims routines also puts desktops to bed.

## 🔗 `ComputerClient` (`computer/client.ts`)

The orchestrator-side HTTP client for **computerd**, the daemon that manages local-VM computers (smolvm/Docker/E2B backends — see [../../tools-and-sandboxes.md](../../../tools-and-sandboxes.md)) and their in-VM `agentd` file/terminal daemon. This is the client behind `useLocalVm()` in the computer tools, the verification/workspace tools, and the memory mirror's `writeFile`/`exec` calls ([../memory/scheduler-and-mirror.md](../memory/scheduler-and-mirror.md)).

### Construction and auth (`client.ts:83-115`)

`new ComputerClient(baseUrl?, internalSecret?)` defaults to `getEnv().COMPUTERD_URL` (default `http://localhost:4100`, `apps/orchestrator/src/env.ts:11`) and `getEnv().ORCHESTRATOR_INTERNAL_SECRET` (required, min 16 chars, `env.ts:9`). Every request carries `content-type: application/json` and `x-internal-secret: <secret>`. Response handling is strict: non-2xx throws `Computerd error (<status> <statusText>): <body>`; a body that is not a non-array object throws `"Invalid computerd response"`; an object with an `error` key throws `Computerd error: <error>` — so agentd-level failures surface as thrown errors, not `{ ok: false }`.

### Endpoints

| Method             | Path                                 | Signature                                                                                                                                                                           | Notes                                                                       |
| :----------------- | :----------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| `ensure`           | `POST /v1/computers/:agentId/ensure` | `(agentId, orgId, profile: "standard" \| "browser")` → `{ status, ip? }`                                                                                                            | Wakes/creates the agent's computer; `profile` matches `computerProfileEnum` |
| `exec`             | `POST /v1/computers/:agentId/exec`   | `(agentId, { cmd, cwd?, env?, timeoutMs?, stdin?, runId?, onChunk? }, signal?)` → `ExecResult`                                                                                      | Streaming NDJSON, see below                                                 |
| `readFile`         | `POST .../files/read`                | `ReadFileArgs` → `FilePage`                                                                                                                                                         | Paging reads                                                                |
| `writeFile`        | `POST .../files/write`               | `{ path, content, encoding?, mode?, allowOverwriteLarge? }` → `{ bytes }`                                                                                                           | `allowOverwriteLarge: true` is what the memory mirror passes                |
| `editFile`         | `POST .../files/edit`                | `{ path, oldString, newString, expectedHash?, replaceAll?, whitespace? }` → `{ ok, path, bytes, hash, previousHash, replacements, matchMode }`                                      | Hash-guarded exact edit                                                     |
| `applyPatch`       | `POST .../files/patch`               | `{ patchText }` → `{ ok, summary, files: PatchFileResult[] }`                                                                                                                       | Multi-file add/delete/update/move                                           |
| `codeIntelligence` | `POST .../code`                      | `{ action: "outline" \| "definition" \| "references" \| "diagnostics" \| "rename_preview", path, projectRoot?, line?, column?, newName?, maxResults? }` → `Record<string, unknown>` | TypeScript intelligence in the VM                                           |
| `listFiles`        | `POST .../files/list`                | `{ path?, depth? }` → `{ entries: FileEntry[] }`                                                                                                                                    | `FileEntry = { path, type: "file"\|"directory"\|"other", size, mtime }`     |
| `browser`          | `POST .../browser`                   | `(agentId, action, params)` → `unknown`                                                                                                                                             | CDP-driven browser actions (`browser` profile)                              |
| `stop`             | `POST .../stop`                      | `(agentId)` → `{ ok }`                                                                                                                                                              | Sleep the computer                                                          |
| `stats`            | `GET .../stats`                      | `(agentId)` → `Record<string, unknown>`                                                                                                                                             | Capacity/idle info                                                          |

`getComputerClient()` (`client.ts:274-280`) memoises one client for the process.

### The NDJSON exec protocol (`client.ts:124-208`)

`exec` is the one streaming endpoint and the core of `computer_shell`. It posts the args (with the caller's `AbortSignal` attached so turn aborts cancel the command), then consumes the response body as newline-delimited JSON frames:

- `{ "t": "out" | "err", "d": "<chunk>" }` — appended to `stdout`/`stderr` and forwarded to `args.onChunk(chunk)`, which is how the tools broadcast live output events to the room;
- `{ "t": "exit", "code", "durationMs"?, "truncated"?, "timedOut"? }` — terminal frame;
- anything else — `"Unknown exec frame"`; a frame after exit, a missing exit frame, or a non-integer exit code outside 0–255 all throw.

Validation is defensive throughout: the whole response is capped at 8 MB (`received > 8 * 1024 * 1024` → throw, `client.ts:192`), the UTF-8 decoder is `fatal: true` so a malformed stream fails loudly, and on any error the reader is cancelled and the lock released. The resolved `ExecResult` is `{ stdout, stderr, exitCode, durationMs, truncated, timedOut? }` — `timedOut` is set only when the frame says so, which is what lets `computer_shell` distinguish a command's own failure from a timeout kill.

Result types `ExecResult`, `FilePage`, `EditFileArgs`, `ApplyPatchResult`, `CodeIntelligenceArgs` and `FileEntry` are all exported from `client.ts:3-81` and re-used by the tool layer; `FilePage`'s pagination fields (`startLine`/`endLine`/`nextStartLine`/`nextOffsetBytes`/`hasMore`) are what make large-file reads paged in `fs_read`.

The two shapes callers rely on most:

```json
// ExecResult — one streamed command
{ "stdout": "…", "stderr": "", "exitCode": 0,
  "durationMs": 412, "truncated": false, "timedOut": false }

// FilePage — one paged read
{ "path": "/home/bot/notes.md", "content": "…", "encoding": "utf8",
  "size": 5120, "bytesReturned": 1024, "hash": "9f2a…",
  "truncated": false, "hasMore": true, "totalLines": 210,
  "startLine": 1, "endLine": 40, "linesReturned": 40,
  "nextStartLine": 41, "nextOffsetBytes": null }
```

The `hash` on a `FilePage` (and the `previousHash` returned by `editFile`) is the intended input to `expectedHash` on the next edit — the optimistic-concurrency chain that the Boat path reimplements locally in `planBoatEdit` ([./boat.md](./boat.md)).

## 🧪 Tests

- `apps/orchestrator/src/computers/vps.test.ts` — per-bot container names, `vpsDesktopRemote` start-or-run without shutdown words, `vpsExecRemote` quoting, `vpsSshPrefix` for an alias and for host + user + port + key (and refusals of option-injection hosts, bad users and ports), and `vpsTargetFromSettings` preferring a host over the alias.
- `apps/orchestrator/src/computers/sleep.test.ts` — `idleBoatIds` sleeps an idle Boat but keeps one with an upcoming routine or a running background command (`sleep.test.ts:7-18`); the `boatShouldSleep` constants themselves are covered in `packages/core/src/computers.test.ts`.
- `apps/orchestrator/src/computers/boat.test.ts` / `boat-shell.test.ts` / `apply-boat.test.ts` — the Boat client, shell builders and decision applier ([./boat.md](./boat.md)).
- `computer/client.ts` has no dedicated test file in-repo; its behaviour is exercised indirectly by the tool-layer tests and the mirror tests that stub `writeFile`/`exec`.

Related docs: [./boat.md](./boat.md) · [../tools/tool-computer.md](../tools/tool-computer.md) · [../memory/scheduler-and-mirror.md](../memory/scheduler-and-mirror.md) · [../../tools-and-sandboxes.md](../../../tools-and-sandboxes.md) · [../../architecture/configuration.md](../../architecture/configuration.md)
