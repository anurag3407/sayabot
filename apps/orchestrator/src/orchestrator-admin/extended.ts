import {
  SAYA_SHAPES,
  SAYA_TONES,
  WORKS_ON,
  assignableModelId,
  isSayaHandle,
  parseCapabilities,
  redactSecrets,
  type AgentCapabilities,
} from "@sayabot/core"
import {
  agentConnectorGrants,
  agentSecretGrants,
  agents,
  mcpServers,
  memories,
  messages,
  orgMembers,
  profiles,
  roomAgents,
  roomMembers,
  rooms,
  routines,
  tasks,
  vaultSecrets,
  workspaceConnectors,
} from "@sayabot/db"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { postAgentMessage } from "../collab"
import { getDb } from "../db"
import { OrchestratorAdminError, recordAudit, type OrchestratorActor } from "./service"

/**
 * The rest of the workspace control plane behind Saya's `sayabot_*` tools: full bot config
 * (persona, effort, reply style, computer, look), deletion, room details and posting, people,
 * tasks, connectors, secrets by name, MCP servers, and shared memory.
 *
 * Same contract as `service.ts`: every query is filtered by the caller's org, nothing returns a
 * secret value or ciphertext, and Saya can never escalate a bot to orchestrator or remove herself.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function scrub(value: string | null | undefined, max = 600): string | null {
  if (!value) return null
  return redactSecrets(value).text.slice(0, max)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

export interface BotRef {
  agentId?: string
  handle?: string
}

async function findBot(actor: OrchestratorActor, ref: BotRef) {
  const handle = ref.handle?.trim().replace(/^@+/, "").toLowerCase()
  if (!ref.agentId && !handle) throw new OrchestratorAdminError("Pass the bot's handle or agent_id")
  if (ref.agentId && !UUID.test(ref.agentId)) {
    throw new OrchestratorAdminError("agent_id must be a uuid")
  }
  const [bot] = await getDb()
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.orgId, actor.orgId),
        ref.agentId ? eq(agents.id, ref.agentId) : eq(agents.handle, handle ?? ""),
      ),
    )
    .limit(1)
  if (!bot) throw new OrchestratorAdminError("Bot not found in this workspace")
  return bot
}

async function findRoom(actor: OrchestratorActor, input: { roomId?: string; room?: string }) {
  if (input.roomId) {
    if (!UUID.test(input.roomId)) throw new OrchestratorAdminError("room_id must be a uuid")
    const [room] = await getDb()
      .select()
      .from(rooms)
      .where(and(eq(rooms.orgId, actor.orgId), eq(rooms.id, input.roomId)))
      .limit(1)
    if (!room) throw new OrchestratorAdminError("Room not found in this workspace")
    return room
  }
  const name = input.room?.trim().replace(/^#/, "")
  if (!name) throw new OrchestratorAdminError("Pass a room_id or a room name")
  const matches = await getDb()
    .select()
    .from(rooms)
    .where(and(eq(rooms.orgId, actor.orgId), eq(rooms.name, name)))
    .limit(2)
  if (!matches[0]) throw new OrchestratorAdminError("Room not found in this workspace")
  if (matches[1]) throw new OrchestratorAdminError("More than one room has that name. Pass room_id.")
  return matches[0]
}

// ─── Capabilities catalog ────────────────────────────────────────────────────

/** What each capability flag and tunable unlocks, so Saya can explain and change them. */
export const CAPABILITY_CATALOG: Record<keyof AgentCapabilities, string> = {
  canvas: "Shared canvases: canvas_create / canvas_write / canvas_read for documents and code.",
  tasks: "Task board: create, claim, update and finish tasks in rooms.",
  sandbox: "terminal_exec and code_sandbox: run shell commands and code in a sandbox.",
  webSearch: "web_search and web_fetch: search the web and read pages.",
  document: "Document tools: read and produce PDFs, DOCX and spreadsheets.",
  github: "GitHub tools: repos, issues, pull requests (with a granted token).",
  postgres: "Postgres queries against a configured database (writes need approval).",
  mcp: "Use the workspace's MCP servers (apps from the marketplace).",
  computer: "A persistent computer of its own (profile standard or browser). Set with computer.",
  secrets: "use_secret: call APIs with a granted secret injected server-side, never seen.",
  memory: "Long-term memory: remember, recall and forget facts across runs.",
  subagents: "Spawn helper agents (researcher, planner, worker, critic) for parallel work.",
  cron: "cronjob: schedule its own routines.",
  connectors: "Workspace connectors it has been granted (Drive, Slack, Notion, …).",
  storage: "Cloud storage: read and write files in the workspace storage provider.",
  voice: "Voice notes and speech.",
  orchestrator: "Workspace control plane. Only Saya has it; it can never be granted.",
}

