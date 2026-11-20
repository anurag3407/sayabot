# Sayabot Desktop — Local MCP, Approval Prompt & Model Discovery

Three small modules round out the desktop's "local computer" surface. `local-mcp.ts` executes whitelisted local MCP programs (Obsidian, Paper, Apple/iCloud apps) on behalf of queued server calls. `approve-mcp.ts` is the dependency-free stdio MCP server that Claude Code talks to for permission prompts during local runner jobs. `local-models.ts` discovers what each installed agent app can run — account model lists and locally-served models (Ollama, LM Studio) — so the web's model picker can offer them.

Source files: `apps/desktop/src/local-mcp.ts`, `src/approve-mcp.ts`, `src/local-models.ts`, `src/acp.ts` (ACP model discovery used by `appModels`)

---

## 🧩 Local MCP Execution (`src/local-mcp.ts`)

Sayabot agents can call MCP servers that only make sense on the owner's computer. The Mac app polls these via the heartbeat (`mcpCalls` count → `LocalMcpHost.maybeRun`, `src/local-mcp.ts:142`), claims one call with `POST /api/desktop/mcp/claim`, receiving:

```typescript
interface McpCall {
  id: string
  serverId: string
  appId: string // picks the fixed command below
  method: string // "tools/list" | "tools/call" only
  params: Record<string, unknown>
  env: Record<string, string> // filtered allowlist
}
```

**Hard allowlists** (`src/local-mcp.ts:21-37`):

| appId        | Command                                                      |
| :----------- | :----------------------------------------------------------- |
| `obsidian`   | `npx -y obsidian-mcp-server`                                 |
| `paper`      | `paper mcp` — preferring `~/.paper/bin/paper` when it exists |
| `apple-apps` | `npx -y mcp-icloud`                                          |

| Refusal                                    | Trigger                                                            |
| :----------------------------------------- | :----------------------------------------------------------------- |
| "That call isn't allowed."                 | `method` is anything but `tools/list` / `tools/call`               |
| "That app isn't allowed on this computer." | `appId` not in the table above (a job cannot name its own program) |

Anything else is refused with "That app isn't allowed on this computer.", and any method other than `tools/list`/`tools/call` is refused with "That call isn't allowed." A job cannot name its own program. From `call.env`, only `OBSIDIAN_API_KEY`, `OBSIDIAN_HOST`, `OBSIDIAN_PORT` (`ENV_KEYS`) are copied into the child environment; everything else is ignored.

**`StdioSession`** (`src/local-mcp.ts:39`) keeps one child process alive per `serverId` (map `sessions`, reused across calls so a warm server answers subsequent calls without restart). It speaks JSON-RPC 2.0 with **MCP Content-Length framing** (`frame`, `src/local-mcp.ts:131`): `initialize` with `protocolVersion: "2024-11-05"`, `clientInfo: { name: "sayabot", version: "1" }`, then the `notifications/initialized` notification. Requests get 20-second timeouts; responses are matched by numeric `id` from a buffered parser that reads `content-length` headers (a header without a parseable length drops the buffer); notifications without ids are ignored. A child exit rejects all waiters with "The local app stopped" and clears the process so the next call re-`initialize`s. Any call failure deletes and kills the session so the next call starts fresh, and the error is reported back.

Results and errors go to `POST /api/desktop/mcp/<call.id>` — `{ result }` or `{ error }` (see the server side in [api-desktop.md](../web/api/api-desktop.md)).

A full round trip, for an agent calling Obsidian's search:

```
room agent → orchestrator marks a desktop MCP call → heartbeat reports mcpCalls: 1
→ LocalMcpHost.maybeRun(1) → POST /api/desktop/mcp/claim
→ { call: { id, serverId: "obsidian-main", appId: "obsidian",
            method: "tools/call", params: { name: "search_notes", arguments: {…} },
            env: { OBSIDIAN_API_KEY: "…" } } }
→ commandFor("obsidian") → npx -y obsidian-mcp-server
→ env: only OBSIDIAN_API_KEY / OBSIDIAN_HOST / OBSIDIAN_PORT copied from call.env
→ session "obsidian-main" (reused if warm): initialize → initialized → tools/call
→ POST /api/desktop/mcp/<id> { result: { content: [...] } }     (or { error } on timeout/exit)
```

