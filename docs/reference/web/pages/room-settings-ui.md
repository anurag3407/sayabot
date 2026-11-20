# Room settings UI

A room is created with just a name (`RoomForm`). Everything else is set later on the room settings page: name and visibility, which agents are in the room and where each one runs, who leads, reply limits, tools, meetings and people. The page is for room admins and workspace admins. Parts that create workspace-wide things (new agents, app connections) appear only for workspace admins.

Source files: `apps/web/src/app/(workspace)/[org]/r/[roomId]/settings/page.tsx`, `apps/web/src/components/room-form.tsx`, `apps/web/src/components/rooms/room-add-agent.tsx`, `apps/web/src/components/rooms/room-tools.tsx`, `apps/web/src/components/room/model-picker/room-model-picker.tsx`, `apps/web/src/lib/actions/rooms.ts`, `apps/web/src/lib/actions/mcp.ts`

---

## Creating a room (`RoomForm`)

`RoomForm` (`components/room-form.tsx`) shows one field, **name** (1–60 characters). Visibility (private by default, public, or a direct chat) and an optional first person are under a collapsed **More options** `<details>` (`room-form.tsx:39`). A direct chat still requires a person. The help text says agents, people, tools and the lead are set up later in room settings. The form posts to `createRoom` (see [actions-rooms-messages](../actions/actions-rooms-messages.md)), which redirects into the new room. An empty room shows the admin `SetupChecklist` ([room-chat-ui](./room-chat-ui.md)).

## Page access and data

`requireRoomAccess` gates the page. A viewer without `canAdmin` is redirected to the room. `orgAdmin = isOrgAdmin(access.orgRole)` decides whether workspace-level controls render. The page loads, in parallel: room agents, org agents, the room schedule, org members, room members, `listMcpServers(orgId)`, and (workspace admins only) `agent_templates` that are global or belong to the org. For invited (`kind: "external"`) agents it also reads `agents.last_seen_at` with the admin client.

## Sections, in order

### Room

An `ActionForm` over `updateRoomBasics` with **name** and, for group rooms, **who can see it** (`private` / `public`). Direct chats show the name only.

### Agents in this room (`#room-agents`)

- One row per agent: position, `@handle`, display name, a **Lead** badge when it is `rooms.moderator_agent_id`, and where it runs:
  - agents made in Sayabot show `agentModelText(agent, saya)`;
  - invited apps show **Your app · open now** when `last_seen_at` is within 15 minutes (the same window as the orchestrator's `APP_ONLINE_WINDOW_MS`), else **not open (seen …)** or **not connected yet**.
- Each row has a confirm-gated **Remove** (`removeAgentFromRoom`).
- When the room has a Sayabot-made agent and the viewer is a workspace admin, the section header shows the room's `RoomModelPicker` (`placement="down"`). It is the same picker as the chat composer: per agent, this room only or the agent's default, across API keys, apps signed in on a Mac, and the server.
- **`RoomAddAgent`** (`components/rooms/room-add-agent.tsx`) has three tabs:
  - **Ready-made** (workspace admins, when templates exist): a **Runs on** chip, then one card per template. The chip (`RunsOnPicker`) opens `ModelPickerPanel` over `GET /api/connectors/models?org=<slug>`, loaded when first opened, with the same accounts as the model picker: server models, apps on your Mac or the server, API keys. Leaving it on "Workspace default" keeps the server's default. **Add to room** calls `createBotAction({ orgSlug, name, templateId, roomId, keyId, model, effort })`, which makes the agent from the template on that choice and appends it to `room_agents` in one step, then refreshes. It links to `/agents/new?room=<id>` for a custom agent.
  - **From this workspace**: a select of org agents not yet in the room, then `addAgentToRoom`.
  - **Connect your app**: opens `InviteBotDialog` for this room (Claude Code, Cursor, Codex, Hermes…), the same invitation flow as the room header.

### How agents reply

An `ActionForm` over `updateRoomSettings`. The lead may hand one message to up to three agents in order. Fields: **agents reply** (`TURN_MODE_LABELS`: _Reply when @mentioned_, _Debate_, _Lead agent: one agent sends each message to the right agent_), **lead agent** (only `kind: "llm"` room agents are listed), replies per message (1–10), runs per minute, daily budget, room instructions, and debate order. The help text explains lead routing: messages without an @mention go to the lead, which hands each one to the best-fitting agent and says so in the room. An @mention always goes straight to that agent. Invited apps can be handed work but cannot lead. Orchestrator behavior: [coordinator](../../orchestrator/engine/coordinator.md).

### Tools in this room (`RoomTools`)

Lists `mcp_servers` whose `room_id` is null (**All rooms**) or this room (**Only this room**). Servers limited to other rooms are hidden. Workspace admins can:

- toggle scope with `setMcpServerRoomAction({ orgSlug, serverId, roomId })` (**Only this room** / **Use in all rooms**);
- **Remove** a room-only app (`disconnectMarketplaceServerAction`);
- **Browse apps** (the Marketplace, which connects apps for every room);
- **Add by link, just for this room**: `addMcpServer` with hidden `roomId`, `transport=http` and `dangerousTools=@writes`, so every tool that isn't a read asks a person first.

Other viewers see "A workspace admin can connect apps for this room."

### Meetings & check-ins, People in this room, Delete this room

These are unchanged: `RoomScheduleForm` (group rooms only), the member list with add/remove, and `DeleteRoomButton`.

## On the phone

The mobile chat header has a **Room settings** button, and an empty room shows one too. It opens this page signed in, inside `WebPageScreen` (`navigation.navigate("WebPage", { path: "/<org>/r/<roomId>/settings" })`), so the phone gets every section above. When the chat regains focus, `useRoomAgents` reloads the agent list. See [mobile home-and-chat](../../mobile/home-and-chat.md).

## Related docs

- [actions-rooms-messages](../actions/actions-rooms-messages.md): `createRoom`, `updateRoomBasics`, `updateRoomSettings`, agent and member actions
- [actions-connectors-keys](../actions/actions-connectors-keys.md): `addMcpServer`, `setMcpServerRoomAction`
- [actions-agents-bots](../actions/actions-agents-bots.md): `createBotAction`, room model picker actions
- [coordinator](../../orchestrator/engine/coordinator.md): lead agent routing, handoff notes, the "app isn't open" notice
- [room-chat-ui](./room-chat-ui.md): the room page, setup checklist and composer model picker