export const TUNABLES = {
  persona: "The bot's persona (stored as its system prompt): who it is, voice, role and focus.",
  bio: "One-line description shown on its profile and to other bots.",
  model: "Model id from sayabot_models.",
  effort: "Reasoning effort for models that support it: low, medium, high (or the runner's own).",
  reply_style: "default (thorough) or conversational (short, chatty replies).",
  works_on: `Where its computer work runs: ${WORKS_ON.join(", ")}.`,
  max_output_tokens: "Cap on tokens per reply (256 to 64000).",
  computer: "off, standard or browser: a persistent computer of its own.",
  mascot: `Look: shape (${SAYA_SHAPES.join(", ")}) and tone (${Object.keys(SAYA_TONES).join(", ")}).`,
} as const

export function capabilityCatalog() {
  return {
    capabilities: Object.entries(CAPABILITY_CATALOG).map(([name, description]) => ({
      name,
      description,
    })),
    tunables: Object.entries(TUNABLES).map(([name, description]) => ({ name, description })),
    note: "Toggle capabilities with sayabot_update_bot or sayabot_tune_bot. Tunables go through sayabot_tune_bot.",
  }
}

// ─── One bot, in full ────────────────────────────────────────────────────────

export async function botDetails(actor: OrchestratorActor, ref: BotRef) {
  const bot = await findBot(actor, ref)
  const db = getDb()
  const [roomRows, connectorRows, secretRows, routineRows] = await Promise.all([
    db
      .select({ id: rooms.id, name: rooms.name, kind: rooms.kind })
      .from(roomAgents)
      .innerJoin(rooms, eq(rooms.id, roomAgents.roomId))
      .where(and(eq(roomAgents.agentId, bot.id), eq(rooms.orgId, actor.orgId))),
    db
      .select({
        grantId: agentConnectorGrants.id,
        connectorId: workspaceConnectors.id,
        name: workspaceConnectors.name,
        source: workspaceConnectors.source,
        scope: agentConnectorGrants.scopeConfig,
      })
      .from(agentConnectorGrants)
      .innerJoin(workspaceConnectors, eq(workspaceConnectors.id, agentConnectorGrants.connectorId))
      .where(and(eq(agentConnectorGrants.agentId, bot.id), eq(agentConnectorGrants.orgId, actor.orgId))),
    db
      .select({
        grantId: agentSecretGrants.id,
        envName: agentSecretGrants.envName,
        label: vaultSecrets.label,
        allowedHosts: agentSecretGrants.allowedHosts,
        requiresApproval: agentSecretGrants.requiresApproval,
      })
      .from(agentSecretGrants)
      .innerJoin(vaultSecrets, eq(vaultSecrets.id, agentSecretGrants.secretId))
      .where(
        and(
          eq(agentSecretGrants.agentId, bot.id),
          eq(agentSecretGrants.orgId, actor.orgId),
          isNull(agentSecretGrants.revokedAt),
        ),
      ),
    db
      .select({ id: routines.id, name: routines.name, enabled: routines.enabled })
      .from(routines)
      .where(and(eq(routines.orgId, actor.orgId), eq(routines.agentId, bot.id))),
  ])
  const caps = parseCapabilities(bot.capabilities)
  const params = record(bot.params)
  return {
    id: bot.id,
    handle: bot.handle,
    displayName: bot.displayName,
    kind: bot.kind,
    orchestrator: caps.orchestrator === true,
    model: bot.model,
    bio: bot.bio,
    persona: scrub(bot.systemPrompt, 20_000),
    settings: {
      effort: params.effort ?? null,
      replyStyle: params.replyStyle ?? "default",
      worksOn: params.worksOn ?? "auto",
      maxOutputTokens: params.maxOutputTokens ?? null,
      mascot: params.mascot ?? null,
    },
    capabilities: caps,
    rooms: roomRows,
    connectors: connectorRows,
    secrets: secretRows,
    routines: routineRows,
    lastSeenAt: bot.lastSeenAt?.toISOString() ?? null,
  }
}

