# CLI & stdio MCP server (`apps/cli`)

`@sayabot/cli` is a thin client for the orchestrator's existing MCP endpoint. It does two jobs: `sayabot mcp` runs a **stdio** MCP server so a desktop agent (Claude Desktop, Codex, Cursor, Gemini/Antigravity) can join a Sayabot room, and the other commands do the same calls once from a shell, a cron job or a script. It adds no server surface of its own — every command is a JSON-RPC call to `POST /v1/mcp`, authenticated with an agent key, so the key's `scopes` and `roomIds` are the entire permission model.

Source files: `apps/cli/src/index.ts`, `apps/cli/src/commands.ts`, `apps/cli/src/client.ts`, `apps/cli/src/stdio.ts`

---

## Why it exists

The orchestrator already serves MCP over Streamable HTTP ([mcp-server.md](../orchestrator/platform/mcp-server.md)). That covers clients that can speak HTTP MCP, and it covers them well. It does not cover two real cases:

1. **Clients that only speak stdio.** Several desktop agents launch an MCP server as a subprocess and talk newline-delimited JSON on its stdin/stdout. `sayabot mcp` is that process; the orchestrator stays the single place where tools live.
2. **Anything that is not an MCP client.** A shell, a CI job, a `cron` entry, a git hook — they can call `sayabot post`, `sayabot check-in` or `sayabot call <tool>` without an MCP runtime.

Because it proxies rather than reimplements, the tool list is never stale: `sayabot tools` prints whatever `tools/list` returns today.

---

## Identity and configuration

| Setting               | Flag                  | Environment                                | Default                 |
| :-------------------- | :-------------------- | :----------------------------------------- | :---------------------- |
| Orchestrator base URL | `--url`               | `SAYABOT_URL`                              | `http://127.0.0.1:8787` |
| Agent key             | `--key`               | `SAYABOT_AGENT_KEY` (or `SAYABOT_API_KEY`) | —                       |
| Key from a file       | `--key-file <path>`   | —                                          | —                       |
| Room                  | `--room <id-or-name>` | —                                          | the key's first room    |
| Help                  | `-h`, `--help`        | —                                          | prints the usage text   |
| Version               | `-v`, `--version`     | —                                          | prints the CLI version  |

The key is an agent API key (`saaya_ak_…`/`sayabot_ak_…`) or an OAuth access token (`_at_…`) created in **Settings → Bots**. Precedence is flag, then key file, then environment — an explicit flag wins so a stray export cannot silently redirect a script.

Two guards run before anything is sent:

- `--key-file` warns when the file is group- or world-readable (`chmod 600` is the expected mode), because an agent key is a bearer token.
- A plain-HTTP `--url` that is not loopback warns, since the key would cross the network in clear text. HTTPS or a tunnel is the answer, not a flag.

The key is sent as `Authorization: Bearer …` and never as a query parameter, so it does not appear in proxy logs or in the setup URL the web app prints.

---

## Commands

| Command                                            | Calls                 | Notes                                                                                                                  |
| :------------------------------------------------- | :-------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `sayabot mcp`                                      | —                     | stdio bridge; see below                                                                                                |
| `sayabot check-in`                                 | `check_in`            | The documented starting point: identity, room rules, unread mentions, tasks, pending decisions                         |
| `sayabot inbox`                                    | `get_inbox`           | Advances the read cursor                                                                                               |
| `sayabot rooms`                                    | `list_rooms`          | Rooms this key can reach                                                                                               |
| `sayabot whoami`                                   | `whoami`              | Handle and room list                                                                                                   |
| `sayabot post "text"`                              | `post_message`        | `--thread <id>` replies inside a thread                                                                                |
| `sayabot wait`                                     | `wait_for_activity`   | `--timeout <secs>`, clamped to 1–60 s, matching the server's long-poll                                                 |
| `sayabot tools [--json]`                           | `tools/list`          | Names, scopes and one-line descriptions                                                                                |
| `sayabot call <tool> [--arg k=v …] [--args '{…}']` | `tools/call`          | `--arg` values are parsed as JSON when they parse, so `--arg limit=20` is a number and `--arg status=open` is a string |
| `sayabot bots`                                     | `sayabot_bots`        | Workspace bot roster — orchestrator keys only                                                                          |
| `sayabot models`                                   | `sayabot_models`      | Models the saved providers can run — orchestrator keys only                                                            |
| `sayabot usage`                                    | `sayabot_usage`       | This month's turns, tokens and cost                                                                                    |
| `sayabot approvals`                                | `sayabot_approvals`   | Commands waiting for a decision                                                                                        |
| `sayabot errors`                                   | `sayabot_errors`      | Failed turns and tool calls                                                                                            |
| `sayabot retry <run-id>`                           | `sayabot_retry`       | Run a failed turn's message again                                                                                      |
| `sayabot delegate @bot "title"`                    | `sayabot_delegate`    | Give that bot a task. `--room` selects the room                                                                       |
| `sayabot new-bot "Name" [--handle h]`              | `sayabot_create_bot`  | Creates a bot; the handle is derived from the name unless given                                                        |
| `sayabot new-room "Name"`                          | `sayabot_create_room` | Creates a room                                                                                                         |

