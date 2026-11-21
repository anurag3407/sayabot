import {
  DEFAULT_CAPABILITIES,
  assignableModelId,
  isSayaHandle,
  parseCapabilities,
  redactSecrets,
  type AgentCapabilities,
} from "@sayabot/core"
import {
  agents,
  auditLogs,
  desktopHosts,
  mcpServers,
  orgComputerSettings,
  orgPlans,
  orgUsageMonthly,
  orgs,
  providerKeys,
  roomAgents,
  roomMembers,
  rooms,
  usageEvents,
  workspaceConnectors,
} from "@sayabot/db"
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm"
import { getDb } from "../db"

/**
 * The workspace-admin operations behind Saya's `sayabot_*` tools. One implementation serves both
 * surfaces — the audited tool specs the agent runs in a turn and the MCP tools an external client
 * calls — so the two can never drift.
 *
 * Every function takes the caller's `orgId` and scopes its queries to it. Nothing here reads or
 * writes another workspace, and nothing returns a secret: provider keys and MCP servers are
 * reported by label and status only.
 */

const HANDLE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/
const ROOM_KINDS = ["public", "private", "dm"] as const
export type OrchestratorRoomKind = (typeof ROOM_KINDS)[number]

/** A caller mistake (bad handle, unknown bot). Surfaces verbatim to the model. */
export class OrchestratorAdminError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OrchestratorAdminError"
  }
}

export interface OrchestratorActor {
  orgId: string
  /** The acting agent row, recorded on the audit trail. */
  agentId?: string | null
}

function normaliseHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "").toLowerCase()
}

export async function recordAudit(
  actor: OrchestratorActor,
  action: string,
  target: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await getDb()
    .insert(auditLogs)
    .values({
      orgId: actor.orgId,
      actorType: "agent",
      actorId: actor.agentId ?? null,
      action,
      target,
      metadata,
    })
}

function summariseCapabilities(input: unknown): AgentCapabilities {
  return parseCapabilities(input)
}

export interface BotSummary {
  id: string
  handle: string
  displayName: string
  kind: string
  model: string | null
  orchestrator: boolean
  capabilities: string[]
  createdAt: string
}

function enabledTools(caps: AgentCapabilities): string[] {
  const names = Object.entries(caps).flatMap(([key, value]) =>
    value === true ? [key] : value === false || value === undefined ? [] : [key],
  )
  return names.sort()
}

export async function listBots(actor: OrchestratorActor): Promise<BotSummary[]> {
  const rows = await getDb()
    .select({
      id: agents.id,
      handle: agents.handle,
      displayName: agents.displayName,
      kind: agents.kind,
      model: agents.model,
      capabilities: agents.capabilities,
      createdAt: agents.createdAt,
    })
    .from(agents)
    .where(eq(agents.orgId, actor.orgId))
    .orderBy(asc(agents.createdAt))

  return rows.map((row) => {
    const caps = summariseCapabilities(row.capabilities)
    return {
      id: row.id,
      handle: row.handle,
      displayName: row.displayName,
      kind: row.kind,
      model: row.model,
      orchestrator: caps.orchestrator === true,
      capabilities: enabledTools(caps),
      createdAt: row.createdAt.toISOString(),
    }
  })
}

export interface CreateBotInput {
  handle: string
  displayName: string
  instructions?: string
  model?: string
  /** Partial capability toggles. `orchestrator` is ignored: it can never be granted here. */
  capabilities?: Record<string, boolean>
}