// ─── Tune a bot ──────────────────────────────────────────────────────────────

export interface TuneBotInput extends BotRef {
  persona?: string
  bio?: string | null
  displayName?: string
  model?: string | null
  effort?: string | null
  replyStyle?: "default" | "conversational"
  worksOn?: string
  maxOutputTokens?: number | null
  computer?: "off" | "standard" | "browser"
  mascotShape?: string
  mascotTone?: string
  capabilities?: Record<string, boolean>
}

export async function tuneBot(actor: OrchestratorActor, input: TuneBotInput) {
  const bot = await findBot(actor, input)
  const saya = isSayaHandle(bot.handle)
  const caps = parseCapabilities(bot.capabilities)
  const params = record(bot.params)
  const patch: Partial<typeof agents.$inferInsert> = { updatedAt: new Date() }
  const changed: string[] = []

  if (input.persona !== undefined) {
    if (saya) {
      throw new OrchestratorAdminError(
        "Saya's persona stays fixed. Change another bot's persona, or a room directive.",
      )
    }
    patch.systemPrompt = input.persona.slice(0, 20_000)
    changed.push("persona")
  }
  if (input.bio !== undefined) {
    patch.bio = input.bio === null ? null : input.bio.trim().slice(0, 280)
    changed.push("bio")
  }
  if (input.displayName !== undefined) {
    const name = input.displayName.trim()
    if (!name || name.length > 60) throw new OrchestratorAdminError("display_name must be 1 to 60 characters")
    patch.displayName = name
    changed.push("displayName")
  }
  if (input.model !== undefined) {
    if (input.model !== null && !assignableModelId(input.model)) {
      throw new OrchestratorAdminError("model must be a model id, not a key or a URL")
    }
    patch.model = input.model
    changed.push("model")
  }
  if (input.effort !== undefined) {
    if (input.effort === null || input.effort === "") delete params.effort
    else if (/^[a-z_-]{2,16}$/i.test(input.effort)) params.effort = input.effort.toLowerCase()
    else throw new OrchestratorAdminError("effort must be a short word such as low, medium or high")
    changed.push("effort")
  }
  if (input.replyStyle !== undefined) {
    params.replyStyle = input.replyStyle
    changed.push("replyStyle")
  }
  if (input.worksOn !== undefined) {
    if (!(WORKS_ON as readonly string[]).includes(input.worksOn)) {
      throw new OrchestratorAdminError(`works_on must be one of ${WORKS_ON.join(", ")}`)
    }
    params.worksOn = input.worksOn
    changed.push("worksOn")
  }
  if (input.maxOutputTokens !== undefined) {
    if (input.maxOutputTokens === null) delete params.maxOutputTokens
    else params.maxOutputTokens = Math.max(256, Math.min(64_000, Math.round(input.maxOutputTokens)))
    changed.push("maxOutputTokens")
  }
  if (input.mascotShape !== undefined || input.mascotTone !== undefined) {
    if (saya) throw new OrchestratorAdminError("Saya keeps the wordmark look.")
    const mascot = record(params.mascot)
    if (input.mascotShape !== undefined) {
      if (!(SAYA_SHAPES as readonly string[]).includes(input.mascotShape)) {
        throw new OrchestratorAdminError(`mascot shape must be one of ${SAYA_SHAPES.join(", ")}`)
      }
      mascot.shape = input.mascotShape
    }
    if (input.mascotTone !== undefined) {
      if (!Object.keys(SAYA_TONES).includes(input.mascotTone)) {
        throw new OrchestratorAdminError(`mascot tone must be one of ${Object.keys(SAYA_TONES).join(", ")}`)
      }
      mascot.tone = input.mascotTone
    }
    params.mascot = mascot
    changed.push("mascot")
  }

  let nextCaps: AgentCapabilities = caps
  if (input.capabilities !== undefined || input.computer !== undefined) {
    const { computer: _ignored, ...toggles } = input.capabilities ?? {}
    nextCaps = parseCapabilities({
      ...caps,
      ...toggles,
      computer:
        input.computer === undefined
          ? caps.computer
          : input.computer === "off"
            ? false
            : { profile: input.computer },
      // Never transferable: only the built-in Saya keeps it.
      orchestrator: caps.orchestrator === true,
    })
    patch.capabilities = nextCaps
    changed.push(input.computer !== undefined ? "computer" : "capabilities")
  }

  if (!changed.length) throw new OrchestratorAdminError("Nothing to change. Pass at least one setting.")
  patch.params = params

  await getDb().update(agents).set(patch).where(eq(agents.id, bot.id))
  await recordAudit(actor, "agent.tuned_by_orchestrator", bot.handle, { changed })
  return { ok: true, handle: bot.handle, changed, details: await botDetails(actor, { agentId: bot.id }) }
}

