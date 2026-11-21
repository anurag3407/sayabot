# Workspace Orchestrator (`saya`)

Every workspace is created with one built-in agent, **Saya** (`@saya`). It is a normal `agents`
row — same turn loop, same `tool_calls` audit rows, same approval gates — plus the
`orchestrator` capability, which assembles the `sayabot_*` workspace-admin tools. People use it
to create bots and rooms, move bots between rooms, read usage, and inspect the workspace's
configuration, from chat, the CLI, or any MCP client.

Source files: `packages/core/src/saya.ts`, `packages/core/src/saya-policy.ts`,
`packages/core/src/harness.ts`,
`apps/orchestrator/src/orchestrator-admin/service.ts`,
`apps/orchestrator/src/orchestrator-admin/control.ts`,
`apps/orchestrator/src/orchestrator-admin/extended.ts`,
`apps/orchestrator/src/tools/builtins/orchestrator.ts`, `apps/orchestrator/src/mcp/admin-tools.ts`,
`apps/web/src/lib/saya.ts`

---

## 🧬 What Saya is

| Field           | Value                                                            |
| :-------------- | :--------------------------------------------------------------- |
| `handle`        | `saya`                                                           |
| `display_name`  | `Saya`                                                           |
| `kind`          | `llm`                                                            |
| `visibility`    | `org`                                                            |
| `system_prompt` | `SAYA_PERSONA`: her persona (role, voice, habits). The tool manual is `ORCHESTRATOR_GUIDE` in the harness, added for any agent with `orchestrator` (see [harness-and-persona](../../core/harness-and-persona.md)) |
| `capabilities`  | `DEFAULT_CAPABILITIES` + `orchestrator: true` + `secrets: true`  |
| `model`         | `null` until an admin picks one. `sayabot_create_bot` refuses to create another bot without a model the admin chose. |
| `params.mascot` | `{ shape: "ghost", tone: "lilac" }` — the wordmark icon          |

`computer` stays `false`: `terminal_exec` and `code_sandbox` already run commands and edit files,
and a dedicated computer is a plan/per-bot decision the owner makes in Settings. `secrets: true`
gives Saya the `use_secret` broker so it can wire credentials **by reference** without ever
reading a value.

### Provisioning

`ensureSayaAgent()` (`apps/web/src/lib/saya.ts`) is idempotent on `(org_id, handle = "saya")`:

1. Look for the row; if it exists, reuse it.
2. Otherwise insert it with `SAYA_CAPABILITIES`, `SAYA_PERSONA`, and `params.mascot`
   set to the wordmark ghost (`SAYA_MASCOT`).
3. An existing row whose mascot is not that ghost is updated in place. Other `params` keys stay.
   A row whose stored persona is the legacy operating manual (starts with
   `SAYA_LEGACY_PROMPT_PREFIX`) gets `SAYA_PERSONA` instead; a hand-edited persona stays.
4. When a `roomId` is given, upsert `room_agents` so Saya is in that room.

It is called from both workspace-creation paths — `setupWorkspaceAction` (onboarding wizard) and
`createOrg` (Settings → new workspace) — and a failure is logged rather than rolling back the
workspace, because the next call re-runs the same ensure.

Because the capability set is stored on the row, deleting the row or clearing the flag turns the
admin tools off; nothing else in the platform assumes Saya exists.

## 🛠️ The admin tools

`orchestratorTools()` returns the control-plane specs. Only an agent whose parsed capabilities
include `orchestrator: true` gets them (`buildTools`, `apps/orchestrator/src/tools/index.ts`).

