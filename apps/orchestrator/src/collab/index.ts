import { computeFoldKey, extractHandles, redactSecrets, resolveMentions } from "@sayabot/core"
import {
  agentReads,
  agentRuns,
  agents,
  messages,
  orgMembers,
  profiles,
  roomAgents,
  rooms,
  taskComments,
  taskEvents,
  tasks,
  type OutcomeKind,
  type UnblockNeeds,
} from "@sayabot/db"
import { and, asc, desc, eq, gt, gte, inArray, isNull, ne, or, sql } from "drizzle-orm"
import { canUserReadRoom, isAgentInRoom } from "../authz"
import { notifyBotReply } from "../bot-reply"
import { getDb } from "../db"
import { notifyHumansNeeded } from "../push"
import { broadcast } from "../realtime"
import { loadConversation, loadRoomAgents, type ContextMessage } from "../runner/context"
import {
  applyTaskCreate,
  applyTaskMutation,
  applyTaskPlan,
  CollabError,
  type TaskPlanSubtask,
} from "./tasks-service"
import { notify } from "../db"

export { CollabError }

/**
 * Collaboration primitives shared by MCP-connected bots and built-in LLM agents:
 * posting, inbox/read cursors, atomic task claims, "stuck → ask a teammate",
 * human decisions with quick-reply options, and agent votes.
 */

export interface CollabAgent {
  agentId: string
  orgId: string
  handle: string
  roomIds?: string[] | null
  scopes?: string[]
}

/** Bot-to-bot chains started by agent posts are capped per room per 10 minutes. */
const AGENT_TRIGGER_LIMIT = 8
const AGENT_TRIGGER_WINDOW_MS = 10 * 60_000

type Enqueue = (roomId: string, messageId: string) => Promise<void>
let enqueueRoomMessage: Enqueue | null = null

/** Wired from index.ts once the job queue is up (avoids an import cycle). */
export function setCollabEnqueue(fn: Enqueue): void {
  enqueueRoomMessage = fn
}

// ── rooms ────────────────────────────────────────────────────────────────

export async function agentRooms(agent: CollabAgent) {
  const conditions = [eq(roomAgents.agentId, agent.agentId), eq(rooms.orgId, agent.orgId)]
  if (agent.roomIds && agent.roomIds.length > 0) {
    conditions.push(inArray(rooms.id, agent.roomIds))
  }
  return getDb()
    .select({ id: rooms.id, name: rooms.name, kind: rooms.kind, directive: rooms.systemDirective })
    .from(roomAgents)
    .innerJoin(rooms, eq(rooms.id, roomAgents.roomId))
    .where(and(...conditions))
    .orderBy(asc(rooms.name))
}

export async function assertAgentRoom(agent: CollabAgent, roomId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(roomId)) throw new CollabError("room not found")
  if (agent.roomIds && agent.roomIds.length > 0 && !agent.roomIds.includes(roomId)) {
    throw new CollabError("access denied: API token is not scoped to this room")
  }
  const [row] = await getDb()
    .select({ roomId: roomAgents.roomId })
    .from(roomAgents)
    .innerJoin(rooms, eq(rooms.id, roomAgents.roomId))
    .where(
      and(
        eq(roomAgents.roomId, roomId),
        eq(roomAgents.agentId, agent.agentId),
        eq(rooms.orgId, agent.orgId),
      ),
    )
    .limit(1)
  if (!row) throw new CollabError("you are not a member of this room")
}

