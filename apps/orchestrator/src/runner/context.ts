import { debateRoleInstruction, parseCapabilities, type TurnRole } from "@sayabot/core"
import {
  agents,
  canvases,
  messages as messagesTable,
  profiles,
  roomAgents,
  rooms,
  taskComments,
  tasks,
} from "@sayabot/db"
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm"
import { getDb } from "../db"

export type RoomRow = typeof rooms.$inferSelect
export type AgentRow = typeof agents.$inferSelect
export type MessageRow = typeof messagesTable.$inferSelect
export type CanvasRow = typeof canvases.$inferSelect

export interface RoomAgentRow {
  agent: AgentRow
  position: number
}

export interface ContextMessage {
  id: string
  senderType: "human" | "agent" | "system"
  senderId: string | null
  senderName: string
  senderHandle: string | null
  content: string
  status: string
  createdAt: string
}

export async function loadRoomAgents(roomId: string): Promise<RoomAgentRow[]> {
  return getDb()
    .select({ agent: agents, position: roomAgents.position })
    .from(roomAgents)
    .innerJoin(agents, eq(agents.id, roomAgents.agentId))
    .where(eq(roomAgents.roomId, roomId))
    .orderBy(asc(roomAgents.position), asc(agents.handle))
}

export async function loadRoom(roomId: string): Promise<RoomRow | null> {
  const [room] = await getDb().select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  return room ?? null
}

export async function loadMessage(messageId: string): Promise<MessageRow | null> {
  const [message] = await getDb()
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.id, messageId))
    .limit(1)
  return message ?? null
}

async function resolveSenderNames(rows: MessageRow[]): Promise<{
  humans: Map<string, { displayName: string }>
  agentMap: Map<string, { displayName: string; handle: string }>
}> {
  const humanIds = rows
    .filter((m) => m.senderType === "human" && m.senderId)
    .map((m) => m.senderId as string)
  const agentIds = rows
    .filter((m) => m.senderType === "agent" && m.senderId)
    .map((m) => m.senderId as string)
  const db = getDb()
  const [humanRows, agentRows] = await Promise.all([
    humanIds.length
      ? db
          .select({ id: profiles.id, displayName: profiles.displayName })
          .from(profiles)
          .where(inArray(profiles.id, [...new Set(humanIds)]))
      : Promise.resolve([]),
    agentIds.length
      ? db
          .select({ id: agents.id, displayName: agents.displayName, handle: agents.handle })
          .from(agents)
          .where(inArray(agents.id, [...new Set(agentIds)]))
      : Promise.resolve([]),
  ])
  return {
    humans: new Map(humanRows.map((r) => [r.id, { displayName: r.displayName }])),
    agentMap: new Map(
      agentRows.map((r) => [r.id, { displayName: r.displayName, handle: r.handle }]),
    ),
  }
}

function toContextMessages(
  rows: MessageRow[],
  names: Awaited<ReturnType<typeof resolveSenderNames>>,
): ContextMessage[] {
  return rows.map((m) => {
    if (m.senderType === "system") {
      return {
        id: m.id,
        senderType: "system" as const,
        senderId: null,
        senderName: "System",
        senderHandle: null,
        content: m.content,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      }
    }
    if (m.senderType === "agent") {
      const agent = m.senderId ? names.agentMap.get(m.senderId) : undefined
      return {
        id: m.id,
        senderType: "agent" as const,
        senderId: m.senderId,
        senderName: agent?.displayName ?? "Agent",
        senderHandle: agent?.handle ?? null,
        content: m.content,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      }
    }
    const human = m.senderId ? names.humans.get(m.senderId) : undefined
    return {
      id: m.id,
      senderType: "human" as const,
      senderId: m.senderId,
      senderName: human?.displayName ?? "Human",
      senderHandle: null,
      content: m.content,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
    }
  })
}

