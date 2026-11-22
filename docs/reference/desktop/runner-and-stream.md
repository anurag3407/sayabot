# Sayabot Desktop — Local Runner & Event Streaming

The **local runner** (`LocalRunner`) lets a Sayabot bot execute on this Mac through an agent CLI the owner is already signed in to — Claude Code, Codex, GitHub Copilot, and a long list of Agent Client Protocol (ACP) and plain-text apps (see [agents-on-your-mac.md](../../agents-on-your-mac.md)). After each heartbeat it claims one queued job from the server, spawns the app in the bot's own folder (`~/Sayabot/agents/<handle>`), streams the reply and every tool step back to the room as events, and routes every permission ask through an approval card the owner can answer from any device. `mac-stream.ts` is the pure parser that turns Claude Code's `stream-json` and Codex's `exec --json` NDJSON into reply deltas and `Activity` steps. `tokenUsage` reads token counts off a Claude `result`, a Codex `turn.completed`, or an ACP `session/prompt` result. `completionBody` posts those counts, plus the model, when the job is marked done so Usage can record the app that actually ran.

Source files: `apps/desktop/src/runner.ts`, `src/mac-stream.ts`, `src/acp.ts` (ACP client used by `runner.ts`), `src/room-mcp.ts` (room tools for ACP apps), `src/approve-mcp.ts` (approval side-channel — see [local-mcp-and-models.md](./local-mcp-and-models.md))

---

## 📥 Job Claiming & Dispatch (`maybeRun`, `src/runner.ts:309`)

After every heartbeat, `main.ts` calls `runner.maybeRun(queuedJobs, settings.runnerEnabled)`. When not busy, enabled, and `queuedJobs > 0`, it claims with `POST /api/desktop/jobs/claim` (empty body) and receives `{ job }`:

```typescript
interface Job {
  id: string
  prompt: string
  app: string // e.g. "claude-code", "codex", "gemini", "ollama"
  model?: string | null // null/absent keeps the app's own default
  effort?: string | null // thinking effort, for apps that take one
  agentHandle: string
  agentName?: string
  mcp?: { url: string; token: string } | null // Sayabot room tools for this run
  allow?: string[] // owner's "always allow" rules (Claude --allowedTools syntax)
  room?: { id; name; path } | null
}
```

Dispatch (`src/runner.ts:258-263`):

| Condition                                           | Path                                                 |
| :-------------------------------------------------- | :--------------------------------------------------- |
| `app === "claude-code"` or `"codex"`                | `runWithTools` — room tools, live steps, approvals   |
| `localServerUrl(app)` is set (`ollama`, `lmstudio`) | `runLocalModel` — OpenAI-style local chat completion |
| `spec.run.kind === "acp"`                           | `runAcp` — Agent Client Protocol client              |
| anything else                                       | `runPlain` — plain text CLIs (today only `pi`)       |

Model/effort pass validation before reaching a command line: `jobModel` (`src/runner.ts:88`) accepts ids matching `/^[\w.:/@+[\]-]{1,160}$/` (and maps `"default"` → null); `jobEffort` accepts only `/^[a-z]{1,10}$/`.

---

## 🛠️ Claude Code & Codex With Room Tools (`runWithTools`, `src/runner.ts:337`)

Both apps run with Sayabot's room tools (tasks, canvas, decisions, facts) via a one-run MCP token, live step streaming, and owner approvals.

**Claude Code** (`claudeArgs`, `src/runner.ts:153`) runs `claude -p --output-format stream-json --verbose --include-partial-messages --permission-mode default --no-session-persistence --strict-mcp-config --setting-sources project,local`, plus:

- `--mcp-config` pointing at a scratch `mcp.json` (mode 0o600 in a `mkdtemp` dir `sayabot-run-*`, chmod 0700) declaring two servers: `sayabot_mac` — the approval prompt tool, spawned as `process.execPath` with `ELECTRON_RUN_AS_NODE=1` running `approve-mcp.js` against a private Unix socket — and, when `job.mcp` exists, an HTTP server `sayabot` with `Authorization: Bearer <token>`.
- `--permission-prompt-tool mcp__sayabot_mac__approve` — every permission ask becomes the approval flow below.
- `--allowedTools` with `mcp__sayabot` and the job's saved rules; `--disallowedTools` blocking `mcp__sayabot__post_message`, `wait_for_activity`, `use_secret` (`BLOCKED_ROOM_TOOLS`, `src/runner.ts:81`) since the runner posts the reply for the agent.
- Optional `--model` / `--effort`.

