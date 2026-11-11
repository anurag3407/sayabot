import {
  checkPreTurnBreakers,
  detectRepetition,
  extractHandles,
  planBotFollowUps,
  planDebateTurns,
  planMentionsTurn,
  planModeratedMentions,
  redactSecrets,
  REPETITION_HALT_MESSAGE,
  validateModeratorChoice,
  HUMAN_TURN,
  type PlannedTurn,
  type WebhookPayload,
} from "@sayabot/core"
import {
  agentRuns,
  agents,
  messages,
  tasks,
  turnSessions,
  usageEvents,
} from "@sayabot/db"
import { generateObject } from "ai"
import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm"
import { z } from "zod"
import { recordUsageEvent, tokensFrom } from "../usage"
import { getDb, withRoomLock } from "../db"
import type { WebhookJobData } from "../jobs/webhook"
import { broadcast } from "../realtime"
import { runExternalTurn } from "../runner/external"
import {
  agentListPrompt,
  buildSystemPrompt,
  loadConversation,
  loadMessage,
  loadRoom,
  loadRoomAgents,
  renderTranscript,
  toWebhookContext,
  type AgentRow,
  type MessageRow,
  type RoomAgentRow,
  type RoomRow,
} from "../runner/context"
import { startAgentTurn } from "../engine"
import { resolveAgentModel } from "../runner/llm"
import { interruptRoom } from "./interrupt"

export interface CoordinatorDeps {
  enqueueWebhook: (data: WebhookJobData) => Promise<void>
}

async function setSession(
  sessionId: string,
  values: { botTurnsUsed?: number; queue?: PlannedTurn[]; state?: "active" | "complete" | "halted" | "superseded" },
) {
  await getDb()
    .update(turnSessions)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(turnSessions.id, sessionId))
}

async function getSessionState(
  sessionId: string,
): Promise<"active" | "complete" | "halted" | "superseded" | null> {
  const [row] = await getDb()
    .select({ state: turnSessions.state })
    .from(turnSessions)
    .where(eq(turnSessions.id, sessionId))
    .limit(1)
  return row?.state ?? null
}

async function broadcastTurn(
  sessionId: string,
  roomId: string,
  threadRootId: string | null,
  activeAgentId: string | null,
  queue: PlannedTurn[],
) {
  await broadcast(roomId, {
    type: "turn.state",
    sessionId,
    activeAgentId,
    queue: queue.map((t) => t.agentId),
    threadRootId,
  })
}

async function postSystemMessage(args: {
  roomId: string
  threadRootId: string | null
  content: string
  reason: string
}) {
  const content = redactSecrets(args.content).text
  const [row] = await getDb()
    .insert(messages)
    .values({
      roomId: args.roomId,
      threadRootId: args.threadRootId,
      senderType: "system",
      senderId: null,
      content,
      status: "halted",
      metadata: { reason: args.reason },
    })
    .returning({ id: messages.id })
  if (row) {
    await broadcast(args.roomId, { type: "message.done", messageId: row.id, status: "halted" })
  }
}

/** A bot went quiet: tell the room so the owner can poke it with one click. */
async function postQuietBotNotice(args: {
  roomId: string
  threadRootId: string | null
  agent: AgentRow
}) {
  const content = `@${args.agent.handle} didn't answer within 60 seconds, so the turn moved on.`
  const [row] = await getDb()
    .insert(messages)
    .values({
      roomId: args.roomId,
      threadRootId: args.threadRootId,
      senderType: "system",
      senderId: null,
      content,
      status: "complete",
      metadata: {
        reason: "agent_quiet",
        quietAgentId: args.agent.id,
        quietAgentHandle: args.agent.handle,
      },
    })
    .returning({ id: messages.id })
  if (row) await broadcast(args.roomId, { type: "message.done", messageId: row.id, status: "complete" })
}

async function halt(
  sessionId: string,
  roomId: string,
  threadRootId: string | null,
  message: string,
  reason: string,
  queue: PlannedTurn[] = [],
) {
  await setSession(sessionId, { state: "halted", queue: [] })
  await postSystemMessage({ roomId, threadRootId, content: message, reason })
  await broadcastTurn(sessionId, roomId, threadRootId, null, queue)
}