export async function deleteBot(actor: OrchestratorActor, ref: BotRef) {
  const bot = await findBot(actor, ref)
  if (isSayaHandle(bot.handle) || parseCapabilities(bot.capabilities).orchestrator) {
    throw new OrchestratorAdminError("Saya is the workspace orchestrator and cannot be deleted.")
  }
  if (actor.agentId && bot.id === actor.agentId) {
    throw new OrchestratorAdminError("A bot cannot delete itself.")
  }
  await getDb().delete(agents).where(and(eq(agents.id, bot.id), eq(agents.orgId, actor.orgId)))
  await recordAudit(actor, "agent.deleted_by_orchestrator", bot.handle, {
    displayName: bot.displayName,
  })
  return { ok: true, deleted: bot.handle }
}

// ─── Rooms ───────────────────────────────────────────────────────────────────

export async function roomDetails(
  actor: OrchestratorActor,
  input: { roomId?: string; room?: string; messages?: number },
) {
  const room = await findRoom(actor, input)
  const db = getDb()
  const limit = Math.max(0, Math.min(50, input.messages ?? 15))
  const [people, bots, recent, openTasks] = await Promise.all([
    db
      .select({ userId: roomMembers.userId, role: roomMembers.role, name: profiles.displayName })
      .from(roomMembers)
      .leftJoin(profiles, eq(profiles.id, roomMembers.userId))
      .where(eq(roomMembers.roomId, room.id)),
    db
      .select({
        id: agents.id,
        handle: agents.handle,
        displayName: agents.displayName,
        model: agents.model,
        override: roomAgents.modelOverride,
      })
      .from(roomAgents)
      .innerJoin(agents, eq(agents.id, roomAgents.agentId))
      .where(eq(roomAgents.roomId, room.id)),
    limit
      ? db
          .select({
            id: messages.id,
            senderType: messages.senderType,
            senderId: messages.senderId,
            content: messages.content,
            status: messages.status,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(eq(messages.roomId, room.id))
          .orderBy(desc(messages.createdAt))
          .limit(limit)
      : Promise.resolve([]),
    db
      .select({ id: tasks.id, number: tasks.number, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.roomId, room.id), inArray(tasks.status, ["open", "in_progress", "stuck"])))
      .orderBy(desc(tasks.statusChangedAt))
      .limit(20),
  ])
  const names = new Map<string, string>()
  for (const person of people) names.set(person.userId, person.name ?? "Someone")
  for (const bot of bots) names.set(bot.id, `@${bot.handle}`)
  return {
    id: room.id,
    name: room.name,
    kind: room.kind,
    timezone: room.timezone,
    turnMode: room.turnMode,
    directive: scrub(room.systemDirective, 4_000),
    people: people.map((person) => ({ name: person.name ?? "Someone", role: person.role })),
    bots: bots.map((bot) => ({
      id: bot.id,
      handle: bot.handle,
      displayName: bot.displayName,
      model: bot.override?.model ?? bot.model,
      modelIsOverride: Boolean(bot.override?.model),
    })),
    openTasks: openTasks.map((task) => ({ ref: `MESH-${task.number}`, ...task })),
    recentMessages: recent.reverse().map((message) => ({
      id: message.id,
      from:
        message.senderType === "system"
          ? "system"
          : (names.get(message.senderId ?? "") ?? message.senderType),
      status: message.status,
      at: message.createdAt.toISOString(),
      content: scrub(message.content, 800),
    })),
  }
}

export async function deleteRoom(actor: OrchestratorActor, input: { roomId?: string; room?: string }) {
  const room = await findRoom(actor, input)
  if (room.kind === "dm") {
    throw new OrchestratorAdminError("Direct chats are deleted by the person in them, not by Saya.")
  }
  await getDb().delete(rooms).where(and(eq(rooms.id, room.id), eq(rooms.orgId, actor.orgId)))
  await recordAudit(actor, "room.deleted_by_orchestrator", room.id, { name: room.name })
  return { ok: true, deleted: room.name }
}

/** Post into any room as Saya. Joins the room first when needed; @mentions wake those bots. */
export async function postToRoom(
  actor: OrchestratorActor,
  input: { roomId?: string; room?: string; content: string },
) {
  if (!actor.agentId) throw new OrchestratorAdminError("Only an agent can post")
  const room = await findRoom(actor, input)
  const [me] = await getDb()
    .select({ handle: agents.handle })
    .from(agents)
    .where(and(eq(agents.id, actor.agentId), eq(agents.orgId, actor.orgId)))
    .limit(1)
  if (!me) throw new OrchestratorAdminError("The posting bot is not in this workspace")
  const inserted = await getDb()
    .insert(roomAgents)
    .values({ roomId: room.id, agentId: actor.agentId, position: 0 })
    .onConflictDoNothing()
    .returning({ roomId: roomAgents.roomId })
  const result = await postAgentMessage(
    { agentId: actor.agentId, orgId: actor.orgId, handle: me.handle, roomIds: null },
    { roomId: room.id, content: input.content, metadata: { source: "orchestrator" } },
  )
  return { ok: true, room: room.name, joined: inserted.length > 0, ...record(result) }
}

/** Pin a model for one bot in one room only ("only this chat"); null goes back to its default. */
export async function setRoomModel(
  actor: OrchestratorActor,
  input: BotRef & { roomId?: string; room?: string; model: string | null; effort?: string | null },
) {
  const room = await findRoom(actor, input)
  const bot = await findBot(actor, input)
  if (input.model !== null && !assignableModelId(input.model)) {
    throw new OrchestratorAdminError("model must be a model id, not a key or a URL")
  }
  const override =
    input.model === null
      ? null
      : {
          keyId: null,
          model: input.model,
          effort: input.effort ?? null,
          providerKeyId: null,
          agentModel: bot.model,
          runner: null,
        }
  const updated = await getDb()
    .update(roomAgents)
    .set({ modelOverride: override })
    .where(and(eq(roomAgents.roomId, room.id), eq(roomAgents.agentId, bot.id)))
    .returning({ roomId: roomAgents.roomId })
  if (!updated.length) {
    throw new OrchestratorAdminError(`@${bot.handle} is not in #${room.name}. Add it first.`)
  }
  await recordAudit(actor, "room.model_set_by_orchestrator", room.id, {
    handle: bot.handle,
    model: input.model,
  })
  return { ok: true, room: room.name, handle: bot.handle, model: input.model ?? bot.model }
}

// ─── People and tasks ────────────────────────────────────────────────────────

export async function listMembers(actor: OrchestratorActor) {
  const rows = await getDb()
    .select({ userId: orgMembers.userId, role: orgMembers.role, name: profiles.displayName, joinedAt: orgMembers.createdAt })
    .from(orgMembers)
    .leftJoin(profiles, eq(profiles.id, orgMembers.userId))
    .where(eq(orgMembers.orgId, actor.orgId))
  return {
    members: rows.map((row) => ({
      userId: row.userId,
      name: row.name || "Someone",
      role: row.role,
      joinedAt: row.joinedAt.toISOString(),
    })),
  }
}

export async function listWorkspaceTasks(
  actor: OrchestratorActor,
  input: { status?: "open" | "in_progress" | "stuck" | "done"; handle?: string; limit?: number },
) {
  const filters = [eq(tasks.orgId, actor.orgId)]
  if (input.status) filters.push(eq(tasks.status, input.status))
  else filters.push(inArray(tasks.status, ["open", "in_progress", "stuck"]))
  if (input.handle) {
    const bot = await findBot(actor, { handle: input.handle })
    filters.push(eq(tasks.assigneeAgentId, bot.id))
  }
  const rows = await getDb()
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      roomId: tasks.roomId,
      room: rooms.name,
      assignee: agents.handle,
      updatedAt: tasks.statusChangedAt,
    })
    .from(tasks)
    .leftJoin(rooms, eq(rooms.id, tasks.roomId))
    .leftJoin(agents, eq(agents.id, tasks.assigneeAgentId))
    .where(and(...filters))
    .orderBy(desc(tasks.statusChangedAt))
    .limit(Math.max(1, Math.min(100, input.limit ?? 40)))
  return {
    tasks: rows.map((row) => ({
      ref: `MESH-${row.number}`,
      id: row.id,
      title: row.title,
      status: row.status,
      room: row.room,
      roomId: row.roomId,
      assignee: row.assignee ? `@${row.assignee}` : null,
      updatedAt: row.updatedAt.toISOString(),
    })),
  }
}

