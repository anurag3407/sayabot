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
  validateLeadPlan,
  LEAD_MAX_AGENTS,
  type PlannedTurn,
  type WebhookPayload,
} from "@sayabot/core"
import { agentRuns, agents, messages, tasks, turnSessions, usageEvents } from "@sayabot/db"
import { generateObject } from "ai"
import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm"
import { z } from "zod"
import { recordUsageEvent, tokensFrom } from "../usage"
import { getDb, notify, withRoomLock } from "../db"
import type { WebhookJobData } from "../jobs/webhook"
import { broadcast } from "../realtime"
import { runExternalTurn } from "../runner/external"
import {
  agentAppOnline,
  buildSystemPrompt,
  handoffNames,
  loadConversation,
  loadMessage,
  loadRoom,
  leadAgentListPrompt,
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
import { deliverSideNote, interruptRoom } from "./interrupt"
import {
  GOAL_MAX_ROUNDS,
  GOAL_WAITING_REASON,
  goalDirective,
  goalOf,
  goalOutcome,
  goalQuestionOf,
  isSideNote,
} from "./goal"
import { attachReplyVoiceNoteIfNeeded } from "../tts/reply-note"

export interface CoordinatorDeps {
  enqueueWebhook: (data: WebhookJobData) => Promise<void>
}

/**
 * Ties a goal to the question that interrupted it. The web answer flow copies `metadata.goal`
 * onto the human's answer message, which is what makes the next turn a goal round again.
 */
async function markAskJoinsGoal(args: {
  roomId: string
  agentId: string
  triggerId: string
  since: Date | string
}): Promise<void> {
  const goal = await currentGoalText(args.roomId, args.triggerId)
  if (!goal) return
  const since = new Date(args.since)
  const [ask] = await getDb()
    .select({ id: tasks.id, metadata: tasks.metadata })
    .from(tasks)
    .where(
      and(
        eq(tasks.roomId, args.roomId),
        eq(tasks.kind, "request"),
        eq(tasks.status, "open"),
        eq(tasks.requestedByAgentId, args.agentId),
        gte(tasks.createdAt, since),
      ),
    )
    .orderBy(desc(tasks.createdAt))
    .limit(1)
  if (!ask) return
  await getDb()
    .update(tasks)
    .set({ metadata: { ...(ask.metadata ?? {}), goal }, updatedAt: new Date() })
    .where(eq(tasks.id, ask.id))
}

/** The goal text of the message that opened this session. */
async function currentGoalText(roomId: string, messageId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ content: messages.content, metadata: messages.metadata })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.roomId, roomId)))
    .limit(1)
  if (!row) return null
  return goalOf({
    senderType: "human",
    content: row.content,
    metadata: row.metadata,
  })
}

async function setSession(
  sessionId: string,
  values: {
    botTurnsUsed?: number
    queue?: PlannedTurn[]
    state?: "active" | "complete" | "halted" | "superseded"
  },
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
  if (row)
    await broadcast(args.roomId, { type: "message.done", messageId: row.id, status: "complete" })
}

/**
 * The lead agent handed the floor to another agent: say so in the room, and mention the agent
 * so an invited app finds the request in its inbox (it reads mentions, not the turn queue).
 */
async function postLeadHandoff(args: {
  roomId: string
  threadRootId: string | null
  lead: AgentRow
  /** In the order they will answer. */
  chosen: AgentRow[]
  reason: string
}) {
  const reason = args.reason.replace(/\s+/g, " ").trim().slice(0, 200)
  const content = redactSecrets(
    `@${args.lead.handle} asked ${handoffNames(args.chosen.map((a) => a.handle))} to take this${reason ? `: ${reason}` : "."}`,
  ).text
  const [row] = await getDb()
    .insert(messages)
    .values({
      roomId: args.roomId,
      threadRootId: args.threadRootId,
      senderType: "system",
      senderId: null,
      content,
      status: "complete",
      mentions: args.chosen.map((a) => a.handle.toLowerCase()),
      metadata: {
        reason: "lead_handoff",
        leadAgentId: args.lead.id,
        chosenAgentIds: args.chosen.map((a) => a.id),
      },
    })
    .returning({ id: messages.id })
  if (row)
    await broadcast(args.roomId, { type: "message.done", messageId: row.id, status: "complete" })
  for (const agent of args.chosen) {
    if (agent.kind !== "external") continue
    void notify("mesh_agent_inbox", {
      agentId: agent.id,
      roomId: args.roomId,
      kind: "mention",
    }).catch(() => {})
  }
}

/** A turn went to an invited app that isn't open: tell the room instead of going silent. */
async function postAppOfflineNotice(args: {
  roomId: string
  threadRootId: string | null
  agent: AgentRow
}) {
  const content = `@${args.agent.handle}'s app isn't open right now. It will see this and reply when its owner opens it.`
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
        reason: "agent_app_offline",
        quietAgentId: args.agent.id,
        quietAgentHandle: args.agent.handle,
      },
    })
    .returning({ id: messages.id })
  if (row)
    await broadcast(args.roomId, { type: "message.done", messageId: row.id, status: "complete" })
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