export async function createBot(actor: OrchestratorActor, input: CreateBotInput) {
  const handle = normaliseHandle(input.handle)
  if (!HANDLE_PATTERN.test(handle)) {
    throw new OrchestratorAdminError(
      "handle must be 2-32 characters, start with a letter, and use lowercase letters, numbers, _ or -",
    )
  }
  const displayName = input.displayName.trim()
  if (displayName.length < 1 || displayName.length > 60) {
    throw new OrchestratorAdminError("display_name must be 1 to 60 characters")
  }

  const [existing] = await getDb()
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.orgId, actor.orgId), eq(agents.handle, handle)))
    .limit(1)
  if (existing) throw new OrchestratorAdminError(`@${handle} already exists in this workspace`)

  const model = input.model?.trim() ?? ""
  if (!model) {
    throw new OrchestratorAdminError(
      "Ask the admin which model this bot should use. Call sayabot_models, quote the choices, and wait for their answer. Do not invent a model id, and do not create the bot until they pick one.",
    )
  }
  if (!assignableModelId(model)) {
    throw new OrchestratorAdminError("model must be a model id, not a key or a URL")
  }
  if (isSayaHandle(handle)) {
    throw new OrchestratorAdminError("The handle saya is reserved for the workspace orchestrator.")
  }

  const capabilities = parseCapabilities({
    ...DEFAULT_CAPABILITIES,
    ...(input.capabilities ?? {}),
    orchestrator: false,
  })

  const [created] = await getDb()
    .insert(agents)
    .values({
      orgId: actor.orgId,
      handle,
      displayName,
      kind: "llm",
      model,
      systemPrompt: (input.instructions ?? "").slice(0, 20_000),
      params: {},
      capabilities,
      visibility: "org",
    })
    .returning({
      id: agents.id,
      handle: agents.handle,
      displayName: agents.displayName,
      model: agents.model,
      capabilities: agents.capabilities,
    })

  if (!created) throw new OrchestratorAdminError("Could not create the bot")

  await recordAudit(actor, "agent.created_by_orchestrator", handle, {
    displayName,
    model,
  })

  return {
    id: created.id,
    handle: created.handle,
    displayName: created.displayName,
    model: created.model,
    capabilities: enabledTools(summariseCapabilities(created.capabilities)),
  }
}

export interface UpdateBotInput {
  agentId?: string
  handle?: string
  displayName?: string
  instructions?: string
  model?: string | null
  capabilities?: Record<string, boolean>
}

export async function updateBot(actor: OrchestratorActor, input: UpdateBotInput) {
  const [current] = await getDb()
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.orgId, actor.orgId),
        input.agentId
          ? eq(agents.id, input.agentId)
          : eq(agents.handle, normaliseHandle(input.handle ?? "")),
      ),
    )
    .limit(1)
  if (!current) throw new OrchestratorAdminError("Bot not found in this workspace")

  const currentCaps = summariseCapabilities(current.capabilities)
  const nextCaps = input.capabilities
    ? parseCapabilities({
        ...currentCaps,
        ...input.capabilities,
        // The orchestrator capability is not transferable; only the built-in Saya keeps it.
        orchestrator: currentCaps.orchestrator === true,
      })
    : currentCaps

  const patch: Partial<typeof agents.$inferInsert> = { updatedAt: new Date() }
  if (input.displayName !== undefined) {
    const displayName = input.displayName.trim()
    if (displayName.length < 1 || displayName.length > 60) {
      throw new OrchestratorAdminError("display_name must be 1 to 60 characters")
    }
    patch.displayName = displayName
  }
  if (input.instructions !== undefined) {
    if (isSayaHandle(current.handle)) {
      throw new OrchestratorAdminError(
        "Saya's standing instructions stay fixed. Change another bot, or the room directive.",
      )
    }
    patch.systemPrompt = input.instructions.slice(0, 20_000)
  }
  if (input.model !== undefined && input.model !== null && !assignableModelId(input.model)) {
    throw new OrchestratorAdminError("model must be a model id, not a key or a URL")
  }
  if (input.model !== undefined) patch.model = input.model
  if (input.capabilities !== undefined) patch.capabilities = nextCaps

  const [updated] = await getDb()
    .update(agents)
    .set(patch)
    .where(eq(agents.id, current.id))
    .returning({
      id: agents.id,
      handle: agents.handle,
      displayName: agents.displayName,
      model: agents.model,
      capabilities: agents.capabilities,
    })

  if (!updated) throw new OrchestratorAdminError("Could not update the bot")

  await recordAudit(actor, "agent.updated_by_orchestrator", updated.handle, {
    changed: Object.keys(patch).filter((key) => key !== "updatedAt"),
  })

  return {
    id: updated.id,
    handle: updated.handle,
    displayName: updated.displayName,
    model: updated.model,
    capabilities: enabledTools(summariseCapabilities(updated.capabilities)),
  }
}