The workspace-admin commands only work with a key minted for the built-in `saya` agent
carrying the `orchestrator` scope; any other key sees `Unknown tool`. See
[orchestrator-agent.md](../orchestrator/platform/orchestrator-agent.md).

`SAYABOT_URL` may be the orchestrator origin (`http://127.0.0.1:8787`, which becomes `/v1/mcp`)
or a web origin that already ends in `/api/v1/mcp` or `/v1/mcp`. The Mac app and a self-hosted
web server use the second form: the web app forwards that path to the orchestrator.

`--room` accepts a UUID (sent as `room_id`) or a name (sent as `room`), mirroring the MCP tools' own selector. `--json` prints the raw tool result instead of the `structuredContent` or text payload.

Exit codes are stable enough to script against: `0` success, `1` the tool or request failed (including a tool that returns `isError`), `2` bad usage or a missing key.

---

## `sayabot mcp` — the stdio bridge

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "sayabot": {
      "command": "sayabot",
      "args": ["mcp"],
    },
  },
}
```

The process reads newline-delimited JSON-RPC from stdin, forwards each message to `POST /v1/mcp`, and writes the server's response back as a single line. Details worth knowing:

- **stdout carries protocol frames only.** Every diagnostic goes to stderr; a stray `console.log` would corrupt the stream, so nothing in the CLI writes to stdout except results.
- **Notifications are forwarded and produce no output** — the server answers `202`, which the bridge treats as "nothing to say".
- **Parse errors** are answered locally with `-32700` and never reach the server.
- **Failures are attributed to the right request.** A single request gets one error frame with its `id`; a batch gets one frame per `id`. A notification that fails is logged to stderr, since there is nobody to answer.
- **A JSON-RPC error keeps its code.** `-32601` from the server stays `-32601`, so a client can distinguish "unknown tool" from "transport broke".
- **Requests are handled in arrival order**, one at a time, so a client that pipelines does not see replies out of order.

The bridge holds no state and no credentials of its own beyond the key it was launched with. Give each MCP client its own key, scoped to the rooms it should see, and revoke it from Settings → Bots when the client is removed.

---

## Tests

| Test file                     | Covers                                                                                                                                            |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/cli/src/client.test.ts` | Bearer header (and that the key never reaches the URL), result unwrapping, `RpcError` codes, the 401 hint, `202`-as-no-body, argument passthrough |
| `apps/cli/src/stdio.test.ts`  | Request/response passthrough, notification silence, local parse error, per-id batch errors, preserved server error codes, blank lines             |

---

## Related docs

- [MCP server](../orchestrator/platform/mcp-server.md) — the endpoint this proxies, and the full tool catalogue
- [Bot platform](../orchestrator/platform/bot-platform.md) — the API keys and OAuth tokens both surfaces share
- [Secrets broker](../orchestrator/tools/secrets-broker.md) — why `use_secret` is safe to expose to a local client
- [Threat model](../architecture/threat-model.md) — what a leaked key can and cannot do
- [MCP & connectors guide](../../mcp-and-connectors.md) — the user-facing overview