**Codex** (`codexArgs`, `src/runner.ts:182`) runs `codex exec --json --skip-git-repo-check --ephemeral --sandbox workspace-write -` — its own sandbox keeps writes inside the agent's folder. The `sayabot` MCP server is configured with `-c mcp_servers.sayabot.*` (url, `bearer_token_env_var=SAYABOT_MCP_TOKEN`, the same `disabled_tools`, and `default_tools_approval_mode="approve"`); the token is injected via the `SAYABOT_MCP_TOKEN` env var (`src/runner.ts:343`).

**Process plumbing** (shared): the binary is resolved with `findBinary`; the child's `PATH` is `dirname(bin)` + `EXTRA_PATH` (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.bun/bin`, `~/.npm-global/bin`) + the existing PATH, with `NO_COLOR=1` (`src/runner.ts:73-78,310-314`). Stdout is split on newlines and parsed line-by-line (`parseClaudeLine` / `parseCodexLine`); the live reply is capped at 200,000 chars, stderr kept at 4,000. The prompt goes to stdin (`child.stdin.end(job.prompt)`).

**Progress and cancel** — a 1.5 s interval (`PROGRESS_MS`) posts `POST /api/desktop/jobs/<id>` with `{ output }` (or `{}` when unchanged) and reads `reply.cancelled` to `SIGTERM` the child — so a Stop in the room reaches the Mac even while output is quiet. There is **no time limit**: a run uses this Mac and the person's own app subscription, like running the app in a terminal, so it ends only when the app finishes, someone presses Stop, or the Mac app quits (the server notices a Mac that stops checking in).

**Completion** — `finish(job, body)` posts `POST /api/desktop/jobs/<id>` with `{ output, status: "done" | "failed", error? }`. Final text priority: the stream's `result` line → Codex's message items → accumulated deltas. Failures use `failureHint` (`src/runner.ts:216`), which maps auth-flavoured stderr to "sign in on this computer" advice and otherwise takes the last 3 stderr lines (≤ 500 chars).

---

## ✅ Approval Round-Trips

### The socket (`listenForApprovals`, `src/runner.ts:439`)

Claude's `approve-mcp.js` sidecar connects to a per-run Unix socket (`approve.sock` in the scratch dir, chmod 0600) and writes one newline-delimited JSON request `{ tool_name, input, tool_use_id }`. The runner answers with `{ behavior: "allow", updatedInput }` or `{ behavior: "deny", message }`.

### The decision (`decide`, `src/runner.ts:480`)