export async function resolveAgentRoomId(
  agent: CollabAgent,
  roomIdOrName?: string | null,
): Promise<string> {
  const roomsList = await agentRooms(agent)
  if (roomIdOrName) {
    const trimmed = roomIdOrName.trim()
    const match = roomsList.find(
      (r) => r.id === trimmed || r.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (match) {
      if (agent.roomIds && agent.roomIds.length > 0 && !agent.roomIds.includes(match.id)) {
        throw new CollabError("access denied: API token is not scoped to this room")
      }
      return match.id
    }
    if (/^[0-9a-f-]{36}$/i.test(trimmed)) {
      await assertAgentRoom(agent, trimmed)
      return trimmed
    }
  }
  if (roomsList.length === 1 && roomsList[0]) {
    return roomsList[0].id
  }
  if (roomsList.length === 0) {
    throw new CollabError("You have not been added to any rooms yet. Ask the room owner to add you in Room Settings.")
  }
  throw new CollabError(
    `Please specify room_id: you belong to multiple rooms (${roomsList.map((r) => `${r.name}: ${r.id}`).join(", ")})`,
  )
}

async function markRead(agentId: string, roomId: string, at = new Date()): Promise<void> {
  await getDb()
    .insert(agentReads)
    .values({ agentId, roomId, lastReadAt: at, updatedAt: at })
    .onConflictDoUpdate({
      target: [agentReads.agentId, agentReads.roomId],
      set: { lastReadAt: at, updatedAt: at },
    })
}

async function readCursors(agentId: string): Promise<Map<string, Date>> {
  const rows = await getDb()
    .select({ roomId: agentReads.roomId, lastReadAt: agentReads.lastReadAt })
    .from(agentReads)
    .where(eq(agentReads.agentId, agentId))
  return new Map(rows.map((r) => [r.roomId, r.lastReadAt]))
}

function compact(m: ContextMessage) {
  return {
    id: m.id,
    from:
      m.senderType === "agent"
        ? `@${m.senderHandle ?? "agent"}`
        : m.senderType === "system"
          ? "system"
          : m.senderName,
    sender_type: m.senderType,
    content: m.content,
    status: m.status,
    at: m.createdAt,
  }
}

export async function getRoomMessages(
  agent: CollabAgent,
  args: { roomId?: string; room?: string; threadId?: string | null; limit?: number; markAsRead?: boolean },
) {
  const roomId = await resolveAgentRoomId(agent, args.roomId || args.room)
  const conversation = await loadConversation({
    roomId,
    threadRootId: args.threadId ?? null,
    limit: Math.min(Math.max(args.limit ?? 30, 1), 100),
  })
  if (args.markAsRead !== false) await markRead(agent.agentId, roomId)
  return conversation.map(compact)
}

/**
 * Everything that needs this agent's attention since it last looked: messages that
 * mention it (or @all_bots), bot DMs to it, its open tasks, and answered requests.
 */
export async function getInbox(agent: CollabAgent, args: { markAsRead?: boolean } = {}) {
  const db = getDb()
  const roomList = await agentRooms(agent)
  if (roomList.length === 0) return { rooms: [], mentions: [], tasks: [], answered_requests: [] }
  const roomIds = roomList.map((r) => r.id)
  const cursors = await readCursors(agent.agentId)
  const oldest = new Date(Date.now() - 7 * 86_400_000)
  const handle = agent.handle.toLowerCase()

  const candidates = await db
    .select({
      id: messages.id,
      roomId: messages.roomId,
      threadRootId: messages.threadRootId,
      senderType: messages.senderType,
      senderId: messages.senderId,
      content: messages.content,
      metadata: messages.metadata,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        inArray(messages.roomId, roomIds),
        gte(messages.createdAt, oldest),
        ne(messages.status, "streaming"),
        or(
          sql`${messages.mentions} && array[${handle}, 'all_bots']::text[]`,
          sql`${messages.metadata}->>'dmToAgentId' = ${agent.agentId}`,
        ),
        or(isNull(messages.senderId), ne(messages.senderId, agent.agentId)),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(200)

  const unread = candidates.filter((m) => {
    const cursor = cursors.get(m.roomId)
    return !cursor || m.createdAt > cursor
  })

  const senderAgentIds = [
    ...new Set(unread.filter((m) => m.senderType === "agent" && m.senderId).map((m) => m.senderId!)),
  ]
  const senderAgents = senderAgentIds.length
    ? await db
        .select({ id: agents.id, handle: agents.handle })
        .from(agents)
        .where(inArray(agents.id, senderAgentIds))
    : []
  const handles = new Map(senderAgents.map((a) => [a.id, a.handle]))
  const roomNames = new Map(roomList.map((r) => [r.id, r.name]))

  const myTasks = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      roomId: tasks.roomId,
      title: tasks.title,
      status: tasks.status,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(
      and(
        inArray(tasks.roomId, roomIds),
        eq(tasks.kind, "task"),
        ne(tasks.status, "done"),
        or(eq(tasks.assigneeAgentId, agent.agentId), isNull(tasks.assigneeAgentId)),
        isNull(tasks.assigneeUserId),
      ),
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(30)

  const answered = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      roomId: tasks.roomId,
      title: tasks.title,
      metadata: tasks.metadata,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.requestedByAgentId, agent.agentId),
        eq(tasks.kind, "request"),
        eq(tasks.status, "done"),
        gt(tasks.updatedAt, new Date(Date.now() - 2 * 86_400_000)),
      ),
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(10)

  if (args.markAsRead !== false) {
    const now = new Date()
    await Promise.all(roomIds.map((id) => markRead(agent.agentId, id, now)))
  }

  return {
    rooms: roomList.map((r) => ({ id: r.id, name: r.name })),
    mentions: unread.map((m) => ({
      id: m.id,
      room_id: m.roomId,
      room: roomNames.get(m.roomId) ?? "",
      thread_id: m.threadRootId,
      from:
        m.senderType === "agent"
          ? `@${handles.get(m.senderId ?? "") ?? "agent"}`
          : m.senderType === "system"
            ? "system"
            : "human",
      direct_message: m.metadata?.dmToAgentId === agent.agentId,
      content: m.content.slice(0, 4_000),
      at: m.createdAt.toISOString(),
    })),
    tasks: myTasks.map((t) => ({
      id: t.id,
      ref: `MESH-${t.number}`,
      room_id: t.roomId,
      title: t.title,
      status: t.status,
      claimable: true,
    })),
    answered_requests: answered.map((r) => ({
      id: r.id,
      ref: `MESH-${r.number}`,
      room_id: r.roomId,
      question: r.title,
      answer: typeof r.metadata.answer === "string" ? r.metadata.answer : null,
      answered_at: typeof r.metadata.answeredAt === "string" ? r.metadata.answeredAt : null,
    })),
  }
}

// ── posting ──────────────────────────────────────────────────────────────

async function agentIsTakingTurn(agentId: string, roomId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.agentId, agentId),
        eq(agentRuns.roomId, roomId),
        eq(agentRuns.status, "running"),
        gte(agentRuns.createdAt, new Date(Date.now() - 5 * 60_000)),
      ),
    )
    .limit(1)
  return Boolean(row)
}