/** Last N messages for a room feed, or the full root + replies for a thread. */
export async function loadConversation(args: {
  roomId: string
  threadRootId: string | null
  limit?: number
}): Promise<ContextMessage[]> {
  const db = getDb()
  const limit = args.limit ?? 40
  let rows: MessageRow[]
  if (args.threadRootId) {
    rows = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.roomId, args.roomId),
          or(
            eq(messagesTable.id, args.threadRootId),
            eq(messagesTable.threadRootId, args.threadRootId),
          ),
        ),
      )
      .orderBy(asc(messagesTable.createdAt))
      .limit(200)
    if (rows.length > limit) {
      const root = rows.find((r) => r.id === args.threadRootId)
      rows = [...(root ? [root] : []), ...rows.slice(-(limit - (root ? 1 : 0)))]
    }
  } else {
    const recent = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.roomId, args.roomId), isNull(messagesTable.threadRootId)))
      .orderBy(desc(messagesTable.createdAt))
      .limit(limit)
    rows = recent.reverse()
  }
  const names = await resolveSenderNames(rows)
  return toContextMessages(rows, names)
}

function label(message: ContextMessage): string {
  if (message.senderType === "system") return "System"
  if (message.senderType === "agent") {
    return message.senderHandle
      ? `${message.senderName} (@${message.senderHandle}) (agent)`
      : `${message.senderName} (agent)`
  }
  return `${message.senderName} (human)`
}

const MESSAGE_CHAR_LIMIT = 4_000
const TRANSCRIPT_CHAR_LIMIT = 60_000

export function renderTranscript(messages: ContextMessage[]): string {
  const lines = messages.map((m) => {
    const content =
      m.content.length > MESSAGE_CHAR_LIMIT ? `${m.content.slice(0, MESSAGE_CHAR_LIMIT)}…` : m.content
    const status = m.status === "streaming" ? " (still streaming)" : ""
    return `[${label(m)}]${status}: ${content}`
  })
  let text = lines.join("\n\n")
  while (text.length > TRANSCRIPT_CHAR_LIMIT && lines.length > 1) {
    lines.shift()
    text = lines.join("\n\n")
  }
  return text
}

export async function loadTaskContext(roomId: string): Promise<string> {
  const rows = await getDb()
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      kind: tasks.kind,
      assigneeHandle: agents.handle,
      assigneeUserId: tasks.assigneeUserId,
    })
    .from(tasks)
    .leftJoin(agents, eq(agents.id, tasks.assigneeAgentId))
    .where(and(eq(tasks.roomId, roomId), ne(tasks.status, "done")))
    .orderBy(desc(tasks.updatedAt))
    .limit(15)
  if (rows.length === 0) return ""
  return rows
    .map((task) => {
      const owner = task.assigneeHandle
        ? `held by @${task.assigneeHandle}`
        : task.assigneeUserId
          ? "held by a human"
          : task.kind === "task"
            ? "unclaimed"
            : "waiting for a human"
      return `MESH-${task.number} [${task.kind}] ${task.title} (${task.status}, ${owner}) id=${task.id}`
    })
    .join("\n")
}

export async function loadCanvasContext(roomId: string): Promise<string> {
  const rows = await getDb()
    .select({
      id: canvases.id,
      title: canvases.title,
      kind: canvases.kind,
      language: canvases.language,
      text: canvases.snapshotText,
    })
    .from(canvases)
    .where(eq(canvases.roomId, roomId))
    .orderBy(asc(canvases.createdAt))
  if (rows.length === 0) return ""
  const chunks: string[] = []
  let budget = 12_000
  for (const canvas of rows) {
    if (budget <= 0) break
    const text = canvas.text.slice(0, Math.min(6_000, budget))
    budget -= text.length
    chunks.push(
      `<canvas id="${canvas.id}" title="${canvas.title}" kind="${canvas.kind}"${canvas.language ? ` language="${canvas.language}"` : ""}>\n${text}\n</canvas>`,
    )
  }
  return chunks.join("\n\n")
}