| Tool                           | Danger | What it does                                                                                         |
| :----------------------------- | :----: | :--------------------------------------------------------------------------------------------------- |
| `sayabot_bots`                 |  safe  | Bot roster: handle, display name, model, enabled capabilities                                        |
| `sayabot_create_bot`           |   ⚠️   | Create a bot only after the admin picks a model from `sayabot_models`. Handle `saya` is reserved.   |
| `sayabot_update_bot`           |   ⚠️   | Change name, instructions, model or capabilities. Cannot grant `orchestrator` or rewrite Saya       |
| `sayabot_models`               |  safe  | Up to 25 models per saved provider, plus the model each bot already uses. No keys                   |
| `sayabot_rooms`                |  safe  | Rooms with kind, timezone, turn mode and bot count                                                   |
| `sayabot_create_room`          |   ⚠️   | Create a room, copying the current room's people and joining the caller                             |
| `sayabot_add_bot_to_room`      |   ⚠️   | Add a bot to a room                                                                                  |
| `sayabot_remove_bot_from_room` |   ⚠️   | Remove a bot from a room. The bot row stays                                                          |
| `sayabot_configure`            |   ⚠️   | Room name, timezone, directive, turn mode, `review_all`/`ask_risky`, or a bot's model and prompt    |
| `sayabot_delegate`             |   ⚠️   | Create a task for another bot, join them to the room if needed, and wake them                       |
| `sayabot_routines`             |   list | List schedules. `create`, `pause`, `resume`, and `remove` are ⚠️                                    |
| `sayabot_approvals`            |  safe  | Pending commands. Args are redacted. `self` marks Saya's own calls                                   |
| `sayabot_decide`               |  ⚠️/ok | `approve` is ⚠️, `reject` is safe. Refuses her own call, `use_secret`, and `sayabot_decide`         |
| `sayabot_errors`               |  safe  | Recent failed turns and failed tool calls, redacted                                                  |
| `sayabot_retry`                |   ⚠️   | Enqueue the failed turn's message again. Does not take the room lock                                |
| `sayabot_usage`                |  safe  | Turns, tokens, cost and per-bot cost for this month, or a rolling `days` window (1-90)               |
| `sayabot_config`               |  safe  | Plan, counts, provider labels, connectors, MCP status, desktops, computer availability. No ciphertext |
| `sayabot_capabilities`         |  safe  | Every capability flag and every `sayabot_tune_bot` setting, with what each unlocks                   |
| `sayabot_bot`                  |  safe  | One bot in full: persona, bio, model, effort, reply style, works_on, look, capabilities, rooms, connector grants, secret grants (names only), routines |
| `sayabot_tune_bot`             |   ⚠️   | Any bot setting in one call: persona, bio, name, model, effort, reply style, works_on, max output tokens, computer (off/standard/browser), mascot shape/tone, capability toggles. Saya's persona and look stay fixed |
| `sayabot_delete_bot`           |   ⚠️   | Delete a bot. Refuses Saya (or any orchestrator) and the caller itself                               |
| `sayabot_room`                 |  safe  | One room in full: settings, directive, people, bots and the model each uses there, open tasks, latest messages (redacted) |
| `sayabot_post`                 |  safe  | Post as the orchestrator in another room (joins it if needed); `@mentions` there wake those bots      |
| `sayabot_delete_room`          |   ⚠️   | Delete a group room. Direct chats are refused                                                         |
| `sayabot_room_model`           |   ⚠️   | Model override for one bot in one room (`room_agents.model_override`); `null` returns to the default  |
| `sayabot_members`              |  safe  | People in the workspace and their role                                                                |
| `sayabot_tasks`                |  safe  | Tasks across every room, unfinished by default, filterable by status or bot                           |
| `sayabot_connectors`           |  list  | List connectors and who may use them. `grant` / `revoke` (⚠️) change one bot's `agent_connector_grants` row (`read_only` defaults true) |
| `sayabot_secrets`              |  list  | Secret labels and `last4` with their grants. `revoke` (⚠️) sets `revoked_at` on one grant. Values are never read |
| `sayabot_mcp`                  |  list  | MCP servers with sign-in status and cached tool names. `enable` / `disable` (⚠️)                    |
| `sayabot_memory`               |  list  | List or search shared memories, `remember` one (workspace, room or bot scope, redacted), `forget` one (⚠️) |