async function recentAgentTriggers(roomId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.roomId, roomId),
        gte(messages.createdAt, new Date(Date.now() - AGENT_TRIGGER_WINDOW_MS)),
        sql`${messages.metadata}->>'agentTrigger' = 'true'`,
      ),
    )
  return row?.count ?? 0
}

/**
 * Posts as an agent outside a coordinator turn. When the message mentions other
 * agents in the room, it starts a bot-to-bot turn session for them, bounded by
 * the room's breakers and a per-room chain limit.
 */
export async function postAgentMessage(
  agent: CollabAgent,
  args: {
    roomId?: string
    room?: string
    content: string
    threadRootId?: string | null
    metadata?: Record<string, unknown>
  },
) {
  const roomId = await resolveAgentRoomId(agent, args.roomId || args.room)
  const content = redactSecrets(args.content).text.trim()
  if (!content) throw new CollabError("message is empty")
  if (content.length > 32_000) throw new CollabError("message is too long (32k characters max)")

  const mentions = extractHandles(content)
  const roomAgentRows = await loadRoomAgents(roomId)
  const targets = resolveMentions(
    content,
    roomAgentRows.map(({ agent: a }) => ({ id: a.id, handle: a.handle, kind: a.kind })),
  ).filter((a) => a.id !== agent.agentId)

  const inTurn = await agentIsTakingTurn(agent.agentId, roomId)
  let trigger = !inTurn && targets.length > 0
  let throttled = false
  if (trigger && (await recentAgentTriggers(roomId)) >= AGENT_TRIGGER_LIMIT) {
    trigger = false
    throttled = true
  }

  const [row] = await getDb()
    .insert(messages)
    .values({
      roomId,
      threadRootId: args.threadRootId ?? null,
      senderType: "agent",
      senderId: agent.agentId,
      content,
      status: "complete",
      mentions,
      metadata: {
        external: true,
        agentHandle: agent.handle,
        ...(args.metadata ?? {}),
        ...(trigger ? { agentTrigger: true } : {}),
      },
    })
    .returning({ id: messages.id, createdAt: messages.createdAt })
  if (!row) throw new CollabError("failed to store message")

  await notifyBotReply({
    roomId,
    agentId: agent.agentId,
    threadRootId: args.threadRootId ?? null,
    messageId: row.id,
  })
  await broadcast(roomId, { type: "message.done", messageId: row.id, status: "complete" })
  await markRead(agent.agentId, roomId, row.createdAt)

  // Notify active long-poll waiters (mesh_agent_inbox)
  for (const target of targets) {
    void notify("mesh_agent_inbox", { agentId: target.id, roomId, kind: "mention" })
  }
  if (content.includes("@all_bots")) {
    for (const r of roomAgentRows) {
      if (r.agent.id !== agent.agentId) {
        void notify("mesh_agent_inbox", { agentId: r.agent.id, roomId, kind: "mention" })
      }
    }
  }

  if (trigger && enqueueRoomMessage) await enqueueRoomMessage(roomId, row.id)

  return {
    message_id: row.id,
    woke: trigger ? targets.map((t) => `@${t.handle}`) : [],
    ...(throttled
      ? {
          note: "Too many bot-to-bot chains in this room in the last 10 minutes; mentioned agents will see this in their inbox but were not woken.",
        }
      : {}),
  }
}