// ─── Connectors, secrets, MCP ────────────────────────────────────────────────

export async function manageConnectors(
  actor: OrchestratorActor,
  input: BotRef & { action: "list" | "grant" | "revoke"; connectorId?: string; readOnly?: boolean },
) {
  if (input.action === "list") {
    const rows = await getDb()
      .select({
        id: workspaceConnectors.id,
        name: workspaceConnectors.name,
        source: workspaceConnectors.source,
        status: workspaceConnectors.status,
        error: workspaceConnectors.errorMessage,
      })
      .from(workspaceConnectors)
      .where(eq(workspaceConnectors.orgId, actor.orgId))
    const grants = await getDb()
      .select({ connectorId: agentConnectorGrants.connectorId, handle: agents.handle })
      .from(agentConnectorGrants)
      .innerJoin(agents, eq(agents.id, agentConnectorGrants.agentId))
      .where(eq(agentConnectorGrants.orgId, actor.orgId))
    return {
      connectors: rows.map((row) => ({
        ...row,
        error: scrub(row.error, 200),
        grantedTo: grants.filter((grant) => grant.connectorId === row.id).map((grant) => `@${grant.handle}`),
      })),
      note: "Adding a new connector needs an OAuth sign-in or token in Settings → Connectors.",
    }
  }
  const bot = await findBot(actor, input)
  if (!input.connectorId || !UUID.test(input.connectorId)) {
    throw new OrchestratorAdminError("Pass connector_id from sayabot_connectors list")
  }
  const [connector] = await getDb()
    .select({ id: workspaceConnectors.id, name: workspaceConnectors.name })
    .from(workspaceConnectors)
    .where(and(eq(workspaceConnectors.orgId, actor.orgId), eq(workspaceConnectors.id, input.connectorId)))
    .limit(1)
  if (!connector) throw new OrchestratorAdminError("Connector not found in this workspace")

  await getDb()
    .delete(agentConnectorGrants)
    .where(
      and(
        eq(agentConnectorGrants.orgId, actor.orgId),
        eq(agentConnectorGrants.agentId, bot.id),
        eq(agentConnectorGrants.connectorId, connector.id),
      ),
    )
  if (input.action === "grant") {
    await getDb()
      .insert(agentConnectorGrants)
      .values({
        orgId: actor.orgId,
        agentId: bot.id,
        connectorId: connector.id,
        scopeConfig: { readOnly: input.readOnly ?? true },
      })
  }
  await recordAudit(actor, `connector.${input.action}_by_orchestrator`, connector.id, {
    handle: bot.handle,
    readOnly: input.readOnly ?? true,
  })
  return { ok: true, action: input.action, connector: connector.name, handle: bot.handle }
}