export interface RoomSummary {
  id: string
  name: string
  kind: string
  timezone: string
  turnMode: string
  executionMode: string
  bots: number
}

export async function listRooms(actor: OrchestratorActor): Promise<RoomSummary[]> {
  const rows = await getDb()
    .select({
      id: rooms.id,
      name: rooms.name,
      kind: rooms.kind,
      timezone: rooms.timezone,
      turnMode: rooms.turnMode,
      executionMode: rooms.executionMode,
      bots: sql<number>`(select count(*)::int from ${roomAgents} where ${roomAgents.roomId} = ${rooms.id})`,
    })
    .from(rooms)
    .where(eq(rooms.orgId, actor.orgId))
    .orderBy(asc(rooms.createdAt))

  return rows.map((row) => ({ ...row, bots: Number(row.bots) }))
}

export interface CreateRoomInput {
  name: string
  kind?: OrchestratorRoomKind
  timezone?: string
  /** Copy the people from this room, so the new chat is not invisible to everyone. */
  memberRoomId?: string
}

export async function createRoom(actor: OrchestratorActor, input: CreateRoomInput) {
  const name = input.name.trim()
  if (name.length < 1 || name.length > 60) {
    throw new OrchestratorAdminError("name must be 1 to 60 characters")
  }
  const kind = input.kind ?? "private"
  if (!ROOM_KINDS.includes(kind)) {
    throw new OrchestratorAdminError(`kind must be one of ${ROOM_KINDS.join(", ")}`)
  }

  let sourceRoomId: string | null = null
  if (input.memberRoomId) {
    const [source] = await getDb()
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.orgId, actor.orgId), eq(rooms.id, input.memberRoomId)))
      .limit(1)
    if (!source) throw new OrchestratorAdminError("The room to copy members from was not found")
    sourceRoomId = source.id
  }

  const [created] = await getDb()
    .insert(rooms)
    .values({
      orgId: actor.orgId,
      name,
      kind,
      timezone: input.timezone ?? "UTC",
    })
    .returning({ id: rooms.id, name: rooms.name, kind: rooms.kind, timezone: rooms.timezone })

  if (!created) throw new OrchestratorAdminError("Could not create the room")

  if (sourceRoomId) {
    const people = await getDb()
      .select({ userId: roomMembers.userId, role: roomMembers.role })
      .from(roomMembers)
      .where(eq(roomMembers.roomId, sourceRoomId))
    if (people.length) {
      await getDb()
        .insert(roomMembers)
        .values(people.map((person) => ({ roomId: created.id, ...person })))
        .onConflictDoNothing()
    }
  }

  if (actor.agentId) {
    await getDb()
      .insert(roomAgents)
      .values({ roomId: created.id, agentId: actor.agentId, position: 0 })
      .onConflictDoNothing()
  }

  await recordAudit(actor, "room.created_by_orchestrator", created.name, {
    roomId: created.id,
    kind,
  })

  return created
}