/** A direct message to one teammate bot. Humans in the room can always read it. */
export async function sendBotDirectMessage(
  agent: CollabAgent,
  args: { roomId?: string; room?: string; toHandle: string; content: string },
) {
  const roomId = await resolveAgentRoomId(agent, args.roomId || args.room)
  const handle = args.toHandle.replace(/^@/, "").toLowerCase()
  const roomAgentRows = await loadRoomAgents(roomId)
  const target = roomAgentRows.find(({ agent: a }) => a.handle.toLowerCase() === handle)?.agent
  if (!target) throw new CollabError(`@${handle} is not in this room`)
  if (target.id === agent.agentId) throw new CollabError("you cannot message yourself")
  const body = args.content.trim()
  const content = new RegExp(`(^|\\s)@${handle}\\b`, "i").test(body) ? body : `@${handle} ${body}`
  return postAgentMessage(agent, {
    roomId,
    content,
    metadata: { dmToAgentId: target.id, dmToHandle: target.handle, botDm: true },
  })
}

// ── tasks ────────────────────────────────────────────────────────────────

async function loadTaskInOrg(agent: CollabAgent, taskId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new CollabError("task not found")
  const [task] = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.orgId, agent.orgId)))
    .limit(1)
  if (!task) throw new CollabError("task not found")
  await assertAgentRoom(agent, task.roomId)
  return task
}

export async function listTasks(
  agent: CollabAgent,
  args: { roomId?: string; room?: string; status?: "open" | "in_progress" | "stuck" | "done"; mine?: boolean },
) {
  const roomId = await resolveAgentRoomId(agent, args.roomId || args.room)
  const conditions = [eq(tasks.roomId, roomId)]
  if (args.status) conditions.push(eq(tasks.status, args.status))
  if (args.mine) conditions.push(eq(tasks.assigneeAgentId, agent.agentId))
  const rows = await getDb()
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.updatedAt))
    .limit(40)
  return rows.map((t) => ({
    id: t.id,
    ref: `MESH-${t.number}`,
    kind: t.kind,
    title: t.title,
    description: t.description.slice(0, 1_000),
    status: t.status,
    assigned_to_me: t.assigneeAgentId === agent.agentId,
    assigned: Boolean(t.assigneeAgentId || t.assigneeUserId),
    updated_at: t.updatedAt.toISOString(),
  }))
}

export async function createTask(
  agent: CollabAgent,
  args: { roomId?: string; room?: string; title: string; description?: string; assignToMe?: boolean },
) {
  const roomId = await resolveAgentRoomId(agent, args.roomId || args.room)
  const isAssigned = args.assignToMe !== false
  const res = await applyTaskCreate({
    orgId: agent.orgId,
    roomId,
    title: args.title.slice(0, 120),
    description: (args.description ?? "").slice(0, 4_000),
    kind: "task",
    status: isAssigned ? "in_progress" : "open",
    assigneeAgentId: isAssigned ? agent.agentId : null,
    metadata: { source: "agent", createdByAgent: agent.agentId },
    actor: { type: "agent", id: agent.agentId },
  })
  return { id: res.task.id, ref: `MESH-${res.task.number}`, title: res.task.title, status: res.task.status }
}

/**
 * Claims a task only when nobody else holds it. Two bots racing for the same
 * task get one winner; the loser is told who has it.
 */
export async function claimTask(agent: CollabAgent, args: { taskId: string }) {
  const task = await loadTaskInOrg(agent, args.taskId)
  if (task.kind !== "task") throw new CollabError("requests cannot be claimed")
  const db = getDb()
  const now = new Date()

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .update(tasks)
      .set({ assigneeAgentId: agent.agentId, status: "in_progress", updatedAt: now })
      .where(
        and(
          eq(tasks.id, task.id),
          ne(tasks.status, "done"),
          isNull(tasks.assigneeUserId),
          or(isNull(tasks.assigneeAgentId), eq(tasks.assigneeAgentId, agent.agentId)),
        ),
      )
      .returning({ id: tasks.id, number: tasks.number, title: tasks.title })

    if (!row) {
      let holder = "a human"
      if (task.assigneeAgentId) {
        const [other] = await tx
          .select({ handle: agents.handle })
          .from(agents)
          .where(eq(agents.id, task.assigneeAgentId))
          .limit(1)
        holder = other ? `@${other.handle}` : "another agent"
      }
      return {
        claimed: false,
        reason: task.status === "done" ? "task is already done" : `already claimed by ${holder}`,
      }
    }

    await tx.insert(taskEvents).values({
      taskId: task.id,
      actorType: "agent",
      actorId: agent.agentId,
      fromStatus: task.status,
      toStatus: "in_progress",
      reason: "claimed",
      metadata: { claimedBy: agent.agentId },
      createdAt: now,
    })

    await tx.insert(taskComments).values({
      taskId: task.id,
      authorType: "agent",
      authorId: agent.agentId,
      content: `@${agent.handle} claimed this task.`,
      createdAt: now,
    })

    return { claimed: true, id: row.id, ref: `MESH-${row.number}`, title: row.title }
  })
}