/** Secret names and who may use them. Values and ciphertext are never read. */
export async function manageSecrets(
  actor: OrchestratorActor,
  input: { action: "list" | "revoke"; grantId?: string },
) {
  if (input.action === "list") {
    const [secretRows, grantRows] = await Promise.all([
      getDb()
        .select({ id: vaultSecrets.id, label: vaultSecrets.label, last4: vaultSecrets.last4, lastUsedAt: vaultSecrets.lastUsedAt })
        .from(vaultSecrets)
        .where(eq(vaultSecrets.orgId, actor.orgId)),
      getDb()
        .select({
          id: agentSecretGrants.id,
          secretId: agentSecretGrants.secretId,
          envName: agentSecretGrants.envName,
          hosts: agentSecretGrants.allowedHosts,
          handle: agents.handle,
        })
        .from(agentSecretGrants)
        .innerJoin(agents, eq(agents.id, agentSecretGrants.agentId))
        .where(and(eq(agentSecretGrants.orgId, actor.orgId), isNull(agentSecretGrants.revokedAt))),
    ])
    return {
      secrets: secretRows.map((secret) => ({
        id: secret.id,
        label: secret.label,
        endsWith: secret.last4,
        lastUsedAt: secret.lastUsedAt?.toISOString() ?? null,
        grants: grantRows
          .filter((grant) => grant.secretId === secret.id)
          .map((grant) => ({ grantId: grant.id, handle: `@${grant.handle}`, env: grant.envName, hosts: grant.hosts })),
      })),
      note: "Adding a secret or a new grant happens in Settings → Secrets, so the value never passes through chat.",
    }
  }
  if (!input.grantId || !UUID.test(input.grantId)) {
    throw new OrchestratorAdminError("Pass grant_id from sayabot_secrets list")
  }
  const revoked = await getDb()
    .update(agentSecretGrants)
    .set({ revokedAt: new Date() })
    .where(and(eq(agentSecretGrants.orgId, actor.orgId), eq(agentSecretGrants.id, input.grantId)))
    .returning({ id: agentSecretGrants.id, env: agentSecretGrants.envName })
  if (!revoked[0]) throw new OrchestratorAdminError("Grant not found in this workspace")
  await recordAudit(actor, "secret_grant.revoked_by_orchestrator", input.grantId, { env: revoked[0].env })
  return { ok: true, revoked: revoked[0].env }
}