Timing at a glance: a claimed call must produce a result within the session's 20-second request timeout (or the child's lifetime, whichever ends first); the claim loop itself runs once per heartbeat burst and never queues a second concurrent call.

## ✅ Claude Code's Approval Prompt (`src/approve-mcp.ts`)

During Claude Code runner jobs, `--permission-prompt-tool mcp__sayabot_mac__approve` makes Claude start this file as a **stdio MCP server** (spawned by the runner as `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, see [runner-and-stream.md](./runner-and-stream.md)). It is intentionally dependency-free: newline-delimited JSON-RPC on stdin/stdout.

- `initialize` → echoes the requested `protocolVersion` (default `"2025-06-18"`), capabilities `{ tools: {} }`, `serverInfo { name: "sayabot_mac", version: "1.0.0" }`.
- `tools/list` → one tool, `approve` ("Asks the owner of this Mac whether the agent may take a step that needs permission"), schema `{ tool_name, input, tool_use_id? }`.
- `tools/call` → `ask()` (`src/approve-mcp.ts:35`) connects to the Unix socket in `SAYABOT_APPROVAL_SOCKET`, writes `{ tool_name, input, tool_use_id }` + newline, and waits up to **6 minutes** (`ANSWER_TIMEOUT_MS`, deliberately longer than the server's five-minute approval window so the server's answer always wins). An `allow` answer resolves with `updatedInput` (defaulting to the original input); anything else is a deny.
- **Failure always means "no"** (`src/approve-mcp.ts:40-41`): missing socket env, connection error, unreadable answer, timeout, or socket close all deny with a plain-words message — never a silent yes. Each `tools/call` opens a fresh socket connection, reads exactly one newline-delimited answer, and destroys the socket; concurrent permission asks get their own connections, which the runner's socket server handles one at a time per buffered request.
- `ping` → `{}`; unknown requests with an id get JSON-RPC error `-32601`; notifications are ignored. The process reads stdin through a `readline` interface and exits with the parent CLI — there is no state to clean up.

The runner side (socket server, approval cards, polling) is documented in [runner-and-stream.md](./runner-and-stream.md). The decision payload crossing the socket is `{ behavior: "allow", updatedInput? }` or `{ behavior: "deny", message? }` — Claude receives it inside the `tools/call` result as a single JSON text block (`src/approve-mcp.ts:119`).

Protocol methods handled (`handle`, `src/approve-mcp.ts:91`):

| Method                   | Reply                                                                                                                                                  |
| :----------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`             | echoes the client's `protocolVersion` (default `"2025-06-18"`), `capabilities: { tools: {} }`, `serverInfo: { name: "sayabot_mac", version: "1.0.0" }` |
| `tools/list`             | the single `approve` tool with its input schema (`tool_name` and `input` required, `tool_use_id` optional)                                             |
| `tools/call`             | runs `ask()` against the approval socket and wraps the decision as text content                                                                        |
| `ping`                   | empty result (keep-alive)                                                                                                                              |
| anything else with an id | JSON-RPC error `-32601` "Unknown method …"                                                                                                             |
| notifications (no id)    | no reply                                                                                                                                               |

---

## 🔖 Model Discovery (`src/local-models.ts`)

`ReportedModel` is `{ id, label, effort?, defaultEffort?, isDefault? }` — ids must match `/^[\w.:/@+[\]-]{1,160}$/`, labels are strings of at most 120 chars, effort levels must match `/^[a-z]{1,10}$/`, lists are capped at 200 (`MAX_MODELS`), and only names/ids ever leave the Mac. All of these limits are enforced centrally by the `text`/`levels` helpers (`src/local-models.ts:28-41`) before anything is stored or reported.

### Per-app sources (`appModels`, `src/local-models.ts:231`)

`appModels(app, binary, version)` reads each app's models, cached per app id in `listCache` — refreshed after **6 hours** (`LIST_FRESH_MS`) or whenever the app's reported version changes; when a fresh read fails, the last good list for the same version is reused (`src/local-models.ts:252-254`).

| App           | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `claude-code` | `fetchClaudeModels` (`src/local-models.ts:101`): spawns `claude -p --input-format stream-json --output-format stream-json --verbose --setting-sources user --strict-mcp-config --mcp-config '{"mcpServers":{}}'` in the temp dir, sends **only** a `control_request` `{ subtype: "initialize" }` (no prompt, so nothing runs or is spent), and parses the `control_response` whose `request_id` matches. `claudeRowsToModels` (`src/local-models.ts:74`) resolves aliases via `resolvedModel`, marks the `"default"` alias's target `isDefault`, and reads `supportsEffort`/`supportedEffortLevels`. 15 s timeout; 4 MB stdout guard. |
| `codex`       | `codexModels` (`src/local-models.ts:172`): reads `models_cache.json` under `$CODEX_HOME` (default `~/.codex`) — the list Codex itself refreshes whenever it runs — skipping `visibility: "hidden"` rows and reading `supported_reasoning_levels`/`default_reasoning_level` for effort.                                                                                                                                                                                                                                                                                                                                                |
| `pi`          | `piModels`: runs `pi --list-models` (15 s timeout) and parses the two-column table into `provider/model` ids via `piRowsToModels`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ACP apps      | `discoverAcpModels(binary, args)` from `acp.ts` starts the app, reads model config options/groups out of `initialize`/`session/new`, and detects how to switch (`config` option vs older `session/set_model`). Runs in `tmpdir()/sayabot-models` with `NO_COLOR=1`.                                                                                                                                                                                                                                                                                                                                                                   |

ACP discovery reuses the same launch arguments the runner would use (`spec.run.args`), so what it reports is exactly what a real run would see. Grouped options (`{ name, options: [...] }`) are flattened up to six levels deep, duplicates are dropped, and the app's current model is detected from the session state — the same `AcpModelList { models, current, setter }` machinery `runAcp` later uses for `job.model` switches.

### Accounts

`claudeAccount` (`src/local-models.ts:46`) returns `"email · Org"` from `~/.claude.json`'s `oauthAccount` (the settings file, **not** credentials), and `geminiAccount` returns the active entry from `~/.gemini/google_accounts.json`. These feed the heartbeat's `localAgents` (see [local-agents-and-injector.md](./local-agents-and-injector.md)) — they are the only two apps whose account label is read, since the others keep identity inside their own tokens or config.

### Local model servers

`LOCAL_SERVERS` (`src/local-models.ts:266`) defines the two supported runtimes: **Ollama** at `http://127.0.0.1:11434` (list via `/api/tags`) and **LM Studio** at `http://127.0.0.1:1234` (list via `/v1/models`). `detectLocalModelServers` (`src/local-models.ts:290`) probes both with a 1.5 s timeout and parses either shape (`models[]` or OpenAI `data[]`) via `localServerModels` — reading `model`, then `name`, then `id` as the model id, deduping ids and **skipping anything matching `/embed/i`** since embedding models can't answer a chat. Servers with zero downloaded models report `signed_out` status in the agent list; unreachable servers are simply absent (a failed probe is never an error).

The runner consumes these the other way: `localServerUrl(id)` (`src/local-models.ts:308`) maps `ollama`/`lmstudio` job apps to their base URL for `runLocalModel`'s `/v1/chat/completions` streaming (see [runner-and-stream.md](./runner-and-stream.md)). Any other id — a CLI app id, for instance — returns `null`, which is how `maybeRun` decides a claimed job is not a local-model job.

Constants worth knowing (`src/local-models.ts:23-26`): model lists refresh every **6 hours** (`LIST_FRESH_MS`) or on a version change, each CLI invocation is capped at **15 seconds** (`CLI_TIMEOUT_MS`) with a 2–4 MB stdout guard, and every reported list is capped at **200 models** (`MAX_MODELS`). The cache is keyed by app id and stores the last good list per version, so a flaky CLI never blanks out a picker that worked a moment ago.

---

## Related docs

- [Local runner & event streaming](./runner-and-stream.md)
- [Local agents & injector](./local-agents-and-injector.md)
- [Host service (registration & heartbeat)](./host.md)
- [Desktop Host API (server side)](../web/api/api-desktop.md)
- [Agents on your Mac](../../agents-on-your-mac.md)
- [MCP & connectors](../../mcp-and-connectors.md)
- [Agents UI](../web/pages/agents-ui.md)