export async function planTask(
  agent: CollabAgent,
  args: {
    taskId: string
    subtasks: TaskPlanSubtask[]
  },
) {
  const task = await loadTaskInOrg(agent, args.taskId)
  return applyTaskPlan({
    parentTaskId: task.id,
    actor: { type: "agent", id: agent.agentId },
    subtasks: args.subtasks,
  })
}

export async function assignTask(
  agent: CollabAgent,
  args: {
    taskId: string
    assignee: string
  },
) {
  const task = await loadTaskInOrg(agent, args.taskId)
  const cleanAssignee = args.assignee.trim()
  let assigneeAgentId: string | null = null
  let assigneeUserId: string | null = null

  if (cleanAssignee.startsWith("human:")) {
    const humanName = cleanAssignee.slice(6).trim()
    // Display names are not unique, so only people who can read this room are candidates.
    const namesakes = await getDb()
      .select({ id: profiles.id })
      .from(profiles)
      .innerJoin(orgMembers, eq(orgMembers.userId, profiles.id))
      .where(and(eq(orgMembers.orgId, agent.orgId), eq(profiles.displayName, humanName)))
      .limit(10)
    const eligible: string[] = []
    for (const person of namesakes) {
      if (await canUserReadRoom(person.id, task.roomId)) eligible.push(person.id)
    }
    if (eligible.length === 0) throw new CollabError(`human user "${humanName}" is not in this room`)
    if (eligible.length > 1) {
      throw new CollabError(`more than one person in this room is named "${humanName}"; ask the room owner who should take it`)
    }
    assigneeUserId = eligible[0]!
  } else {
    const handle = cleanAssignee.replace(/^@/, "").trim()
    const [targetAgent] = await getDb()
      .select({ id: agents.id, handle: agents.handle })
      .from(agents)
      .where(and(eq(agents.orgId, agent.orgId), eq(agents.handle, handle)))
      .limit(1)
    if (!targetAgent) throw new CollabError(`agent "@${handle}" not found`)
    if (!(await isAgentInRoom(targetAgent.id, task.roomId))) {
      throw new CollabError(`agent "@${handle}" is not in this room`)
    }
    assigneeAgentId = targetAgent.id
  }

  const res = await applyTaskMutation({
    taskId: task.id,
    actor: { type: "agent", id: agent.agentId },
    assigneeAgentId,
    assigneeUserId,
    status: "in_progress",
    reason: `assigned to ${cleanAssignee} by @${agent.handle}`,
  })

  return {
    id: res.task.id,
    ref: `MESH-${res.task.number}`,
    title: res.task.title,
    assignee: cleanAssignee,
    status: res.task.status,
  }
}

/**
 * Updates a task the agent holds. Marking it stuck posts a help request in the
 * room that wakes the chosen teammate (or every other bot) to unstick it.
 * All mutations enforce task integrity invariants via applyTaskMutation.
 */