export async function manageMcpServers(
  actor: OrchestratorActor,
  input: { action: "list" | "enable" | "disable"; serverId?: string },
) {
  if (input.action === "list") {
    const rows = await getDb()
      .select({
        id: mcpServers.id,
        name: mcpServers.name,
        app: mcpServers.catalogApp,
        enabled: mcpServers.enabled,
        authStatus: mcpServers.authStatus,
        roomId: mcpServers.roomId,
        tools: mcpServers.toolCache,
      })
      .from(mcpServers)
      .where(eq(mcpServers.orgId, actor.orgId))
    return {
      servers: rows.map((row) => ({
        id: row.id,
        name: row.name,
        app: row.app,
        enabled: row.enabled,
        signedIn: row.authStatus === "ok",
        scope: row.roomId ? "room" : "workspace",
        tools: (row.tools?.tools ?? []).slice(0, 30).map((tool) => tool.name),
      })),
      note: "Install new apps from the Bot store or Settings → Apps; sign-in happens in the browser.",
    }
  }
  if (!input.serverId || !UUID.test(input.serverId)) {
    throw new OrchestratorAdminError("Pass server_id from sayabot_mcp list")
  }
  const updated = await getDb()
    .update(mcpServers)
    .set({ enabled: input.action === "enable", updatedAt: new Date() })
    .where(and(eq(mcpServers.orgId, actor.orgId), eq(mcpServers.id, input.serverId)))
    .returning({ name: mcpServers.name })
  if (!updated[0]) throw new OrchestratorAdminError("MCP server not found in this workspace")
  await recordAudit(actor, `mcp.${input.action}d_by_orchestrator`, input.serverId, {})
  return { ok: true, server: updated[0].name, enabled: input.action === "enable" }
}