export async function loadTaskBriefContext(taskId: string): Promise<string> {
  const db = getDb()
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  if (!task) return ""

  const parts = [
    `ACTIVE TASK BRIEF (Task #${task.number}: "${task.title}"):`,
    `- Status: ${task.status}`,
    `- Description: ${task.description || "(none)"}`,
  ]

  if (task.unblockNeeds) {
    parts.push(`- Blocker requirement: ${task.unblockNeeds} (${task.unblockDetail || "no detail"})`)
  }

  // Load parent or sibling tasks if hierarchical
  if (task.parentTaskId) {
    const [parent] = await db.select().from(tasks).where(eq(tasks.id, task.parentTaskId)).limit(1)
    if (parent) {
      parts.push(`- Parent task: #${parent.number} "${parent.title}" (${parent.status})`)
    }
    const siblings = await db
      .select({ number: tasks.number, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, task.parentTaskId), ne(tasks.id, task.id)))
      .limit(8)
    if (siblings.length) {
      parts.push(
        `- Sibling subtasks:\n${siblings.map((s) => `  * #${s.number} "${s.title}" (${s.status})`).join("\n")}`,
      )
    }
  }

  // Last 10 comments
  const comments = await db
    .select({
      authorType: taskComments.authorType,
      content: taskComments.content,
      createdAt: taskComments.createdAt,
    })
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
    .orderBy(desc(taskComments.createdAt))
    .limit(10)

  if (comments.length) {
    parts.push(
      `- Recent task activity:\n${comments
        .reverse()
        .map((c) => `  [${c.authorType}]: ${c.content}`)
        .join("\n")}`,
    )
  }

  parts.push(
    `- Rules: Work to complete this task. When finished, call update_task with status="done" and a valid outcome_kind (artifact, submission, external_change, or decision).`,
  )

  return parts.join("\n")
}

export function buildSystemPrompt(args: {
  room: RoomRow
  agent: AgentRow
  role: TurnRole
}): string {
  const caps = parseCapabilities(args.agent.capabilities)

  const parts = [
    `You are @${args.agent.handle} (${args.agent.displayName}), an autonomous teammate in the Sayabot room "#${args.room.name}".`,
    "The conversation below is a shared transcript. Each message is labelled with its sender and whether they are human or an agent.",
    "Reply as yourself only. Do not prefix your reply with your handle, and do not speak for anyone else.",
    "Use the provided tools when they help. To hand the conversation to another agent, mention them with @handle in your reply; do not mention agents just to be polite.",
    "Keep replies focused. Markdown is rendered, including code fences, tables, math and Mermaid diagrams.",
  ]

  if (caps.computer) {
    parts.push(
      `Your persistent computer environment:\n` +
        `- Files stored in /home/bot persist between your turns.\n` +
        `- Use computer_shell to run bash commands, inspect code, run tests, and manage files.\n` +
        `- Granted secrets appear in your environment as placeholders (e.g. $GITHUB_TOKEN="saaya_ph_..."). You can use them directly in commands (curl, git, SDKs); the Secret Broker automatically swaps real credentials in flight for allowlisted hosts.\n` +
        `- Egress network access is HTTPS only (no SSH, no raw TCP/UDP database connections).\n` +
        `- When you finish a major deliverable (document, design, script), publish it to the room using computer_publish.`,
    )
  }

  if (caps.cron) {
    parts.push(
      `Scheduled Routines & Automations (Hermes-compatible):\n` +
        `- You can create, list, pause, resume, or trigger autonomous routines and cron jobs using the cronjob tool.\n` +
        `- When a human asks to run something periodically (e.g. "every day at 9am", "every 2 hours", "weekly on Mondays"), schedule it using cronjob(action="create", ...).\n` +
        `- Routines execute automatically at their scheduled interval and post directly to the designated room.`,
    )
  }

  if (args.room.systemDirective?.trim()) {
    parts.push(`Room directive from the humans:\n${args.room.systemDirective.trim()}`)
  }
  if (args.agent.systemPrompt?.trim()) {
    parts.push(`Your instructions:\n${args.agent.systemPrompt.trim()}`)
  }
  const role = debateRoleInstruction(args.role)
  if (role) parts.push(role)
  return parts.join("\n\n")
}

export function buildUserPrompt(args: {
  transcript: string
  canvases: string
  tasks?: string
  agent: AgentRow
  extra?: string
}): string {
  const parts: string[] = []
  if (args.canvases) parts.push(`Shared canvases:\n${args.canvases}`)
  if (args.tasks) parts.push(`Open tasks in this room:\n${args.tasks}`)
  parts.push(`Conversation so far:\n${args.transcript || "(no messages yet)"}`)
  if (args.extra) parts.push(args.extra)
  parts.push(`Write your next message as @${args.agent.handle}.`)
  return parts.join("\n\n")
}

export function toWebhookContext(messages: ContextMessage[]): { sender: string; content: string }[] {
  return messages.slice(-20).map((m) => ({
    sender: label(m),
    content: m.content.slice(0, 4_000),
  }))
}

export function agentListPrompt(
  roomAgentRows: RoomAgentRow[],
): string {
  return roomAgentRows
    .map(({ agent }) => `- ${agent.id}: @${agent.handle} (${agent.displayName})`)
    .join("\n")
}