export async function addBotToRoom(
  actor: OrchestratorActor,
  input: { roomId: string; agentId?: string; handle?: string },
) {
  const [room] = await getDb()
    .select({ id: rooms.id, name: rooms.name })
    .from(rooms)
    .where(and(eq(rooms.orgId, actor.orgId), eq(rooms.id, input.roomId)))
    .limit(1)
  if (!room) throw new OrchestratorAdminError("Room not found in this workspace")

  const [bot] = await getDb()
    .select({ id: agents.id, handle: agents.handle })
    .from(agents)
    .where(
      and(
        eq(agents.orgId, actor.orgId),
        input.agentId
          ? eq(agents.id, input.agentId)
          : eq(agents.handle, normaliseHandle(input.handle ?? "")),
      ),
    )
    .limit(1)
  if (!bot) throw new OrchestratorAdminError("Bot not found in this workspace")

  await getDb()
    .insert(roomAgents)
    .values({ roomId: room.id, agentId: bot.id, position: 0 })
    .onConflictDoNothing()

  await recordAudit(actor, "room.bot_added_by_orchestrator", room.name, {
    roomId: room.id,
    handle: bot.handle,
  })

  return { roomId: room.id, room: room.name, handle: bot.handle }
}

export interface UsageSummary {
  month: string
  /** Start of the counted window (ISO). */
  since?: string
  plan: string | null
  serverTurns: number
  turns: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  byBot: Array<{ handle: string | null; agentId: string | null; calls: number; costUsd: number }>
}

