import {
  assignableModelId,
  getNextCronRun,
  humanReadableCron,
  isValidCron,
  normalizeCronExpression,
  redactSecrets,
  reviewApproval,
  roomConfigPatch,
  type ApprovalDecision,
} from "@sayabot/core"
import { catalogProviderModels } from "@sayabot/llm/models"
import {
  agentRuns,
  agents,
  providerKeys,
  roomAgents,
  rooms,
  routines,
  toolCalls,
} from "@sayabot/db"
import { and, asc, desc, eq } from "drizzle-orm"
import { applyTaskCreate } from "../collab/tasks-service"
import { getDb, notify } from "../db"
import { enqueueRoomMessage } from "../jobs"
import { resolveApprovalWaiter } from "../tools/approvals"
import {
  OrchestratorAdminError,
  recordAudit,
  updateBot,
  type OrchestratorActor,
  type UpdateBotInput,
} from "./service"

/**
 * Models, approvals, delegation, routines, room config, and failed-turn repair.
 * Same org scope as the roster tools. Results are scrubbed, and Saya cannot approve herself.
 * Retrying a run only enqueues work: the turn coordinator takes the room lock when it runs,
 * so this does not lock a room the current turn may already hold.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function scrub(value: string | null | undefined): string | null {
  if (!value) return null
  return redactSecrets(value).text.slice(0, 500)
}

function previewArgs(args: unknown): string {
  const text = redactSecrets(JSON.stringify(args ?? {})).text
  return text.length > 800 ? `${text.slice(0, 800)}…` : text
}

async function resolveRoom(actor: OrchestratorActor, input: { roomId?: string; room?: string }) {
  if (input.roomId) {
    if (!UUID_PATTERN.test(input.roomId)) {
      throw new OrchestratorAdminError("room_id must be a uuid")
    }
    const [room] = await getDb()
      .select({ id: rooms.id, name: rooms.name, timezone: rooms.timezone })
      .from(rooms)
      .where(and(eq(rooms.orgId, actor.orgId), eq(rooms.id, input.roomId)))
      .limit(1)
    if (!room) throw new OrchestratorAdminError("Room not found in this workspace")
    return room
  }
  const name = input.room?.trim()
  if (!name) throw new OrchestratorAdminError("Pass a room_id or a room name")
  const matches = await getDb()
    .select({ id: rooms.id, name: rooms.name, timezone: rooms.timezone })
    .from(rooms)
    .where(and(eq(rooms.orgId, actor.orgId), eq(rooms.name, name)))
    .limit(2)
  const room = matches[0]
  if (!room) throw new OrchestratorAdminError("Room not found in this workspace")
  if (matches[1])
    throw new OrchestratorAdminError("More than one room has that name. Pass room_id.")
  return room
}

async function botInOrg(actor: OrchestratorActor, input: { agentId?: string; handle?: string }) {
  const handle = input.handle?.trim().replace(/^@+/, "").toLowerCase()
  if (!input.agentId && !handle) {
    throw new OrchestratorAdminError("Pass the bot's handle or agent_id")
  }
  const [bot] = await getDb()
    .select({ id: agents.id, handle: agents.handle })
    .from(agents)
    .where(
      and(
        eq(agents.orgId, actor.orgId),
        input.agentId ? eq(agents.id, input.agentId) : eq(agents.handle, handle ?? ""),
      ),
    )
    .limit(1)
  if (!bot) throw new OrchestratorAdminError("Bot not found in this workspace")
  return bot
}

export async function listModels(actor: OrchestratorActor) {
  const keys = await getDb()
    .select({ provider: providerKeys.provider, label: providerKeys.label })
    .from(providerKeys)
    .where(eq(providerKeys.orgId, actor.orgId))
    .orderBy(asc(providerKeys.label))

  const assignedRows = await getDb()
    .select({ model: agents.model, handle: agents.handle })
    .from(agents)
    .where(eq(agents.orgId, actor.orgId))

  const grouped = new Map<
    string,
    { labels: string[]; models: Array<{ id: string; label: string }> }
  >()
  for (const key of keys) {
    const current = grouped.get(key.provider) ?? { labels: [], models: [] }
    current.labels.push(key.label)
    if (current.models.length === 0) {
      try {
        current.models = catalogProviderModels(key.provider)
          .slice(0, 25)
          .map((model) => ({ id: model.id, label: model.label }))
      } catch {
        current.models = []
      }
    }
    grouped.set(key.provider, current)
  }

  return {
    providers: [...grouped.entries()].map(([provider, value]) => ({
      provider,
      labels: value.labels,
      models: value.models,
    })),
    assigned: assignedRows
      .filter((row): row is { model: string; handle: string } => Boolean(row.model))
      .map((row) => ({ handle: row.handle, model: row.model })),
  }
}

export async function listApprovals(actor: OrchestratorActor) {
  const rows = await getDb()
    .select({
      id: toolCalls.id,
      toolName: toolCalls.toolName,
      args: toolCalls.args,
      roomId: toolCalls.roomId,
      room: rooms.name,
      agentId: agentRuns.agentId,
      handle: agents.handle,
      createdAt: toolCalls.createdAt,
    })
    .from(toolCalls)
    .innerJoin(rooms, eq(rooms.id, toolCalls.roomId))
    .leftJoin(agentRuns, eq(agentRuns.id, toolCalls.runId))
    .leftJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(and(eq(rooms.orgId, actor.orgId), eq(toolCalls.status, "pending_approval")))
    .orderBy(desc(toolCalls.createdAt))
    .limit(30)

  return rows.map((row) => ({
    id: row.id,
    tool: row.toolName,
    args: previewArgs(row.args),
    roomId: row.roomId,
    room: row.room,
    agentId: row.agentId,
    handle: row.handle,
    createdAt: row.createdAt.toISOString(),
    self: row.agentId !== null && row.agentId === actor.agentId,
  }))
}

export async function decideApproval(
  actor: OrchestratorActor,
  input: { toolCallId: string; decision: ApprovalDecision; summary: string },
) {
  const [row] = await getDb()
    .select({
      id: toolCalls.id,
      status: toolCalls.status,
      toolName: toolCalls.toolName,
      roomId: toolCalls.roomId,
      agentId: agentRuns.agentId,
      handle: agents.handle,
    })
    .from(toolCalls)
    .innerJoin(rooms, eq(rooms.id, toolCalls.roomId))
    .leftJoin(agentRuns, eq(agentRuns.id, toolCalls.runId))
    .leftJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(and(eq(toolCalls.id, input.toolCallId), eq(rooms.orgId, actor.orgId)))
    .limit(1)
  if (!row) throw new OrchestratorAdminError("Command not found in this workspace")
  if (row.status !== "pending_approval") {
    return {
      ok: false as const,
      status: row.status,
      reason: `That command is already ${row.status}.`,
    }
  }

  const review = reviewApproval({
    decision: input.decision,
    callerAgentId: actor.agentId ?? null,
    subjectAgentId: row.agentId,
    toolName: row.toolName,
  })
  if (!review.allow) return { ok: false as const, needsHuman: true, reason: review.reason }

  const status = input.decision === "approve" ? "approved" : "rejected"
  const updated = await getDb()
    .update(toolCalls)
    .set({
      status,
      resolvedAt: new Date(),
      error: input.decision === "reject" ? scrub(input.summary) : null,
    })
    .where(and(eq(toolCalls.id, row.id), eq(toolCalls.status, "pending_approval")))
    .returning({ id: toolCalls.id })
  if (!updated.length) {
    return { ok: false as const, reason: "That command was decided while this was running." }
  }

  await notify("tool_call_resolved", { toolCallId: row.id, status })
  resolveApprovalWaiter(row.id, status)
  await recordAudit(actor, "tool.decided_by_orchestrator", row.toolName, {
    toolCallId: row.id,
    decision: input.decision,
    handle: row.handle,
    roomId: row.roomId,
  })

  return {
    ok: true as const,
    status,
    tool: row.toolName,
    handle: row.handle,
    summary: scrub(input.summary),
  }
}

export async function listErrors(actor: OrchestratorActor) {
  const runs = await getDb()
    .select({
      id: agentRuns.id,
      roomId: agentRuns.roomId,
      room: rooms.name,
      handle: agents.handle,
      messageId: agentRuns.messageId,
      error: agentRuns.error,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .innerJoin(rooms, eq(rooms.id, agentRuns.roomId))
    .leftJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(and(eq(rooms.orgId, actor.orgId), eq(agentRuns.status, "error")))
    .orderBy(desc(agentRuns.createdAt))
    .limit(20)

  const calls = await getDb()
    .select({
      id: toolCalls.id,
      toolName: toolCalls.toolName,
      roomId: toolCalls.roomId,
      room: rooms.name,
      handle: agents.handle,
      error: toolCalls.error,
      createdAt: toolCalls.createdAt,
    })
    .from(toolCalls)
    .innerJoin(rooms, eq(rooms.id, toolCalls.roomId))
    .leftJoin(agentRuns, eq(agentRuns.id, toolCalls.runId))
    .leftJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(and(eq(rooms.orgId, actor.orgId), eq(toolCalls.status, "error")))
    .orderBy(desc(toolCalls.createdAt))
    .limit(20)

  return {
    runs: runs.map((row) => ({
      id: row.id,
      roomId: row.roomId,
      room: row.room,
      handle: row.handle,
      messageId: row.messageId,
      error: scrub(row.error),
      createdAt: row.createdAt.toISOString(),
    })),
    toolCalls: calls.map((row) => ({
      id: row.id,
      tool: row.toolName,
      roomId: row.roomId,
      room: row.room,
      handle: row.handle,
      error: scrub(row.error),
      createdAt: row.createdAt.toISOString(),
    })),
  }
}

export async function retryRun(actor: OrchestratorActor, runId: string) {
  const [run] = await getDb()
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      roomId: agentRuns.roomId,
      messageId: agentRuns.messageId,
    })
    .from(agentRuns)
    .innerJoin(rooms, eq(rooms.id, agentRuns.roomId))
    .where(and(eq(agentRuns.id, runId), eq(rooms.orgId, actor.orgId)))
    .limit(1)
  if (!run) throw new OrchestratorAdminError("Run not found in this workspace")
  if (run.status !== "error") {
    throw new OrchestratorAdminError(`This run is ${run.status}, so there is nothing to retry.`)
  }
  const messageId = run.messageId
  if (!messageId) {
    throw new OrchestratorAdminError(
      "This run has no message to run again. Delegate a fix instead.",
    )
  }

  await enqueueRoomMessage(run.roomId, messageId)
  await recordAudit(actor, "run.retried_by_orchestrator", run.id, {
    roomId: run.roomId,
    messageId,
  })
  return { ok: true, runId: run.id, roomId: run.roomId, messageId }
}

export async function delegateTask(
  actor: OrchestratorActor,
  input: {
    roomId?: string
    room?: string
    handle?: string
    agentId?: string
    title: string
    instructions?: string
  },
) {
  const room = await resolveRoom(actor, input)
  const bot = await botInOrg(actor, input)
  if (actor.agentId && bot.id === actor.agentId) {
    throw new OrchestratorAdminError("Delegate to another bot. Saya already has this turn.")
  }

  const [membership] = await getDb()
    .select({ agentId: roomAgents.agentId })
    .from(roomAgents)
    .where(and(eq(roomAgents.roomId, room.id), eq(roomAgents.agentId, bot.id)))
    .limit(1)
  let joined = false
  if (!membership) {
    await getDb()
      .insert(roomAgents)
      .values({ roomId: room.id, agentId: bot.id, position: 0 })
      .onConflictDoNothing()
    joined = true
  }

  const created = await applyTaskCreate({
    orgId: actor.orgId,
    roomId: room.id,
    title: input.title,
    description: (input.instructions ?? "").slice(0, 4_000),
    assigneeAgentId: bot.id,
    requestedByAgentId: actor.agentId ?? null,
    metadata: { source: "orchestrator", delegatedBy: actor.agentId ?? null },
    actor: { type: "agent", id: actor.agentId ?? bot.id },
  })

  await recordAudit(actor, "task.delegated_by_orchestrator", created.task.id, {
    roomId: room.id,
    handle: bot.handle,
    joined,
  })

  return {
    ok: true,
    id: created.task.id,
    ref: `MESH-${created.task.number}`,
    title: created.task.title,
    handle: bot.handle,
    roomId: room.id,
    joined,
  }
}

export async function removeBotFromRoom(
  actor: OrchestratorActor,
  input: { roomId: string; handle?: string; agentId?: string },
) {
  const room = await resolveRoom(actor, { roomId: input.roomId })
  const bot = await botInOrg(actor, input)
  const removed = await getDb()
    .delete(roomAgents)
    .where(and(eq(roomAgents.roomId, room.id), eq(roomAgents.agentId, bot.id)))
    .returning({ agentId: roomAgents.agentId })
  if (!removed.length) {
    return { ok: true, removed: false, reason: `@${bot.handle} is not in that room` }
  }

  await recordAudit(actor, "room.bot_removed_by_orchestrator", room.name, {
    roomId: room.id,
    handle: bot.handle,
  })
  return { ok: true, removed: true, roomId: room.id, room: room.name, handle: bot.handle }
}

export async function configureWorkspace(
  actor: OrchestratorActor,
  input: {
    target: "room" | "bot"
    roomId?: string
    room?: string
    handle?: string
    agentId?: string
    name?: string
    timezone?: string
    systemDirective?: string | null
    turnMode?: string
    executionMode?: string
    displayName?: string
    instructions?: string
    model?: string | null
    capabilities?: Record<string, boolean>
  },
) {
  if (input.target === "room") {
    const room = await resolveRoom(actor, { roomId: input.roomId, room: input.room })
    const next = roomConfigPatch({
      name: input.name,
      timezone: input.timezone,
      systemDirective: input.systemDirective,
      turnMode: input.turnMode,
      executionMode: input.executionMode,
    })
    if (!next.ok) throw new OrchestratorAdminError(next.reason)
    await getDb()
      .update(rooms)
      .set({ ...next.patch, updatedAt: new Date() })
      .where(eq(rooms.id, room.id))
    await recordAudit(actor, "room.configured_by_orchestrator", room.name, {
      roomId: room.id,
      changed: Object.keys(next.patch),
    })
    return { ok: true, target: "room" as const, roomId: room.id, changed: Object.keys(next.patch) }
  }

  const botPatch: UpdateBotInput = {
    handle: input.handle,
    agentId: input.agentId,
    displayName: input.displayName,
    instructions: input.instructions,
    model: input.model,
    capabilities: input.capabilities,
  }
  if (
    botPatch.displayName === undefined &&
    botPatch.instructions === undefined &&
    botPatch.model === undefined &&
    botPatch.capabilities === undefined
  ) {
    throw new OrchestratorAdminError("Pass a display name, instructions, model, or capabilities")
  }
  if (typeof botPatch.model === "string" && !assignableModelId(botPatch.model)) {
    throw new OrchestratorAdminError("model must be a model id, not a key or a URL")
  }
  const updated = await updateBot(actor, botPatch)
  return { ok: true, target: "bot" as const, ...updated }
}

export async function manageRoutines(
  actor: OrchestratorActor,
  input: {
    action: "list" | "create" | "pause" | "resume" | "remove"
    id?: string
    name?: string
    schedule?: string
    prompt?: string
    timezone?: string
    handle?: string
    agentId?: string
    roomId?: string
    room?: string
  },
) {
  if (input.action === "list") {
    const rows = await getDb()
      .select({
        id: routines.id,
        name: routines.name,
        scheduleExpr: routines.scheduleExpr,
        timezone: routines.timezone,
        enabled: routines.enabled,
        lastStatus: routines.lastStatus,
        lastError: routines.lastError,
        nextRunAt: routines.nextRunAt,
        handle: agents.handle,
        roomId: routines.roomId,
      })
      .from(routines)
      .innerJoin(agents, eq(agents.id, routines.agentId))
      .where(eq(routines.orgId, actor.orgId))
      .orderBy(desc(routines.createdAt))
      .limit(50)
    return {
      routines: rows.map((row) => ({
        id: row.id,
        name: row.name,
        handle: row.handle,
        roomId: row.roomId,
        schedule: row.scheduleExpr,
        humanSchedule: humanReadableCron(row.scheduleExpr),
        timezone: row.timezone,
        enabled: row.enabled,
        lastStatus: row.lastStatus,
        lastError: scrub(row.lastError),
        nextRunAt: row.nextRunAt?.toISOString() ?? null,
      })),
    }
  }

  if (input.action === "create") {
    const name = input.name?.trim() ?? ""
    const prompt = input.prompt?.trim() ?? ""
    if (!name) throw new OrchestratorAdminError("A routine needs a name")
    if (!input.schedule) throw new OrchestratorAdminError("A routine needs a schedule")
    if (!prompt) throw new OrchestratorAdminError("A routine needs a prompt")
    const schedule = normalizeCronExpression(input.schedule)
    if (!isValidCron(schedule)) {
      throw new OrchestratorAdminError(
        "Schedule must be 5-part cron or a shorthand like 'daily at 9am' or 'every 30m'.",
      )
    }
    const bot = await botInOrg(actor, { agentId: input.agentId, handle: input.handle })
    const room = input.roomId || input.room ? await resolveRoom(actor, input) : null
    const timezone = input.timezone?.trim() || room?.timezone || "UTC"
    const nextRun = getNextCronRun(schedule, new Date(), timezone)
    const [created] = await getDb()
      .insert(routines)
      .values({
        orgId: actor.orgId,
        roomId: room?.id ?? null,
        agentId: bot.id,
        name: name.slice(0, 80),
        scheduleExpr: schedule,
        scheduleKind: "cron",
        timezone,
        prompt: prompt.slice(0, 8_000),
        enabled: true,
        nextRunAt: nextRun,
        createdByAgentId: actor.agentId ?? null,
      })
      .returning({ id: routines.id, name: routines.name, nextRunAt: routines.nextRunAt })
    if (!created) throw new OrchestratorAdminError("Could not create the routine")
    await recordAudit(actor, "routine.created_by_orchestrator", created.name, {
      routineId: created.id,
      handle: bot.handle,
    })
    return {
      ok: true,
      id: created.id,
      name: created.name,
      schedule,
      humanSchedule: humanReadableCron(schedule),
      nextRunAt: created.nextRunAt?.toISOString() ?? null,
      handle: bot.handle,
    }
  }

  if (!input.id) throw new OrchestratorAdminError("Pass the routine id")
  const [routine] = await getDb()
    .select()
    .from(routines)
    .where(and(eq(routines.id, input.id), eq(routines.orgId, actor.orgId)))
    .limit(1)
  if (!routine) throw new OrchestratorAdminError("Routine not found in this workspace")

  if (input.action === "remove") {
    await getDb().delete(routines).where(eq(routines.id, routine.id))
    await recordAudit(actor, "routine.removed_by_orchestrator", routine.name, {
      routineId: routine.id,
    })
    return { ok: true, removed: true, id: routine.id }
  }

  if (input.action === "pause") {
    await getDb()
      .update(routines)
      .set({ enabled: false, nextRunAt: null, updatedAt: new Date() })
      .where(eq(routines.id, routine.id))
    await recordAudit(actor, "routine.paused_by_orchestrator", routine.name, {
      routineId: routine.id,
    })
    return { ok: true, id: routine.id, enabled: false }
  }

  const nextRun = getNextCronRun(routine.scheduleExpr, new Date(), routine.timezone)
  await getDb()
    .update(routines)
    .set({ enabled: true, nextRunAt: nextRun, updatedAt: new Date() })
    .where(eq(routines.id, routine.id))
  await recordAudit(actor, "routine.resumed_by_orchestrator", routine.name, {
    routineId: routine.id,
  })
  return { ok: true, id: routine.id, enabled: true, nextRunAt: nextRun?.toISOString() ?? null }
}