export async function updateTask(
  agent: CollabAgent,
  args: {
    taskId: string
    status?: "open" | "in_progress" | "stuck" | "done"
    note?: string
    askHelpFrom?: string
    release?: boolean
    dueAt?: string | null
    unblockNeeds?: UnblockNeeds | null
    unblockDetail?: string | null
    formRef?: string | null
    blockedBy?: string[] | null
    outcome?: {
      kind: OutcomeKind
      ref?: string | null
    } | null
    reason?: string | null
    metadata?: Record<string, unknown>
  },
) {
  const task = await loadTaskInOrg(agent, args.taskId)
  if (task.kind !== "task") throw new CollabError("use the Inbox flow for requests")
  // Helping a stuck teammate is allowed; overwriting someone's active task is not.
  if (task.assigneeAgentId && task.assigneeAgentId !== agent.agentId && task.status !== "stuck") {
    throw new CollabError("this task belongs to another agent; claim it first")
  }

  let assigneeAgentId: string | null | undefined = undefined
  let targetStatus = args.status
  if (args.release) {
    assigneeAgentId = null
    if (!targetStatus) targetStatus = "open"
  }

  const { task: row, event } = await applyTaskMutation({
    taskId: task.id,
    actor: { type: "agent", id: agent.agentId },
    status: targetStatus,
    assigneeAgentId,
    dueAt: args.dueAt,
    unblockNeeds: args.unblockNeeds,
    unblockDetail: args.unblockDetail,
    blockedBy: args.blockedBy,
    outcome: args.outcome,
    reason: args.reason,
    note: args.note,
    metadata: {
      ...(args.formRef ? { formRef: args.formRef } : {}),
      ...(args.metadata ?? {}),
    },
  })

  let helpMessage: Awaited<ReturnType<typeof postAgentMessage>> | null = null
  if (args.status === "stuck") {
    const helper = args.askHelpFrom?.replace(/^@/, "").toLowerCase()
    const who = helper ? `@${helper}` : "@all_bots"
    const note = args.note?.trim()
    helpMessage = await postAgentMessage(agent, {
      roomId: task.roomId,
      content: `${who} I'm stuck on **MESH-${row.number}: ${row.title}** (${args.unblockNeeds || "needs help"}).${note ? `\n\n${note}` : ""}\n\nCan you take a look or suggest a way forward?`,
      metadata: { taskId: task.id, stuckHelp: true, unblockNeeds: args.unblockNeeds },
    }).catch(() => null)
    notifyHumansNeeded({
      roomId: task.roomId,
      agentId: agent.agentId,
      kind: "request",
      detail: `Stuck on MESH-${row.number}: ${row.title}`,
    })
  }
  return {
    id: row.id,
    ref: `MESH-${row.number}`,
    status: row.status,
    eventId: event?.id,
    ...(helpMessage ? { asked_for_help: helpMessage.woke } : {}),
  }
}

// ── human decisions ─────────────────────────────────────────────────────

export async function requestHumanDecision(
  agent: CollabAgent,
  args: {
    roomId?: string
    room?: string
    taskId?: string
    question: string
    details?: string
    options?: string[]
    foldKey?: string
  },
) {
  const roomId = await resolveAgentRoomId(agent, args.roomId || args.room)
  const options = [...new Set((args.options ?? []).map((o) => o.trim()).filter(Boolean))].slice(0, 6)
  const effectiveFoldKey = computeFoldKey(args.question, args.foldKey)

  // Validate linked task if provided: asks for already completed tasks are rejected as moot
  if (args.taskId) {
    const [targetTask] = await getDb()
      .select({ id: tasks.id, status: tasks.status, number: tasks.number })
      .from(tasks)
      .where(and(eq(tasks.id, args.taskId), eq(tasks.roomId, roomId)))
      .limit(1)

    if (!targetTask) throw new CollabError("task not found in this room")
    if (targetTask.status === "done") {
      throw new CollabError(
        `cannot request decision on MESH-${targetTask.number}: task is already done; this ask is moot`,
      )
    }
  }

  // Deduplicate against still-open requests in the same room with same foldKey
  const [existing] = await getDb()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.roomId, roomId),
        eq(tasks.kind, "request"),
        eq(tasks.status, "open"),
        eq(tasks.foldKey, effectiveFoldKey),
      ),
    )
    .limit(1)

  if (existing) {
    const nextCount = (existing.askedCount || 1) + 1
    await getDb()
      .update(tasks)
      .set({ askedCount: nextCount, updatedAt: new Date() })
      .where(eq(tasks.id, existing.id))

    await getDb().insert(taskEvents).values({
      taskId: existing.id,
      actorType: "agent",
      actorId: agent.agentId,
      fromStatus: "open",
      toStatus: "open",
      reason: "repeated ask folded into existing request",
      metadata: { askedCount: nextCount, repeatedQuestion: args.question },
    })

    return {
      request_id: existing.id,
      ref: `MESH-${existing.number}`,
      status: "waiting_for_human",
      folded: true,
      asked_count: nextCount,
      next: "Repeated ask folded into existing open question. The answer arrives as a message mentioning you, and get_request_status returns it.",
    }
  }

  const [row] = await getDb()
    .insert(tasks)
    .values({
      orgId: agent.orgId,
      roomId,
      kind: "request",
      title: args.question.slice(0, 120),
      description: (args.details ?? "").slice(0, 4_000),
      status: "open",
      requestedByAgentId: agent.agentId,
      foldKey: effectiveFoldKey,
      askedCount: 1,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      metadata: {
        source: "agent",
        createdByAgent: agent.agentId,
        options,
        ...(args.taskId ? { taskId: args.taskId } : {}),
      },
    })
    .returning({ id: tasks.id, number: tasks.number })

  if (!row) throw new CollabError("could not create the request")

  await getDb().insert(taskEvents).values({
    taskId: row.id,
    actorType: "agent",
    actorId: agent.agentId,
    fromStatus: null,
    toStatus: "open",
    reason: "human decision requested",
    metadata: {
      foldKey: effectiveFoldKey,
      options,
      ...(args.taskId ? { taskId: args.taskId } : {}),
    },
  })

  notifyHumansNeeded({ roomId, agentId: agent.agentId, kind: "request", detail: args.question })
  return {
    request_id: row.id,
    ref: `MESH-${row.number}`,
    status: "waiting_for_human",
    folded: false,
    asked_count: 1,
    next: "Keep working on anything that does not depend on this. The answer arrives as a message mentioning you, and get_request_status returns it.",
  }
}