export async function usageSummary(
  actor: OrchestratorActor,
  options: { days?: number } = {},
): Promise<UsageSummary> {
  const now = new Date()
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
  // Default: this calendar month. With `days`, a rolling window of 1 to 90 days instead.
  const monthStart = options.days
    ? new Date(now.getTime() - Math.max(1, Math.min(90, Math.round(options.days))) * 86_400_000)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const [totals] = await getDb()
    .select({
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::int`,
      costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)::float8`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.orgId, actor.orgId), gte(usageEvents.createdAt, monthStart)))

  const byBot = await getDb()
    .select({
      agentId: usageEvents.agentId,
      handle: agents.handle,
      calls: sql<number>`count(*)::int`,
      costUsd: sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)::float8`,
    })
    .from(usageEvents)
    .leftJoin(agents, eq(agents.id, usageEvents.agentId))
    .where(and(eq(usageEvents.orgId, actor.orgId), gte(usageEvents.createdAt, monthStart)))
    .groupBy(usageEvents.agentId, agents.handle)

  const [plan] = await getDb()
    .select({ plan: orgPlans.plan })
    .from(orgPlans)
    .where(eq(orgPlans.orgId, actor.orgId))
    .limit(1)

  const [monthly] = await getDb()
    .select({ serverTurns: orgUsageMonthly.serverTurns })
    .from(orgUsageMonthly)
    .where(and(eq(orgUsageMonthly.orgId, actor.orgId), eq(orgUsageMonthly.month, month)))
    .limit(1)

  return {
    month,
    since: monthStart.toISOString(),
    plan: plan?.plan ?? null,
    serverTurns: monthly?.serverTurns ?? 0,
    turns: Number(totals?.calls ?? 0),
    inputTokens: Number(totals?.inputTokens ?? 0),
    outputTokens: Number(totals?.outputTokens ?? 0),
    costUsd: Number(totals?.costUsd ?? 0),
    byBot: byBot.map((row) => ({
      agentId: row.agentId,
      handle: row.handle,
      calls: Number(row.calls),
      costUsd: Number(row.costUsd),
    })),
  }
}

export interface ConfigSnapshot {
  workspace: { slug: string; name: string; createdAt: string }
  plan: string | null
  counts: { bots: number; rooms: number; mcpServers: number; providerKeys: number }
  providers: Array<{ provider: string; label: string; last4: string; baseUrl: string | null }>
  mcpServers: Array<{ name: string; enabled: boolean; transport: string }>
  connectors: Array<{ name: string; source: string; status: string; last4: string }>
  desktops: Array<{ name: string; platform: string; lastSeenAt: string | null; online: boolean }>
  computers: { boat: boolean; e2b: boolean; vps: boolean; startVpsAutomatically: boolean }
}

/** Resolved, read-only view of the workspace. Never includes ciphertext or key material. */
export async function configSnapshot(actor: OrchestratorActor): Promise<ConfigSnapshot> {
  const [org] = await getDb()
    .select({ slug: orgs.slug, name: orgs.name, createdAt: orgs.createdAt })
    .from(orgs)
    .where(eq(orgs.id, actor.orgId))
    .limit(1)
  if (!org) throw new OrchestratorAdminError("Workspace not found")

  const [plan] = await getDb()
    .select({ plan: orgPlans.plan })
    .from(orgPlans)
    .where(eq(orgPlans.orgId, actor.orgId))
    .limit(1)

  const [botCount] = await getDb()
    .select({ value: sql<number>`count(*)::int` })
    .from(agents)
    .where(eq(agents.orgId, actor.orgId))
  const [roomCount] = await getDb()
    .select({ value: sql<number>`count(*)::int` })
    .from(rooms)
    .where(eq(rooms.orgId, actor.orgId))
  const mcp = await getDb()
    .select({ name: mcpServers.name, enabled: mcpServers.enabled, transport: mcpServers.transport })
    .from(mcpServers)
    .where(eq(mcpServers.orgId, actor.orgId))
    .orderBy(asc(mcpServers.name))
  const providers = await getDb()
    .select({
      provider: providerKeys.provider,
      label: providerKeys.label,
      last4: providerKeys.last4,
      baseUrl: providerKeys.baseUrl,
    })
    .from(providerKeys)
    .where(eq(providerKeys.orgId, actor.orgId))
    .orderBy(asc(providerKeys.label))

  const connectors = await getDb()
    .select({
      name: workspaceConnectors.name,
      source: workspaceConnectors.source,
      status: workspaceConnectors.status,
      last4: workspaceConnectors.last4,
    })
    .from(workspaceConnectors)
    .where(eq(workspaceConnectors.orgId, actor.orgId))
    .orderBy(asc(workspaceConnectors.name))

  const hosts = await getDb()
    .select({
      name: desktopHosts.name,
      platform: desktopHosts.platform,
      lastSeenAt: desktopHosts.lastSeenAt,
    })
    .from(desktopHosts)
    .where(and(eq(desktopHosts.orgId, actor.orgId), isNull(desktopHosts.revokedAt)))
    .orderBy(asc(desktopHosts.name))

  const [computers] = await getDb()
    .select({
      boat: orgComputerSettings.boatCiphertext,
      e2b: orgComputerSettings.e2bCiphertext,
      vps: orgComputerSettings.vpsHost,
      startVpsAutomatically: orgComputerSettings.vpsStartAutomatically,
    })
    .from(orgComputerSettings)
    .where(eq(orgComputerSettings.orgId, actor.orgId))
    .limit(1)

  return {
    workspace: { slug: org.slug, name: org.name, createdAt: org.createdAt.toISOString() },
    plan: plan?.plan ?? null,
    counts: {
      bots: Number(botCount?.value ?? 0),
      rooms: Number(roomCount?.value ?? 0),
      mcpServers: mcp.length,
      providerKeys: providers.length,
    },
    providers: providers.map((row) => ({
      ...row,
      baseUrl: row.baseUrl ? redactSecrets(row.baseUrl).text : null,
    })),
    mcpServers: mcp,
    connectors,
    desktops: hosts.map((host) => ({
      name: host.name,
      platform: host.platform,
      lastSeenAt: host.lastSeenAt?.toISOString() ?? null,
      online: host.lastSeenAt ? Date.now() - host.lastSeenAt.getTime() < 90_000 : false,
    })),
    computers: {
      boat: Boolean(computers?.boat),
      e2b: Boolean(computers?.e2b),
      vps: Boolean(computers?.vps),
      startVpsAutomatically: computers?.startVpsAutomatically === true,
    },
  }
}