async function breakerTrip(
  room: RoomRow,
  botTurnsUsed: number,
  taskId?: string | null,
  /** A /goal session runs many rounds on purpose: the room's per-message cap would end it early. */
  goalTurns?: number,
) {
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
  if (goalTurns) effectiveTurnCap = Math.max(effectiveTurnCap, goalTurns)

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
  /** Who answers next, in order: one agent, or a few when the message needs several. */
  agents: AgentRow[]
  reason: string
  lead: AgentRow
}

/** What the lead agent is told on top of its own instructions. */
export const LEAD_AGENT_INSTRUCTIONS = [
  "You are the lead agent of this room. People write requests without naming an agent; you pass each request to the agent whose job fits it best, for example documentation to a writer and code changes to a coder.",
  "Read the newest message first and match it against each agent's description. If you fit best yourself, choose your own id.",
  `When one message clearly needs more than one agent (for example "document this and then fix the bug"), put the first in "next" and the others, in the order they should answer, in "also" (at most ${LEAD_MAX_AGENTS} agents in all). Otherwise leave "also" empty.`,
  "Prefer agents that answer now or whose app is open. Choose an app that is not open only when no other agent can do the job.",
  'When the last reply already answers the request, or the people need to decide or answer something, return control with "human".',
  "Never choose more than two turns in a row from the same agent.",
  '"next" is one agent id from the list, or the exact string "human".',
].join(" ")

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
  if (!moderator) throw new Error("The room's lead agent no longer exists")
  if (moderator.kind !== "llm") {
    throw new Error("The lead agent must be one made in Sayabot, not an invited app")
  }

  const resolved = await resolveAgentModel(moderator)
  const conversation = await loadConversation({
    roomId: args.room.id,
    threadRootId: args.threadRootId,
    limit: 30,
  })
  const system = [
    buildSystemPrompt({ room: args.room, agent: moderator, role: "moderator" }),
    LEAD_AGENT_INSTRUCTIONS,
  ].join("\n\n")
  const prompt = [
    `Conversation so far:\n${renderTranscript(conversation)}`,
    `Agents in this room:\n${leadAgentListPrompt(args.roomAgentRows, moderator.id)}`,
    `Reply with {"next": "<agent id or human>", "also": ["<more agent ids, usually none>"], "reason": "<short reason>"}.`,
  ].join("\n\n")

  const started = Date.now()
  const result = await generateObject({
    model: resolved.model,
    system,
    prompt,
    schema: z.object({ next: z.string(), also: z.array(z.string()), reason: z.string() }),
    temperature: 0,
    abortSignal: AbortSignal.timeout(60_000),
  })
  const latencyMs = Date.now() - started
  const agentRefs = args.roomAgentRows.map(({ agent }) => ({
    id: agent.id,
    handle: agent.handle,
    kind: agent.kind,
  }))
  const plan = validateLeadPlan(result.object.next, result.object.also ?? [], agentRefs)
  const chosen = plan.agentIds
    .map((id) => args.roomAgentRows.find(({ agent }) => agent.id === id)?.agent)
    .filter((agent): agent is AgentRow => Boolean(agent))

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
  await getDb()
    .insert(agentRuns)
    .values({
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
    human: plan.human || chosen.length === 0,
    agents: chosen,
    reason: result.object.reason,
    lead: moderator,
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
  // "/btw": a side note for the bots. It reaches agents working right now and is read by the
  // rest on their next turn; it never interrupts a run or starts one (a /goal keeps going).
  if (incoming && isSideNote(incoming)) {
    deliverSideNote(roomId, incoming)
    return
  }
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
      trigger.senderType === "agent" &&
      trigger.metadata?.agentTrigger === true &&
      room.kind !== "dm"
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

    const dmAgent =
      room.kind === "dm" && room.agentDmAgentId
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
    /** The next queued turn was picked by the lead agent (moderated rooms). */
    const leadQueued = new Set<string>()
    let state: "active" | "complete" | "halted" | "superseded" = "active"
    let lastTrigger = trigger
    // "/goal": every agent in the queue works in rounds until it reports done or blocked.
    const goal = goalOf(trigger)
    const goalRounds = new Map<string, number>()

    await setSession(session.id, { botTurnsUsed, queue, state: "active" })
    await broadcastTurn(session.id, roomId, trigger.threadRootId, null, queue)

    while (true) {
      const currentState = await getSessionState(session.id)
      if (currentState !== "active") {
        state = currentState ?? "superseded"
        break
      }

      const needsModerator =
        queue.length === 0 && room.turnMode === "moderated" && !explicitModeratedMentions
      if (queue.length === 0 && !needsModerator) {
        state = "complete"
        break
      }

      const trip = await breakerTrip(
        room,
        botTurnsUsed,
        session.taskId,
        goal ? GOAL_MAX_ROUNDS * Math.max(1, agentRefs.length) : undefined,
      )
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
            content: `The lead agent couldn't pick who answers: ${error instanceof Error ? error.message : String(error)}`,
            reason: "moderator_error",
          })
          await setSession(session.id, { state: "halted", queue: [] })
          state = "halted"
          break
        }
        if (decision.human || decision.agents.length === 0) {
          state = "complete"
          break
        }
        const handedTo = decision.agents.filter((agent) => agent.id !== decision.lead.id)
        if (handedTo.length) {
          await postLeadHandoff({
            roomId,
            threadRootId: trigger.threadRootId,
            lead: decision.lead,
            chosen: handedTo,
            reason: decision.reason,
          })
        }
        queue = decision.agents.map((agent) => ({
          agentId: agent.id,
          role: "responder" as const,
          reason: decision.reason,
        }))
        for (const agent of decision.agents) leadQueued.add(agent.id)
      }

      const next = queue.shift()
      if (!next) continue
      const fromLead = leadQueued.delete(next.agentId)
      const [freshAgent] = await getDb()
        .select()
        .from(agents)
        .where(eq(agents.id, next.agentId))
        .limit(1)
      const agentRow =
        freshAgent ?? roomAgentRows.find(({ agent }) => agent.id === next.agentId)?.agent
      if (!agentRow) continue

      await setSession(session.id, { botTurnsUsed, queue, state: "active" })
      await broadcastTurn(session.id, roomId, trigger.threadRootId, next.agentId, queue)

      // On a goal, each round re-reads the goal message with the round's instructions added to
      // the room directive (both the server engine and Mac/CLI runs read the directive).
      const round = (goalRounds.get(agentRow.id) ?? 0) + 1
      const turnRoom = goal
        ? {
            ...room,
            systemDirective: [room.systemDirective?.trim(), goalDirective(goal, round)]
              .filter(Boolean)
              .join("\n\n"),
          }
        : room
      const turnTrigger = goal ? trigger : lastTrigger

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
            room: turnRoom,
            trigger: turnTrigger,
            threadRootId: trigger.threadRootId,
          })
          result = await runExternalTurn({
            room: turnRoom,
            agent: agentRow,
            sessionId: session.id,
            threadRootId: trigger.threadRootId,
            trigger: turnTrigger,
            role: next.role,
            step: botTurnsUsed + 1,
            payload,
            enqueueWebhook: deps.enqueueWebhook,
          })
        } else {
          result = await startAgentTurn({
            room: turnRoom,
            agent: agentRow,
            sessionId: session.id,
            threadRootId: trigger.threadRootId,
            trigger: turnTrigger,
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
        if (!agentAppOnline(agentRow.lastSeenAt)) {
          await postAppOfflineNotice({
            roomId,
            threadRootId: trigger.threadRootId,
            agent: agentRow,
          })
        }
        // The app answers in its own time; asking the lead again now would only pick it again.
        if (fromLead && queue.length === 0) {
          state = "complete"
          break
        }
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
          await attachReplyVoiceNoteIfNeeded(agentRow, message.id, result.content)
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
          if (goal) {
            goalRounds.set(agentRow.id, round)
            const outcome = goalOutcome(result.content)
            if (outcome === "continue" && round < GOAL_MAX_ROUNDS) {
              if (!queue.some((turn) => turn.agentId === agentRow.id)) {
                queue.push({ agentId: agentRow.id, role: "responder", reason: "goal" })
                await setSession(session.id, { botTurnsUsed, queue, state: "active" })
                await broadcastTurn(session.id, roomId, trigger.threadRootId, null, queue)
              }
            } else if (outcome === "continue") {
              await postSystemMessage({
                roomId,
                threadRootId: trigger.threadRootId,
                content: `@${agentRow.handle} paused the goal after ${GOAL_MAX_ROUNDS} rounds. Send /goal again to keep going.`,
                reason: "goal_paused",
              })
            } else if (outcome === "blocked") {
              // The ask is the human's way back in: stamp it with the goal so answering the
              // question resumes this goal instead of starting a plain turn.
              await markAskJoinsGoal({
                roomId,
                agentId: agentRow.id,
                triggerId: trigger.id,
                since: trigger.createdAt,
              })
              const need = goalQuestionOf(result.content)
              await postSystemMessage({
                roomId,
                threadRootId: trigger.threadRootId,
                content: need
                  ? `@${agentRow.handle} is waiting on you: ${need}\nAnswer it and the goal carries on from there.`
                  : `@${agentRow.handle} is waiting on you before the goal can go further. Answer here or in your Inbox and it carries on.`,
                reason: GOAL_WAITING_REASON,
              })
            }
          } else if (room.turnMode === "mentions" && result.content) {
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