0. **Permissions** — `job.permissions` (from the claim; absent on older servers = `ask`): `turbo` allows every step at once; `auto` allows steps `isReadOnlyStep` (`src/mac-stream.ts`) calls look-only (Read/Glob/Grep/LS/WebSearch/WebFetch/Think, or a single known status command such as `pmset -g batt`, `ls`, `git status`, `defaults read`, with no chaining, pipes, redirects, substitutions or write flags); `review` skips step 1, so every step asks. The server only sends `auto`/`turbo` when this Mac's owner picked them.
1. **Session rules first** — `allowedByRules(toolName, input, sessionRules)` short-circuits steps already allowed for good earlier in this run (not in `review`).
2. **Flush pending step events** so the step's tool card exists in the room before it becomes an approval.
3. **Create the card** — `POST /api/desktop/jobs/<id>/approvals` with `{ key: tool_use_id, toolName, args }`; the reply carries `toolCallId`. If the server is unreachable the step is **denied** ("Couldn't reach Sayabot to ask the owner…"), never silently allowed.
4. **Notify** — `notifyApproval` in `main.ts` (`src/main.ts:214`) posts a macOS notification ("`<agent>` needs your OK — wants to `<step>`"); clicking restores the window and loads the room path (`job.room.path`).
5. **Poll** — every 1.5 s (`APPROVAL_POLL_MS`) for up to 30 m 30 s (`APPROVAL_WAIT_MS`, just longer than the server's 30-minute `MAC_APPROVAL_TIMEOUT_MS`, so the server decides first): `GET /api/desktop/jobs/<id>/approvals/<toolCallId>` returns `{ status, remembered?, message? }`. `approved` → allow; `approved` with `remembered: true` → `allowRuleFor` computes a rule appended to `sessionRules`; anything else → deny with the server's message. Timeout denies with "Nobody answered in time".

ACP apps share this exact path: `runAcp` maps `session/request_permission` requests onto `decide` and converts the answer via `permissionOutcome` (`src/runner.ts:572-592`). The step's tool name comes from `toolName()` in `acp.ts`, which names ACP steps by **kind** like Claude Code's tools (`execute` → `Bash`, `edit` → `Edit`, `read` → `Read`, `search` → `Grep`, `fetch` → `WebFetch`, …) and only falls back to a name-safe title. ACP apps title shell steps with the command itself ("pmset -g batt"); sending that as the name made the server refuse every approval, so the step was denied at once and Copilot replied "Operation cancelled by user".

---

## 📡 Streaming Events (`/api/desktop/jobs/[id]/events`)

Steps accumulate in a `pending: Activity[]` buffer flushed every **700 ms** (`EVENTS_MS`) — and always before approvals and at process exit — to `POST /api/desktop/jobs/<id>/events` with `{ events }`. An `Activity` is either `{ type: "started", key, toolName, args }` or `{ type: "finished", key, ok, result? }`; the web turns them into live tool cards. Results are trimmed to 4,000 chars (`MAX_RESULT`).

## 🔍 The NDJSON Parsers (`src/mac-stream.ts`)

Pure functions, no I/O. `parseClaudeLine` (`src/mac-stream.ts:50`) handles Claude Code's `--output-format stream-json --include-partial-messages` lines:

- `stream_event` → `content_block_delta`/`text_delta` becomes a `delta`; `thinking_delta` becomes `thinking` (folded into a `<think>` block by the runner, not shown as the answer); `message_start` becomes a `"\n\n"` paragraph separator after tool steps.
- `assistant` → text blocks join into `message`; `tool_use` blocks become `started` activity keyed by block id.
- `user` → `tool_result` blocks become `finished` activity (`ok: is_error !== true`).
- `result` → `done: { text, error }`; failed when `is_error` or `subtype !== "success"`.

`parseCodexLine` (`src/mac-stream.ts:177`) handles `codex exec --json`:

- `item.started` / `item.completed` → items map to Claude-style names via `codexStep`: `command_execution` → `Bash`, `mcp_tool_call` → `mcp__<server>__<tool>`, `file_change` → `Edit` (with a change list), `web_search` → `WebSearch`. Items that only ever arrive completed (file changes, searches) emit start + finish together; `codexResult` derives `ok` from status/exit codes and clips output to the **last** 4,000 chars.
- `agent_message` items become `message`; `turn.completed` → clean `done`; `turn.failed`/`error` → `done` with the message — except self-retry noise (`Reconnecting...`) which is ignored.

ACP `agent_thought_chunk` updates are `thinking` on `acpUpdate` (`src/acp.ts`). The runner folds both Claude `thinking` and ACP thoughts with `appendThinking` in `mac-stream.ts` (a copy of the `@sayabot/core` helper, because this package's `tsc` build cannot import that TypeScript source) so the room receives one reply string and the chat can open the reasoning on click. See [Thinking blocks](../core/thinking.md).

## 📜 "Always Allow" Rules (`allowRuleFor` / `allowedByRules`, `src/mac-stream.ts:221-264`)

`allowRuleFor` mirrors the server's saved rule format (`apps/web/src/lib/mac-runner-shared.ts`):

- `Bash` → `Bash(<first> [<second>]:*)` only when the command has no chaining operators (`;`, `&`, `|`, backtick, `$(`, `>`, `<`), is ≤ 200 chars, and the first word is not `sudo`/`rm`; the second word joins the prefix when it looks like a non-flag argument.
- `WebFetch` → `WebFetch(domain:<host>)`.
- `Edit`, `MultiEdit`, `Write`, `NotebookEdit`, `WebSearch`, and `mcp__*__*` tools → the tool name itself.
- Anything else → `null` (never auto-allowed).

`allowedByRules` matches a step against those rules; Bash commands additionally match any saved `Bash(prefix:*)` rule as an exact command or prefix-with-space — chaining commands can only ever be allowed once, explicitly.

---

## 🤖 ACP Apps (`runAcp`, `src/runner.ts:621`)

`AcpConnection` (`src/acp.ts`) is a minimal JSON-RPC-over-stdio client for the Agent Client Protocol. It runs every `acp` spec — Antigravity (`agy acp`), Copilot, Cursor, Gemini CLI, OpenCode, Kiro and the rest. The flow: `initialize` (60 s) → `session/new` with `{ cwd, mcpServers, …systemPromptSetup(initialize, job.system).session }` (120 s) → optional model switch via `modelRequest`/`acpModels` (30 s, failure logged and ignored) → optional effort via `effortRequest` → `session/prompt` with `prefix + job.prompt` (no timeout). `session/update` notifications append reply deltas (capped at 200,000) and push activity; text that follows a tool step starts a new paragraph (`\n\n`), like Claude Code's `message_start`. `session/request_permission` requests go through the approval flow. Cancels send `session/cancel` then `SIGTERM` after 3 s. Failures map `isAuthError` to "run `<login ?? bin>` once and sign in" (mentioning `spec.keyEnv[0]` when the app accepts a key) — so the adapters point at `claude` / `codex login`, not the adapter binary.

### System prompt (`systemPromptSetup`)

The claim may carry `job.system` (server 1.0.32+ splits it out for ACP apps; see [runner-external-and-local](../orchestrator/engine/runner-external-and-local.md)). `systemPromptSetup(initializeResult, system)` picks how it reaches the session:

1. `agentCapabilities.sessionCapabilities.systemPrompt` advertised → ACP's `systemPrompt: { mode: "append", content: [{ type: "text", text }] }` on `session/new`.
2. `agentCapabilities._meta.antigravity.systemPrompt.append === true` (Antigravity 1.5) → `_meta: { antigravity: { systemPrompt: { append: text } } }`.
3. Otherwise `prefix = text + "\n\n"` in front of the prompt.

`maybeRun` folds `job.system` back into `job.prompt` for any non-ACP path, so only ACP sessions see it separately.

### Room tools over ACP (`roomMcpServers`, `src/room-mcp.ts`)

When the claim carries `job.mcp`, `roomMcpServers(job.mcp, { command: process.execPath, script: <dist>/room-mcp.js })` lists one **stdio** MCP server in `session/new`:

```json
{
  "name": "sayabot",
  "command": "<Sayabot executable>",
  "args": ["<dist>/room-mcp.js"],
  "env": [
    { "name": "ELECTRON_RUN_AS_NODE", "value": "1" },
    { "name": "SAYABOT_MCP_URL", "value": "<origin>/api/v1/mcp" },
    { "name": "SAYABOT_MCP_TOKEN", "value": "<one-run token>" }
  ]
}
```

Stdio is used because every ACP agent must support it, while HTTP MCP and MCP-over-ACP are optional (Antigravity 1.5 advertises no `mcpCapabilities`). `room-mcp.js` is a dependency-free bridge: each JSON-RPC line is POSTed to `SAYABOT_MCP_URL` with `Authorization: Bearer <token>` (it keeps any `mcp-session-id` header and reads JSON or `text/event-stream` bodies via `responseMessages`). The forwarding lives in `RoomMcpClient` (`send(message)` → frames to write back; none for a notification). It drops `HIDDEN_ROOM_TOOLS` (`post_message`, `wait_for_activity`, `use_secret` — the same list as `BLOCKED_ROOM_TOOLS`) from `tools/list` (`withoutHiddenTools`) and refuses calls to them locally (`hiddenToolRefusal`), because ACP apps have no `--disallowedTools`. A 401 answers "This run's room tools have expired."; network failures come back as JSON-RPC errors. With no `job.mcp` the list is empty.

### Naming MCP steps (`mcpToolName`, `isRoomToolStep`)

Each harness reports an MCP call differently, so `toolName()` checks `mcpToolName()` first and names every one `mcp__<server>__<tool>` (shapes observed in real runs; the Claude and Codex adapters aren't shipped, but other ACP apps use the same forms):

| Harness          | What it sends                                             |
| :--------------- | :-------------------------------------------------------- |
| Claude Agent ACP | `_meta.claudeCode.toolName: "mcp__sayabot__create_task"`  |
| Codex ACP        | `title: "mcp.sayabot.create_task"` with `kind: "execute"` |
| Antigravity      | `name: "mcp_sayabot_create_task"`, `kind: "other"`        |
| others           | an `mcp__…` name/title on a step whose kind isn't local   |

An `mcp__…` name or title on a step of kind `execute`/`edit`/`delete`/`move` doesn't count, so a shell command can't pass as a room tool. Antigravity's single-underscore form is only split for the `sayabot` server. `isRoomToolStep` is true for `mcp__sayabot__*`; when the run has `job.mcp`, such permission requests are answered allow-once at once, like Claude Code's `--allowedTools mcp__sayabot` (the server still applies its own approval gate to dangerous room tools). Every other permission goes through `decide`.

Verified against real `agy` 1.5 runs (Antigravity ACP Server 1.5.14): the session listed the room tools through `room-mcp.js`, called `create_task`, and followed a system prompt passed through its `_meta` extension.

## 📝 Plain-Text Apps (`runPlain`, `src/runner.ts:796`)

Only specs with `run.kind === "plain"` (today `pi`) reach this path; Gemini CLI, OpenCode and Cursor now run over ACP, so their rows below apply only if a spec is switched back to `plain`.

`commandFor` (`src/runner.ts:97`) builds argv per app (all with the validated model flag where supported):

| App                     | Command                                                                                                                          | Prompt delivery |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------- | :-------------- |
| `codex` (plain path)    | `codex exec --skip-git-repo-check --output-last-message <file> -`                                                                | stdin           |
| `gemini`                | `gemini [-m model] -p "Answer the request given on standard input."`                                                             | stdin           |
| `opencode`              | `opencode run [-m model] <last 100k chars of prompt>`                                                                            | argv            |
| `pi`                    | `pi -p [--model model] <last 100k chars>`                                                                                        | argv            |
| `cursor`                | `cursor-agent -p --output-format text [--model model]` — deliberately no `--force`, so Cursor proposes but never applies changes | argv            |
| `claude-code` (default) | `claude -p --output-format text [--model model]`                                                                                 | stdin           |

stdout accumulates (capped 200,000) and is posted as progress every 1.5 s with cancel polling. For Codex the `--output-last-message` file (if written) replaces the accumulated text as the final answer, then is unlinked. Exit 0 with non-empty text → `done`; otherwise `failed` with `failureHint`.

## 🏠 Local Models (`runLocalModel`, `src/runner.ts:878`)

Ollama (`http://127.0.0.1:11434`) and LM Studio (`http://127.0.0.1:1234`) jobs stream one chat completion from the server's OpenAI-style `POST /v1/chat/completions` with `{ model, stream: true, messages: [user prompt] }` — text only, no tools. SSE `data:` lines are parsed by `localDelta` (`src/runner.ts:819`), which extracts `choices[0].delta.content` and stops at `[DONE]`. Progress/cancel/deadline match the other paths; `ECONNREFUSED` becomes "Ollama/LM Studio isn't running on this computer." A missing model id fails with "Pick a `<name>` model for this bot first."

---

## Related docs

- [Overview (lifecycle, IPC, storage)](./overview.md)
- [Host service (registration & heartbeat)](./host.md)
- [Local agents & injector](./local-agents-and-injector.md)
- [Local MCP & model discovery](./local-mcp-and-models.md)
- [Desktop Host API (server side)](../web/api/api-desktop.md)
- [Agents on your Mac](../../agents-on-your-mac.md)
- [Agents UI](../web/pages/agents-ui.md)
