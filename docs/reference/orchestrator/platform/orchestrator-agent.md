# Workspace Orchestrator (`saya`)

Every workspace is created with one built-in agent, **Saya** (`@saya`). It is a normal `agents`
row — same turn loop, same `tool_calls` audit rows, same approval gates — plus the
`orchestrator` capability, which assembles the `sayabot_*` workspace-admin tools. People use it
to create bots and rooms, move bots between rooms, read usage, and inspect the workspace's
configuration, from chat, the CLI, or any MCP client.

Source files: `packages/core/src/saya.ts`, `apps/orchestrator/src/orchestrator-admin/service.ts`,
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
| `system_prompt` | `SAYA_SYSTEM_PROMPT` — orchestrator identity and operating rules |
| `capabilities`  | `DEFAULT_CAPABILITIES` + `orchestrator: true` + `secrets: true`  |
| `model`         | `null` — the workspace's default model applies                   |

`computer` stays `false`: `terminal_exec` and `code_sandbox` already run commands and edit files,
and a dedicated computer is a plan/per-bot decision the owner makes in Settings. `secrets: true`
gives Saya the `use_secret` broker so it can wire credentials **by reference** without ever
reading a value.

### Provisioning

`ensureSayaAgent()` (`apps/web/src/lib/saya.ts`) is idempotent on `(org_id, handle = "saya")`:

1. Look for the row; if it exists, reuse it.
2. Otherwise insert it with `SAYA_CAPABILITIES` and `SAYA_SYSTEM_PROMPT`.
3. When a `roomId` is given, upsert `room_agents` so Saya is in that room.

It is called from both workspace-creation paths — `setupWorkspaceAction` (onboarding wizard) and
`createOrg` (Settings → new workspace) — and a failure is logged rather than rolling back the
workspace, because the next call re-runs the same ensure.

Because the capability set is stored on the row, deleting the row or clearing the flag turns the
admin tools off; nothing else in the platform assumes Saya exists.

## 🛠️ The admin tools

`orchestratorTools()` returns eight specs. Only an agent whose parsed capabilities include
`orchestrator: true` gets them (`buildTools`, `apps/orchestrator/src/tools/index.ts`).

| Tool                      | Danger | What it does                                                                  |
| :------------------------ | :----: | :---------------------------------------------------------------------------- |
| `sayabot_bots`            |  safe  | Bot roster: handle, display name, model, enabled capabilities                 |
| `sayabot_create_bot`      |   ⚠️   | Create a bot with instructions, model and capability toggles                  |
| `sayabot_update_bot`      |   ⚠️   | Change name, instructions, model or capabilities; cannot grant `orchestrator` |
| `sayabot_rooms`           |  safe  | Rooms with kind, timezone, turn mode and bot count                            |
| `sayabot_create_room`     |   ⚠️   | Create a room, copying the current room's people and joining the caller       |
| `sayabot_add_bot_to_room` |   ⚠️   | Add a bot to a room                                                           |
| `sayabot_usage`           |  safe  | This month's turns, tokens, cost, and per-bot cost                            |
| `sayabot_config`          |  safe  | Plan, counts, provider labels (never keys), MCP status, computer availability |

Every mutation is `dangerous: true`, so the audited wrapper inserts a `pending_approval`
`tool_calls` row, broadcasts `tool.approval_requested`, pushes a notification, and waits for a
human — the same lifecycle every other destructive tool uses. A rejection returns
`{ ok: false, rejected: true }` and changes nothing.

### Invariants

- **Org-scoped.** `orchestrator-admin/service.ts` filters every query by the caller's `orgId`; an
  id from another workspace resolves to "not found".
- **No privilege escalation.** `createBot` and `updateBot` force `orchestrator: false` unless the
  target row already had it, so a prompt-injected Saya cannot mint a second admin or promote a bot.
- **No secrets.** The config snapshot reports provider `label`/`last4` and boolean computer
  availability. Ciphertext, KEK material and vault entries are never read.
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
sayabot new-bot "Scout" --handle scout
sayabot new-room "Planning"
sayabot usage
sayabot call sayabot_config
```

A key belonging to any other bot gets `Unknown tool: sayabot_bots` — the tools are absent from
`tools/list` for that identity, not merely denied.

## 🔄 What is deliberately not here

- **No generic config-file writer.** Hermes-style self-configuration is scoped to _workspace
  objects_ (bots, rooms, capabilities), not to `.env` files or the orchestrator's own process.
  Secrets stay in the encrypted vault and are referenced, never round-tripped through the model.
- **No bot deletion.** Destructive lifecycle changes stay in the web UI, where the owner sees the
  full consequences.
- **No cross-workspace or platform-admin tools.** A `saya` in one workspace cannot enumerate another.

Related docs: [../../orchestrator/platform/mcp-server.md](./mcp-server.md) ·
[../tools/tool-system.md](../tools/tool-system.md) ·
[../../cli/overview.md](../../cli/overview.md) ·
[../../core/capabilities-and-mentions.md](../../core/capabilities-and-mentions.md)