export async function getRequestStatus(agent: CollabAgent, args: { requestId: string }) {
  const task = await loadTaskInOrg(agent, args.requestId)
  if (task.kind !== "request") throw new CollabError("not a request")
  return {
    request_id: task.id,
    ref: `MESH-${task.number}`,
    question: task.title,
    status: task.status === "done" ? "answered" : "waiting_for_human",
    answer: typeof task.metadata.answer === "string" ? task.metadata.answer : null,
    answered_at: typeof task.metadata.answeredAt === "string" ? task.metadata.answeredAt : null,
  }
}

// ── votes ───────────────────────────────────────────────────────────────

export interface VoteState {
  question: string
  options: string[]
  ballots: Record<string, { option: string; reason: string; handle: string; at: string }>
  closed: boolean
}

function tally(vote: VoteState) {
  const counts = Object.fromEntries(vote.options.map((o) => [o, 0])) as Record<string, number>
  for (const ballot of Object.values(vote.ballots)) counts[ballot.option] = (counts[ballot.option] ?? 0) + 1
  const max = Math.max(0, ...Object.values(counts))
  const leaders = max > 0 ? Object.keys(counts).filter((o) => counts[o] === max) : []
  return { counts, leading: leaders.length === 1 ? leaders[0] : null, tied: leaders.length > 1 ? leaders : [] }
}

export async function startVote(
  agent: CollabAgent,
  args: { roomId: string; question: string; options: string[]; wake?: boolean },
) {
  const options = [...new Set(args.options.map((o) => o.trim()).filter(Boolean))].slice(0, 8)
  if (options.length < 2) throw new CollabError("a vote needs at least two options")
  const vote: VoteState = { question: args.question.slice(0, 300), options, ballots: {}, closed: false }
  const list = options.map((o, i) => `${i + 1}. ${o}`).join("\n")
  const result = await postAgentMessage(agent, {
    roomId: args.roomId,
    content: `${args.wake === false ? "" : "@all_bots "}**Vote:** ${vote.question}\n\n${list}\n\nCast your vote with \`cast_vote\`.`,
    metadata: { vote },
  })
  return { vote_id: result.message_id, options, woke: result.woke }
}

export async function castVote(
  agent: CollabAgent,
  args: { voteId: string; option: string; reason?: string },
) {
  if (!/^[0-9a-f-]{36}$/i.test(args.voteId)) throw new CollabError("vote not found")
  const [row] = await getDb()
    .select({ id: messages.id, roomId: messages.roomId, metadata: messages.metadata })
    .from(messages)
    .where(eq(messages.id, args.voteId))
    .limit(1)
  const vote = row?.metadata?.vote as VoteState | undefined
  if (!row || !vote) throw new CollabError("vote not found")
  await assertAgentRoom(agent, row.roomId)
  if (vote.closed) throw new CollabError("this vote is closed")
  const wanted = args.option.trim().toLowerCase()
  const byIndex = /^\d+$/.test(wanted) ? vote.options[Number(wanted) - 1] : undefined
  const option = byIndex ?? vote.options.find((o) => o.toLowerCase() === wanted)
  if (!option) throw new CollabError(`unknown option; choose one of: ${vote.options.join(" | ")}`)
  const ballot = {
    option,
    reason: (args.reason ?? "").slice(0, 500),
    handle: agent.handle,
    at: new Date().toISOString(),
  }
  // jsonb_set keeps concurrent ballots from different agents from overwriting each other.
  const [updated] = await getDb()
    .update(messages)
    .set({
      metadata: sql`jsonb_set(${messages.metadata}, array['vote','ballots',${agent.agentId}]::text[], ${JSON.stringify(ballot)}::jsonb, true)`,
      updatedAt: new Date(),
    })
    .where(eq(messages.id, row.id))
    .returning({ metadata: messages.metadata })
  await broadcast(row.roomId, { type: "message.done", messageId: row.id, status: "complete" })
  const state = (updated?.metadata?.vote as VoteState | undefined) ?? vote
  return { vote_id: row.id, your_vote: option, ...tally(state), voters: Object.keys(state.ballots).length }
}