async function breakerTrip(room: RoomRow, botTurnsUsed: number, taskId?: string | null) {
  const db = getDb()
  const [rpm] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentRuns)
    .where(
      and(eq(agentRuns.roomId, room.id), gte(agentRuns.createdAt, new Date(Date.now() - 60_000))),
    )
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const [spent] = await db
    .select({ total: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)::text` })
    .from(usageEvents)
    .where(and(eq(usageEvents.roomId, room.id), gte(usageEvents.createdAt, startOfDay)))

  let effectiveTurnCap = room.turnCap
  if (taskId) {
    const [t] = await db
      .select({ budgetTurns: tasks.budgetTurns })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1)
    effectiveTurnCap = t?.budgetTurns ?? 12
  }

  return checkPreTurnBreakers({
    botTurnsUsed,
    turnCap: effectiveTurnCap,
    rpmUsed: rpm?.count ?? 0,
    rpmLimit: room.rpmLimit,
    spentUsd: Number(spent?.total ?? 0),
    dailyBudgetUsd: room.dailyBudgetUsd,
  })
}

async function recentBotReplies(
  roomId: string,
  threadRootId: string | null,
  excludeMessageId: string,
): Promise<string[]> {
  const scope = threadRootId
    ? eq(messages.threadRootId, threadRootId)
    : isNull(messages.threadRootId)
  const rows = await getDb()
    .select({ content: messages.content })
    .from(messages)
    .where(
      and(
        eq(messages.roomId, roomId),
        eq(messages.senderType, "agent"),
        eq(messages.status, "complete"),
        scope,
        ne(messages.id, excludeMessageId),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(4)
  return rows.map((r) => r.content).reverse()
}

async function buildWebhookPayload(args: {
  room: RoomRow
  trigger: MessageRow
  threadRootId: string | null
}): Promise<WebhookPayload> {
  const conversation = await loadConversation({
    roomId: args.room.id,
    threadRootId: args.threadRootId,
    limit: 30,
  })
  const current = conversation.find((m) => m.id === args.trigger.id)
  const senderType = args.trigger.senderType
  return {
    event: "message.created",
    room_id: args.room.id,
    thread_id: args.threadRootId,
    message_id: args.trigger.id,
    sender: {
      id: args.trigger.senderId ?? "system",
      name: current?.senderName ?? (senderType === "human" ? "Human" : "Agent"),
      type: senderType,
    },
    content: args.trigger.content,
    mentions: extractHandles(args.trigger.content),
    context_snapshot: toWebhookContext(conversation.filter((m) => m.id !== args.trigger.id)),
  }
}

interface ModeratorDecision {
  human: boolean
  agent: AgentRow | null
  reason: string
}

async function decideModerator(args: {
  room: RoomRow
  roomAgentRows: RoomAgentRow[]
  threadRootId: string | null
  sessionId: string
  step: number
}): Promise<ModeratorDecision> {
  if (!args.room.moderatorAgentId) {
    throw new Error("Moderated room has no moderator agent configured")
  }
  const [moderator] = await getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.id, args.room.moderatorAgentId), eq(agents.orgId, args.room.orgId)))
    .limit(1)
  if (!moderator) throw new Error("The room's moderator agent no longer exists")
  if (moderator.kind !== "llm") throw new Error("The moderator must be an LLM agent")

  const resolved = await resolveAgentModel(moderator)
  const conversation = await loadConversation({
    roomId: args.room.id,
    threadRootId: args.threadRootId,
    limit: 30,
  })
  const system = [
    buildSystemPrompt({ room: args.room, agent: moderator, role: "moderator" }),
    "You are the room moderator. Choose who should speak next, or return control to the humans. Prefer agents that add new information. Never choose more than two consecutive turns from the same agent. Answer with one agent id from the list, or the exact string \"human\".",
  ].join("\n\n")
  const prompt = [
    `Conversation so far:\n${renderTranscript(conversation)}`,
    `Available agents:\n${agentListPrompt(args.roomAgentRows)}`,
    `Reply with {"next": "<agent id or human>", "reason": "<short reason>"}.`,
  ].join("\n\n")

  const started = Date.now()
  const result = await generateObject({
    model: resolved.model,
    system,
    prompt,
    schema: z.object({ next: z.string(), reason: z.string() }),
    temperature: 0,
    abortSignal: AbortSignal.timeout(60_000),
  })
  const latencyMs = Date.now() - started
  const agentRefs = args.roomAgentRows.map(({ agent }) => ({
    id: agent.id,
    handle: agent.handle,
    kind: agent.kind,
  }))
  const validated = validateModeratorChoice(result.object.next, agentRefs)
  const chosen = args.roomAgentRows.find(({ agent }) => agent.id === validated.next)?.agent ?? null

  const cost = await recordUsageEvent({
    orgId: args.room.orgId,
    roomId: args.room.id,
    agentId: moderator.id,
    provider: resolved.provider,
    model: resolved.modelName,
    tokens: tokensFrom(result.usage),
    kind: "moderator",
    latencyMs,
  })
  await getDb().insert(agentRuns).values({
    sessionId: args.sessionId,
    roomId: args.room.id,
    agentId: moderator.id,
    step: args.step,
    role: "moderator",
    status: "complete",
    inputTokens: result.usage?.inputTokens ?? null,
    outputTokens: result.usage?.outputTokens ?? null,
    costUsd: cost,
    latencyMs,
  })

  return {
    human: validated.next === HUMAN_TURN,
    agent: chosen,
    reason: result.object.reason,
  }
}

/**
 * Coordinates one human message into a deterministic sequence of bot turns.
 * The room advisory lock serializes turns across instances; a newer human
 * message aborts in-flight runs through a LISTEN/NOTIFY interrupt.
 */
export async function processRoomMessage(
  roomId: string,
  messageId: string,
  deps: CoordinatorDeps,
): Promise<void> {
  // Only a human message supersedes work in progress; a bot waking a teammate
  // queues behind the current session instead of cancelling it.
  const incoming = await loadMessage(messageId)
  if (incoming?.senderType === "human") await interruptRoom(roomId, incoming)

  await withRoomLock(roomId, async () => {
    const db = getDb()
    const room = await loadRoom(roomId)
    if (!room) return
    const trigger = await loadMessage(messageId)
    if (!trigger || trigger.roomId !== roomId) return
    // Agents can start a session only by mentioning teammates outside their own turn
    // (MCP bots, webhook bots posting later). collab/postAgentMessage sets the flag.
    const agentTriggered =
      trigger.senderType === "agent" && trigger.metadata?.agentTrigger === true && room.kind !== "dm"
    const taskWakeMeta =
      trigger.senderType === "system" && trigger.metadata?.taskWake
        ? (trigger.metadata.taskWake as { taskId: string; agentIds: string[]; reason: string })
        : null
    const taskWakeTriggered = Boolean(taskWakeMeta)

    if (trigger.senderType !== "human" && !agentTriggered && !taskWakeTriggered) return

    const taskId = taskWakeMeta?.taskId ?? null

    const [session] = await db
      .insert(turnSessions)
      .values({
        roomId,
        threadRootId: trigger.threadRootId,
        triggerMessageId: trigger.id,
        taskId,
        botTurnsUsed: 0,
        state: "active",
        queue: [],
      })
      .returning()
    if (!session) throw new Error("failed to create turn session")

    const roomAgentRows = await loadRoomAgents(roomId)
    const agentRefs = roomAgentRows.map(({ agent }) => ({
      id: agent.id,
      handle: agent.handle,
      kind: agent.kind,
    }))
    if (agentRefs.length === 0) {
      await setSession(session.id, { state: "complete" })
      await broadcastTurn(session.id, roomId, trigger.threadRootId, null, [])
      return
    }

    const dmAgent = room.kind === "dm" && room.agentDmAgentId
      ? roomAgentRows.find(({ agent }) => agent.id === room.agentDmAgentId)?.agent
      : undefined
    let queue: PlannedTurn[]
    if (taskWakeTriggered && taskWakeMeta) {
      const allowedAgentIds = new Set(agentRefs.map((a) => a.id))
      queue = (taskWakeMeta.agentIds || [])
        .filter((id) => allowedAgentIds.has(id))
        .map((id) => ({ agentId: id, role: "responder" as const }))
    } else if (agentTriggered) {
      queue = planMentionsTurn({
        text: trigger.content,
        roomAgents: agentRefs,
        excludeAgentIds: trigger.senderId ? [trigger.senderId] : [],
      })
    } else if (dmAgent) {
      queue = [{ agentId: dmAgent.id, role: "responder" }]
    } else if (room.turnMode === "mentions") {
      queue = planMentionsTurn({ text: trigger.content, roomAgents: agentRefs })
    } else if (room.turnMode === "debate") {
      queue = planDebateTurns({
        roomAgents: agentRefs,
        debateOrder: room.debateOrder,
        text: trigger.content,
      })
    } else {
      queue = planModeratedMentions({ text: trigger.content, roomAgents: agentRefs })
    }
    const explicitModeratedMentions =
      agentTriggered || (room.turnMode === "moderated" && queue.length > 0)
    let botTurnsUsed = 0
    let state: "active" | "complete" | "halted" | "superseded" = "active"
    let lastTrigger = trigger

    await setSession(session.id, { botTurnsUsed, queue, state: "active" })
    await broadcastTurn(session.id, roomId, trigger.threadRootId, null, queue)

    while (true) {
      const currentState = await getSessionState(session.id)
      if (currentState !== "active") {
        state = currentState ?? "superseded"
        break
      }

      const needsModerator = queue.length === 0 && room.turnMode === "moderated" && !explicitModeratedMentions
      if (queue.length === 0 && !needsModerator) {
        state = "complete"
        break
      }

      const trip = await breakerTrip(room, botTurnsUsed, session.taskId)
      if (trip) {
        if (session.taskId && trip.code === "turn_cap") {
          await db
            .update(tasks)
            .set({
              status: "stuck",
              unblockNeeds: "human_answer",
              unblockDetail: `Budget used up (${botTurnsUsed} turns). Approve more?`,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, session.taskId))
        }
        await halt(session.id, roomId, trigger.threadRootId, trip.message, trip.reason)
        state = "halted"
        break
      }

      if (needsModerator) {
        let decision: ModeratorDecision
        try {
          decision = await decideModerator({
            room,
            roomAgentRows,
            threadRootId: trigger.threadRootId,
            sessionId: session.id,
            step: botTurnsUsed + 1,
          })
        } catch (error) {
          await postSystemMessage({
            roomId,
            threadRootId: trigger.threadRootId,
            content: `Moderator failed: ${error instanceof Error ? error.message : String(error)}`,
            reason: "moderator_error",
          })
          await setSession(session.id, { state: "halted", queue: [] })
          state = "halted"
          break
        }
        if (decision.human || !decision.agent) {
          state = "complete"
          break
        }
        queue = [{ agentId: decision.agent.id, role: "responder", reason: decision.reason }]
      }

      const next = queue.shift()
      if (!next) continue
      const agentRow = roomAgentRows.find(({ agent }) => agent.id === next.agentId)?.agent
      if (!agentRow) continue

      await setSession(session.id, { botTurnsUsed, queue, state: "active" })
      await broadcastTurn(session.id, roomId, trigger.threadRootId, next.agentId, queue)

      let result: {
        runId: string
        messageId: string | null
        content: string
        error: string | null
        aborted: boolean
        timedOut?: boolean
        deferred?: boolean
      }
      try {
        if (agentRow.kind === "external") {
          const payload = await buildWebhookPayload({
            room,
            trigger: lastTrigger,
            threadRootId: trigger.threadRootId,
          })
          result = await runExternalTurn({
            room,
            agent: agentRow,
            sessionId: session.id,
            threadRootId: trigger.threadRootId,
            trigger: lastTrigger,
            role: next.role,
            step: botTurnsUsed + 1,
            payload,
            enqueueWebhook: deps.enqueueWebhook,
          })
        } else {
          result = await startAgentTurn({
            room,
            agent: agentRow,
            sessionId: session.id,
            threadRootId: trigger.threadRootId,
            trigger: lastTrigger,
            role: next.role,
            step: botTurnsUsed + 1,
            taskId: session.taskId,
          })
        }
      } catch (error) {
        const message = redactSecrets(
          `Agent @${agentRow.handle} failed: ${error instanceof Error ? error.message : String(error)}`,
        ).text
        await halt(session.id, roomId, trigger.threadRootId, message, "agent_error", queue)
        state = "halted"
        break
      }

      botTurnsUsed += 1
      await setSession(session.id, { botTurnsUsed, queue, state: "active" })

      const after = await getSessionState(session.id)
      if (after !== "active") {
        state = after ?? "superseded"
        break
      }

      if (result.aborted) {
        await halt(
          session.id,
          roomId,
          trigger.threadRootId,
          "Generation stopped. Human input is required to continue.",
          "stopped",
          queue,
        )
        state = "halted"
        break
      }

      if (result.error) {
        await halt(
          session.id,
          roomId,
          trigger.threadRootId,
          redactSecrets(`Agent @${agentRow.handle} failed: ${result.error}`).text,
          "agent_error",
          queue,
        )
        state = "halted"
        break
      }

      if (result.deferred) {
        // Pull-based bots don't consume the room's bot-turn budget.
        botTurnsUsed -= 1
        await setSession(session.id, { botTurnsUsed, queue, state: "active" })
        continue
      }

      if (result.timedOut) {
        await postQuietBotNotice({ roomId, threadRootId: trigger.threadRootId, agent: agentRow })
        continue
      }

      if (result.messageId) {
        const message = await loadMessage(result.messageId)
        if (message) {
          lastTrigger = message
          const recent = await recentBotReplies(roomId, trigger.threadRootId, message.id)
          const repetition = detectRepetition(result.content, recent)
          if (repetition.repeating) {
            await halt(
              session.id,
              roomId,
              trigger.threadRootId,
              REPETITION_HALT_MESSAGE,
              repetition.reason ?? "repetition",
              queue,
            )
            state = "halted"
            break
          }
          if (room.turnMode === "mentions" && result.content) {
            const followUps = planBotFollowUps({
              text: result.content,
              roomAgents: agentRefs,
              senderAgentId: agentRow.id,
            })
            if (followUps.length) {
              queue.push(...followUps)
              await setSession(session.id, { botTurnsUsed, queue, state: "active" })
              await broadcastTurn(session.id, roomId, trigger.threadRootId, null, queue)
            }
          }
        }
      }
    }

    await setSession(session.id, { state, queue: [] })
    await broadcastTurn(session.id, roomId, trigger.threadRootId, null, [])
  })
}