// ─── Shared memory ───────────────────────────────────────────────────────────

export async function manageMemory(
  actor: OrchestratorActor,
  input: BotRef & {
    action: "list" | "remember" | "forget"
    scope?: "org" | "room" | "agent"
    roomId?: string
    room?: string
    title?: string
    body?: string
    kind?: "fact" | "preference" | "decision" | "procedure"
    pinned?: boolean
    memoryId?: string
    query?: string
  },
) {
  const db = getDb()
  if (input.action === "list") {
    const filters = [eq(memories.orgId, actor.orgId), isNull(memories.supersededBy)]
    if (input.scope) filters.push(eq(memories.scope, input.scope))
    if (input.query) {
      const needle = `%${input.query.replace(/[%_]/g, "")}%`
      filters.push(sql`(${memories.title} ilike ${needle} or ${memories.body} ilike ${needle})`)
    }
    const rows = await db
      .select({
        id: memories.id,
        scope: memories.scope,
        kind: memories.kind,
        title: memories.title,
        body: memories.body,
        pinned: memories.pinned,
        updatedAt: memories.updatedAt,
      })
      .from(memories)
      .where(and(...filters))
      .orderBy(desc(memories.pinned), desc(memories.updatedAt))
      .limit(50)
    return {
      memories: rows.map((row) => ({
        ...row,
        body: scrub(row.body, 500),
        updatedAt: row.updatedAt.toISOString(),
      })),
    }
  }
  if (input.action === "forget") {
    if (!input.memoryId || !UUID.test(input.memoryId)) {
      throw new OrchestratorAdminError("Pass memory_id from sayabot_memory list")
    }
    const removed = await db
      .delete(memories)
      .where(and(eq(memories.orgId, actor.orgId), eq(memories.id, input.memoryId)))
      .returning({ title: memories.title })
    if (!removed[0]) throw new OrchestratorAdminError("Memory not found in this workspace")
    await recordAudit(actor, "memory.forgotten_by_orchestrator", input.memoryId, {})
    return { ok: true, forgot: removed[0].title }
  }

  const title = input.title?.trim()
  const body = input.body?.trim()
  if (!title || !body) throw new OrchestratorAdminError("remember needs a title and a body")
  const scope = input.scope ?? "org"
  const room = scope === "room" ? await findRoom(actor, input) : null
  const bot = scope === "agent" ? await findBot(actor, input) : null
  const [created] = await db
    .insert(memories)
    .values({
      orgId: actor.orgId,
      scope,
      roomId: room?.id ?? null,
      agentId: bot?.id ?? null,
      kind: input.kind ?? "fact",
      title: redactSecrets(title).text.slice(0, 200),
      body: redactSecrets(body).text.slice(0, 4_000),
      pinned: input.pinned ?? false,
      source: "agent",
      createdByAgentId: actor.agentId ?? null,
    })
    .returning({ id: memories.id })
  await recordAudit(actor, "memory.saved_by_orchestrator", created?.id ?? null, { scope })
  return { ok: true, id: created?.id, scope, room: room?.name ?? null, handle: bot?.handle ?? null }
}