export async function getVote(agent: CollabAgent, args: { voteId: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(args.voteId)) throw new CollabError("vote not found")
  const [row] = await getDb()
    .select({ roomId: messages.roomId, metadata: messages.metadata })
    .from(messages)
    .where(eq(messages.id, args.voteId))
    .limit(1)
  const vote = row?.metadata?.vote as VoteState | undefined
  if (!row || !vote) throw new CollabError("vote not found")
  await assertAgentRoom(agent, row.roomId)
  return {
    question: vote.question,
    options: vote.options,
    ballots: Object.values(vote.ballots).map((b) => ({ by: `@${b.handle}`, option: b.option, reason: b.reason })),
    ...tally(vote),
  }
}

// ── check in & agent profile ──────────────────────────────────────────────

export async function checkIn(
  agent: CollabAgent,
  args: { roomId?: string | null; room?: string | null } = {},
) {
  const db = getDb()
  const agentRoomList = await agentRooms(agent)
  let activeRoomId: string | null = null
  let activeRoom: (typeof agentRoomList)[number] | null = null
  let roomOwnerName = "Room Owner"

  if (agentRoomList.length > 0) {
    try {
      activeRoomId = await resolveAgentRoomId(agent, args.roomId || args.room)
      activeRoom = agentRoomList.find((r) => r.id === activeRoomId) || agentRoomList[0] || null
    } catch {
      activeRoom = agentRoomList[0] || null
      activeRoomId = activeRoom ? activeRoom.id : null
    }
  }

  let teammates: Array<{ handle: string; name: string; role: string }> = []
  let roomMessages: unknown[] = []
  let openTasks: unknown[] = []

  if (activeRoomId) {
    const [roomDetails] = await db
      .select({
        name: rooms.name,
        timezone: rooms.timezone,
        directive: rooms.systemDirective,
        createdBy: rooms.createdBy,
      })
      .from(rooms)
      .where(eq(rooms.id, activeRoomId))
      .limit(1)

    if (roomDetails?.createdBy) {
      const [owner] = await db
        .select({ displayName: profiles.displayName })
        .from(profiles)
        .where(eq(profiles.id, roomDetails.createdBy))
        .limit(1)
      if (owner?.displayName) roomOwnerName = owner.displayName
    }

    const roomAgentRows = await loadRoomAgents(activeRoomId)
    teammates = roomAgentRows.map(({ agent: a }) => ({
      handle: `@${a.handle}`,
      name: a.displayName,
      role: a.id === agent.agentId ? "you" : "bot",
    }))

    roomMessages = await getRoomMessages(agent, {
      roomId: activeRoomId,
      limit: 15,
      markAsRead: true,
    })

    openTasks = await listTasks(agent, { roomId: activeRoomId })
  }

  const inbox = await getInbox(agent, { markAsRead: true })

  return {
    identity: {
      handle: `@${agent.handle}`,
      role: "bot",
      room_owner: roomOwnerName,
    },
    current_room: activeRoom
      ? {
          id: activeRoom.id,
          name: activeRoom.name,
          directive: activeRoom.directive || "Collaborate on tasks and coordinate with the team.",
        }
      : null,
    teammates,
    unhandled_mentions: inbox.mentions,
    tasks_assigned_or_available: openTasks,
    answered_requests: inbox.answered_requests,
    recent_messages: roomMessages,
    house_rules: [
      "1. Check in whenever you begin work in the room, and use report_checkin to report state changes (or no_change) rather than filler messages.",
      "2. Read recent messages before posting to understand context.",
      "3. Claim tasks with claim_task before starting work so teammates do not duplicate effort.",
      "4. Update task progress with update_task (done requires an outcome with artifact/ref; stuck requires unblock_needs).",
      "5. Always ask the room owner with request_human_decision before touching host files, spending money, or performing high-stakes actions outside Saaya.",
      "6. Post updates and talk openly with teammate bots and the room owner.",
    ],
  }
}

export async function updateAgentProfile(
  agent: CollabAgent,
  args: { goodAt?: string; name?: string },
) {
  const db = getDb()
  const updates: Record<string, unknown> = {}
  if (args.name && args.name.trim()) {
    updates.displayName = args.name.trim().slice(0, 80)
  }
  if (args.goodAt !== undefined) {
    const [current] = await db
      .select({ params: agents.params })
      .from(agents)
      .where(eq(agents.id, agent.agentId))
      .limit(1)
    const existingParams = (current?.params as Record<string, unknown>) || {}
    updates.params = { ...existingParams, goodAt: args.goodAt.trim().slice(0, 300) }
  }
  if (Object.keys(updates).length > 0) {
    await db.update(agents).set(updates).where(eq(agents.id, agent.agentId))
  }
  return { updated: true, handle: `@${agent.handle}` }
}
