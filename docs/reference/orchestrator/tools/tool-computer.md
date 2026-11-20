# Computer Tools

The `computer` capability gives an agent a persistent desktop — a local VM (`smolvm`/Docker via computerd, `/home/bot`), a Boat (a hosted boat.dev desktop), the person's own VPS (one Docker container per bot over SSH), an E2B cloud sandbox, or the Mac itself — and the largest built-in tool family in the orchestrator: shell execution with live streaming, hash-guarded file editing, ripgrep/glob search, git helpers, TypeScript code intelligence, and (on the `browser` profile) a full CDP-driven headless Chromium suite. All tools route through one dispatcher that resolves the turn's surface with `resolveComputer` and refuses to wake a sleeping desktop — only `select_computer` may do that.

Source files: `apps/orchestrator/src/tools/builtins/computer.ts`, `apps/orchestrator/src/tools/builtins/select-computer.ts`, `apps/orchestrator/src/computer/client.ts`, `packages/core/src/commands.ts`

---

## 🎯 `select_computer` — choosing the surface (`select-computer.ts:29-56`)

Registered for every agent regardless of capabilities (`src/tools/index.ts:289-329`); Auto never starts a desktop by itself, so this tool is the only way a turn moves onto one.

| Parameter | Type                                                   | Description                      |
| :-------- | :----------------------------------------------------- | :------------------------------- |
| `surface` | enum `this_computer \| local_vm \| boat \| vps \| e2b` | The desktop to use for this turn |

- `dangerous: false`. Executes `resolveComputer(worksOn, available, surface)` from `@sayabot/core`; when the decision requires action (`wake`/`provision`/VPS run), the `apply` callback registered by `buildTools` performs it (`index.ts:293-329`): provisioning a local VM (`getComputerClient().ensure(agentId, orgId, "standard")` + persisting `params.computer.localVmReady`/`volume` on the agent row), starting the bot's VPS container via `runVpsDesktop(target, agentId, decision)` (and persisting `params.computer.vpsReady`), creating or resuming its E2B sandbox via `openSelectedE2b` (persisting `params.computer.e2bId`/`e2bReady`), or opening a Boat via `openSelectedBoat`. See [../computers/e2b.md](../computers/e2b.md) and [../computers/vps-and-client.md](../computers/vps-and-client.md).
- Returns `{ ok, surface, action, reason?, ...carried }` — e.g. `{ ok: true, surface: "boat", action: "wake" }` (`select-computer.test.ts:10-14`).
- The woken desktop is remembered on the shared turn params (`rememberSelectedDesktop`, `select-computer.ts:46`), so the next `computer_shell` call uses it.

## 🧭 Surface routing (`computer.ts:59-93`)

Each tool first calls `resolveComputer(args.worksOn, args.available)` and dispatches:

| Surface                   | Path taken                                                                                                                             | Notes                                                                                                                                                                                                                                   |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local_vm` (action `use`) | `useLocalVm()` guard → `client.*` HTTP calls to computerd                                                                              | The main path; `/home/bot` inside the VM.                                                                                                                                                                                               |
| `boat` (action `use`)     | `runBoatShell` / `boatReadCommand` / `boatWriteCommand` / `boatListCommand` / `boatClickCommand` (`src/computers/boat-shell`)          | Person's own desktop; shell tools only, no `fs_patch`/code intelligence. `computer_list` uses `/home/user` as default home (`computer.ts:566`).                                                                                         |
| `vps` (action `use`)      | `boatReadCommand` etc. through `readyServer().run` → `runVpsShell(target, agentId, cmd)`                                               | Needs the `VpsTarget` built by `vpsTargetFromSettings` (alias, or host + user + port + sealed key) from Settings → AI providers. Runs in the bot's own `sayabot-bot-<agentId>` container, home `/home/bot`. File reads use stdout only. |
| `e2b` (action `use`)      | same builders through `readyServer().run` → `runE2bShell`; `computer_shell` calls `runE2bShell` directly (supports `background: true`) | One E2B sandbox per bot, home `/home/user`. `computer_screenshot`/`computer_click` work when the template has a display.                                                                                                                |
| `this_computer`           | most tools return `{ ok: false, error: "This bot uses the Mac's screen and apps, not a container." }` (`computer.ts:133-134`)          | Screen/app control lives in the desktop bridge, not here.                                                                                                                                                                               |

`useLocalVm()` (`computer.ts:65-93`) is the local-VM guard used by every non-shell tool: it calls `client.ensure(agentId, orgId, profile)` only when the decision is already `local_vm/use`, and returns a structured error telling the agent which tool to use instead (including the hint to call `select_computer`).

`computer_shell` on a Boat or an E2B sandbox accepts `background: true`, which starts the command, returns at once and keeps that desktop awake for up to two hours; background mode is rejected on all other surfaces.

## 🖥️ Tool catalog — standard profile

`computerTools(args)` (`computer.ts:54`) returns `standardTools` for `profile: "standard"` and `standardTools + browserTools` for `"browser"` (`computer.ts:674-697, 869-881`). Every file path tool delegates to agentd inside the VM, which confines operations to `/home/bot` and `/tmp`.

### `computer_shell` (`computer.ts:95-188`)

| Parameter        | Type    | Default            | Description                                                                               |
| :--------------- | :------ | :----------------- | :---------------------------------------------------------------------------------------- |
| `command`        | string  | — (1–20,000 chars) | Shell command to execute                                                                  |
| `cwd`            | string  | optional           | Working directory; prefixed as `cd '<cwd>' && <command>` for Boat/VPS (`computer.ts:123`) |
| `timeoutSeconds` | int     | `60` (max 300)     | Kill the command after this long                                                          |
| `background`     | boolean | `false`            | Boat only — keep the Boat awake up to 2 h                                                 |

- **Danger**: `dangerous: (input) => isDestructiveCommand(input.command)` (`computer.ts:105`) — `isDestructiveCommand` (`packages/core/src/commands.ts:5-79`) matches `rm -rf /`-style deletions, `mkfs`/`dd of=/dev/*`, fork bombs, crypto miners, `curl | sh`, block-device tools, reverse shells, and privilege escalation (`sudo`, `mount`, `docker.sock`, …). Only destructive commands wait for approval ([./approvals.md](./approvals.md)).
- **Streaming**: each stdout/stderr chunk is broadcast as `tool.output` events (`{ toolCallId, seq, chunk }`) with `redactSecrets` applied per chunk (`computer.ts:163-173`).
- **Return**: `{ stdout, stderr, exit_code, duration_ms, truncated, timed_out?, note? }`; a kill at timeout adds `timed_out: true` and a note to raise `timeoutSeconds` or narrow the command (`computer.ts:183-185`).
- **Transport**: `client.exec` streams NDJSON frames (`t: "out" | "err" | "exit"`) from computerd; the response is capped at 8 MB (`client.ts:154-207`).

### `fs_read` (`computer.ts:190-235`)

| Parameter               | Type   | Default                   | Description                                                                 |
| :---------------------- | :----- | :------------------------ | :-------------------------------------------------------------------------- |
| `path`                  | string | —                         | File to read                                                                |
| `startLine` / `endLine` | int    | optional                  | 1-based inclusive page bounds (`endLine ≥ startLine` enforced by `.refine`) |
| `maxBytes`              | int    | `256_000` (max 2,000,000) | Source-byte cap per page                                                    |

Returns numbered lines (`"42 | text"`), full-file SHA-256 `hash`, `totalLines`, `bytesReturned`, `startLine/endLine`, `truncated`, `hasMore`, `nextStartLine`. Files over 32 MiB and binaries are refused. On Boat/VPS the page is built by `boatReadCommand` + `numberBoatLines` (`computer.ts:203-227`); the hash guard feeds `fs_edit`.

### `fs_edit` (`computer.ts:237-279`)

| Parameter      | Type                      | Default  | Description                                                                             |
| :------------- | :------------------------ | :------- | :-------------------------------------------------------------------------------------- |
| `path`         | string                    | —        | File to edit (≤ 5 MiB)                                                                  |
| `oldString`    | string (1–5,000,000)      | —        | Literal text to replace                                                                 |
| `newString`    | string (≤ 5,000,000)      | —        | Replacement                                                                             |
| `expectedHash` | string `/^[a-f0-9]{64}$/` | optional | SHA-256 from `fs_read`; stale hashes rejected                                           |
| `replaceAll`   | boolean                   | `false`  | Required when `oldString` matches more than once                                        |
| `whitespace`   | boolean                   | `false`  | Fallback match for one unique line block ignoring leading/trailing spaces/tabs and CRLF |

On the local VM this delegates to `client.editFile` → `POST /v1/computers/:agentId/files/edit`; on Boat/VPS the file is read with `boatCatCommand`, the edit planned locally with `planBoatEdit`, and written back — returning `{ ok, path, replacements, hash, matchMode: "exact" }` (`computer.ts:251-273`).

### `fs_patch` (`computer.ts:281-296`)

| Parameter   | Type                 | Description                                                                                                                                                           |
| :---------- | :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patchText` | string (1–5,000,000) | Patch enclosed in `*** Begin Patch` / `*** End Patch` with `*** Add File:` / `*** Delete File:` / `*** Update File:` (optional `*** Move to:`) headers and `@@` hunks |

All hunks are verified in memory before any write; any failure modifies zero files. Delegates to `client.applyPatch` → `POST /v1/computers/:agentId/files/patch`.

### `fs_write` (`computer.ts:323-352`)

| Parameter             | Type    | Default           | Description                                                      |
| :-------------------- | :------ | :---------------- | :--------------------------------------------------------------- |
| `path`                | string  | —                 | File to create/overwrite                                         |
| `content`             | string  | — (max 2,000,000) | Full file content                                                |
| `allowOverwriteLarge` | boolean | optional          | Must be `true` to deliberately overwrite an existing file > 2 KB |

Returns `{ ok: true, path, bytes }`. Boat/VPS use `boatWriteCommand`.

### `fs_glob` (`computer.ts:354-381`) and `fs_grep` (`computer.ts:383-415`)

| Tool      | Parameters                                                                      | Behavior                                                                                           |
| :-------- | :------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------- |
| `fs_glob` | `pattern` (string), `path` (optional, default `/home/bot`)                      | Runs `find <base> (-path                                                                           | -name) <pattern> -type f`excluding`node_modules`/`.git`, sorted newest first, top 100. Patterns containing `/`match the full path. Returns`{ path, pattern, matches, count }`. |
| `fs_grep` | `query` (string), `path` (optional, default `/home/bot`), `fileType` (optional) | Runs ripgrep `rg -n --no-heading --color never --max-columns 400 -m 50 [-t type] -- <query> <base> | head -n 400`. Empty output + stderr → `throw new Error("rg failed: …")`; ≥ 400 lines adds a "narrow the path or pattern" note.                                                 |

Both run through `client.exec` (local VM only — glob/grep are not implemented for Boat/VPS and fail the `useLocalVm` guard otherwise).

### Git tools (`computer.ts:417-496`)

| Tool         | Parameters                                                                      | Danger        | Command executed                                                                                                 |
| :----------- | :------------------------------------------------------------------------------ | :------------ | :--------------------------------------------------------------------------------------------------------------- |
| `git_status` | `cwd` (default `/home/bot`)                                                     | safe          | `git --no-optional-locks status -s`                                                                              |
| `git_diff`   | `cwd` (default `/home/bot`), `staged` (default `false`)                         | safe          | `git --no-optional-locks diff [--staged]`                                                                        |
| `git_commit` | `message` (string), `cwd` (default `/home/bot`), `all` (default `true`)         | **dangerous** | `git commit [-a] -m '<message>'` — always waits for approval                                                     |
| `git_push`   | `cwd` (default `/home/bot`), `remote` (default `"origin"`), `branch` (optional) | **dangerous** | `git push -- '<remote>' ['<branch>']` — push flows through the Secret Broker proxy configured inside the sandbox |

All four use `shellQuote` (`computer.ts:25-27`, POSIX single-quote escaping) and return `{ output, exitCode }` / `{ status }` / `{ diff }`.

### Code intelligence (`computer.ts:298-321`)

Five tools sharing a common shape (`codeTool` factory): `code_outline`, `code_definition`, `code_references`, `code_diagnostics`, `code_rename_preview`. TypeScript/JavaScript only, backed by the compiler language service inside the VM (`POST /v1/computers/:agentId/code`), bounded to 512 files / 24 MiB / 2 MiB per file.

Common parameters: `path`, `projectRoot` (optional; defaults to nearest `tsconfig`/`jsconfig`), `maxResults` (default 200, max 1000). Positional tools (`code_definition`, `code_references`) add `line`/`column` (1-based UTF-16, ends exclusive); `code_rename_preview` adds `newName` (1–200 chars) and returns `canRename`, `preview`, `edits` with old/new text and per-file hashes.

### Compatibility aliases and publishing (`computer.ts:498-637`)

| Tool                  | Notes                                                                                                                                                                                                                                                                                                                                                            |
| :-------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computer_read_file`  | Same schema as `fs_read`; returns the **raw page without line-number prefixes**, same hash/totalLines/nextStartLine metadata (`computer.ts:499-525`).                                                                                                                                                                                                            |
| `computer_write_file` | Alias of `fs_write` with a 1,000,000-char content cap (`computer.ts:527-555`).                                                                                                                                                                                                                                                                                   |
| `computer_list`       | `path` (optional), `depth` (1–3, default 1); Boat home default is `/home/user`, otherwise `client.listFiles` → `POST /v1/computers/:agentId/files/list` (`computer.ts:557-583`).                                                                                                                                                                                 |
| `computer_publish`    | `path`, `as` (enum `canvas \| file`, default `canvas`), `title` (optional). Reads the file, refuses truncated reads, infers canvas kind from extension (`.md` → markdown, `.svg` → svg, `.html` → html, else code), and inserts into `canvases` + `canvas_versions` with `authorType: "agent"` (`computer.ts:594-636`). Returns `{ ok, canvasId, title, kind }`. |

### Boat screen tools (`computer.ts:639-672`)

| Tool                  | Parameters                                                                                         | Behavior                                                                                                                              |
| :-------------------- | :------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `computer_screenshot` | `{}`                                                                                               | Captures the Boat screen via `captureBoatScreen`, or the E2B display via `captureE2bScreen`; errors if the Boat is not already awake. |
| `computer_click`      | `x`, `y` (int 0–32767), `button` (`left\|middle\|right`, default `left`), `count` (1–3, default 1) | Clicks a pixel point via `boatClickCommand` on a Boat or E2B sandbox; out-of-screen points return an error.                           |

## 🌐 Browser profile tools (`computer.ts:699-881`)

Added only when `caps.computer.profile === "browser"`; every tool runs `useLocalVm()` first, then `client.browser(agentId, action, input)` → `POST /v1/computers/:agentId/browser`. All are `dangerous: false`.

| Tool                 | Parameters (schema)                                                                                                    | Action                                                                                                                                                       |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser_open`       | `url` (string, url)                                                                                                    | `open` — navigate persistent Chromium                                                                                                                        |
| `browser_snapshot`   | `{}`                                                                                                                   | `snapshot` — accessibility tree with element refs                                                                                                            |
| `browser_click`      | `ref` (string\|number, optional), `selector` (string, optional)                                                        | `click`                                                                                                                                                      |
| `browser_type`       | `ref?`, `selector?`, `text` (string), `submit?` (boolean)                                                              | `type`                                                                                                                                                       |
| `browser_extract`    | `selector?`, `format` (enum `text\|markdown\|html`, default `markdown`), `maxChars` (int, default 30,000, max 100,000) | `extract`                                                                                                                                                    |
| `browser_screenshot` | `fullPage?` (boolean)                                                                                                  | `screenshot` — saved to `/home/bot/.saaya/screens/`                                                                                                          |
| `browser_exec`       | `code` (string), `language` (enum `python\|javascript`, default `python`), `timeoutSeconds` (1–120, default 30)        | `exec` — run code with pre-imported `page.*` helpers                                                                                                         |
| `browser_cdp`        | `method` (string, e.g. `Network.getCookies`), `params` (record, default `{}`)                                          | `cdp` — raw Chrome DevTools Protocol JSON-RPC                                                                                                                |
| `browser_dialog`     | `action` (enum `accept\|dismiss`), `promptText?` (string)                                                              | `dialog` — handle `alert/confirm/prompt/beforeunload`                                                                                                        |
| `browser_vault`      | `secretName` (string), `selector` (string), `submit` (boolean, default `false`)                                        | `vault` — autofill a vault credential without exposing plaintext; the orchestrator forwards `orgId` so agentd can resolve the secret (`computer.ts:857-867`) |

## 🤝 Talking to computerd (`src/computer/client.ts`)

`ComputerClient` (singleton via `getComputerClient()`) talks HTTP to `COMPUTERD_URL` with the `x-internal-secret` header (`client.ts:83-115`):

| Endpoint                                                                           | Used by                                                                                                                      |
| :--------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/computers/:agentId/ensure`                                               | `select_computer` provisioning, `useLocalVm()`, `verify_workspace`/`workspace_*` warm-up                                     |
| `POST /v1/computers/:agentId/exec`                                                 | `computer_shell`, `fs_glob`, `fs_grep`, git tools, verification/workspace scripts                                            |
| `POST /v1/computers/:agentId/files/read` \| `write` \| `edit` \| `patch` \| `list` | `fs_read`/`computer_read_file`, `fs_write`/`computer_write_file`, `fs_edit`, `fs_patch`, `computer_list`, `workspace_detect` |
| `POST /v1/computers/:agentId/code`                                                 | the five `code_*` tools                                                                                                      |
| `POST /v1/computers/:agentId/browser`                                              | all ten browser tools                                                                                                        |

`exec` is streaming NDJSON (`client.ts:124-208`): frames `{ t: "out"|"err", d }` accumulate stdout/stderr and fire `onChunk`; `{ t: "exit", code, durationMs, truncated, timedOut }` terminates. Malformed frames, exit codes outside 0–255, or > 8 MB responses throw. Lifecycle (idle sleep, LRU eviction, wake-and-retry, `503` on admission timeout) is computerd's job — see [../../core/engine-and-computers.md](../../core/engine-and-computers.md).

## 📄 Tool descriptions from docs

Shell, fs and code tools prepend their full usage manual from `apps/orchestrator/src/engine/tool-docs/<name>.md` via `describeWithDoc` (`computer.ts:37-52`), so the model sees the precise pagination/hash rules in the tool description itself.

## 🧪 Examples (from tests)

```typescript
// select-computer.test.ts:10-26
const tool = selectComputerTool({ worksOn: "auto", available: sleeping })(
  await tool.execute({ surface: "boat" }),
) // → { ok: true, surface: "boat", action: "wake" }
// woken Boat is remembered on shared params: params.computer.boatId === "box-9"

// index.test.ts:158-173 — with capabilities.computer = { profile: "standard" }
// computer_shell, fs_read, fs_edit, fs_write, fs_glob, fs_grep, git_status/diff/commit/push,
// computer_read_file, computer_write_file, computer_list, computer_publish are registered
// and code_sandbox is NOT (computer replaces the sandbox tools).
```

Related docs: [./tool-system.md](./tool-system.md) · [./tool-sandbox.md](./tool-sandbox.md) · [./tool-verification.md](./tool-verification.md) · [./tool-workspace.md](./tool-workspace.md) · [./approvals.md](./approvals.md) · [../../core/engine-and-computers.md](../../core/engine-and-computers.md)