A mutation is `dangerous: true`, or dangerous only for the write (`sayabot_decide` when the
decision is `approve`, `sayabot_routines` for anything other than `list`). The audited wrapper
inserts a `pending_approval`
`tool_calls` row, broadcasts `tool.approval_requested`, pushes a notification, and waits for a
human — the same lifecycle every other destructive tool uses. A room set to `turbo` skips that
gate and runs the call immediately. Over MCP the `orchestrator` scope
is that grant, so the call runs without a second prompt. A rejection returns
`{ ok: false, rejected: true }` and changes nothing.

### Invariants

- **Org-scoped.** `orchestrator-admin/service.ts` filters every query by the caller's `orgId`; an
  id from another workspace resolves to "not found".
- **No privilege escalation.** `createBot` and `updateBot` force `orchestrator: false` unless the
  target row already had it. The handle `saya` cannot be created here, and Saya's system prompt
  cannot be replaced.
- **No self-approval.** `reviewApproval` (`packages/core/src/saya-policy.ts`) rejects a decision
  whose subject agent is the caller, a command with no agent, `use_secret`, and `sayabot_decide`.
  In a room, `approve` is `dangerous`, so the owner still confirms it. An MCP client with the
  `orchestrator` scope is that owner: the call applies immediately, and the audit row records it.
- **No auto or turbo.** `roomConfigPatch` accepts `review_all` and `ask_risky` only. Those two
  looser modes stay with the person at the computer.
- **No secrets.** Config reports provider `label`/`last4` (the base URL is passed through
  `redactSecrets`), connector name/source/status/`last4`, and desktop name/platform/last seen.
  Ciphertext, KEK material and vault entries are never read. Approval args and errors are scrubbed
  before they leave. Model ids that look like keys or credential URLs are rejected.
- **Audited as the agent.** Writes add an `audit_logs` row with `actor_type: "agent"` and Saya's
  `agent_id`.

## 🔌 MCP and CLI surfaces

`apps/orchestrator/src/mcp/admin-tools.ts` projects the same specs onto the MCP tool table, so
there is one implementation of each operation. They are exposed only when the authenticated
agent's capabilities include `orchestrator`, and each tool additionally requires the
`orchestrator` token scope — an owner must mint an admin key deliberately, because MCP has no
inline approval prompt.

```bash
# a key minted for @saya with the `orchestrator` scope
sayabot bots
sayabot models
sayabot new-bot "Scout" --handle scout
sayabot new-room "Planning"
sayabot delegate @scout "Check the deploy" --room Planning
sayabot approvals
sayabot errors
sayabot usage
sayabot call sayabot_config
```

The Mac app's **Copy MCP Config…** menu writes a snippet for the server that app is connected to
(local or self-hosted). The key in that snippet is the placeholder `PASTE_SAYA_KEY_HERE`. See
[local-mcp-and-models.md](../../desktop/local-mcp-and-models.md).

A key belonging to any other bot gets `Unknown tool: sayabot_bots` — the tools are absent from
`tools/list` for that identity, not merely denied.

## 🔄 What is deliberately not here

- **No process or secret-file writer.** Configuration changes workspace objects (bots, rooms,
  routines, models, grants, memory), not `.env` files and not the orchestrator's own process.
- **No secret values.** Saya lists secret labels and revokes grants, but adding a secret or a new
  grant happens in Settings → Secrets, so a value never passes through the model. New connectors
  and MCP apps likewise need a browser sign-in in Settings.
- **No workspace deletion, and no deleting Saya.** Bot and room deletion exist (`sayabot_delete_bot`,
  `sayabot_delete_room`) and wait on the approval gate. Direct chats and the orchestrator are refused.
- **No cross-workspace or platform-admin tools.** A `saya` in one workspace cannot enumerate another.

Related docs: [../../orchestrator/platform/mcp-server.md](./mcp-server.md) ·
[../tools/tool-system.md](../tools/tool-system.md) ·
[../../cli/overview.md](../../cli/overview.md) ·
[../../core/capabilities-and-mentions.md](../../core/capabilities-and-mentions.md)
