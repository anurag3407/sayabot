import { and, eq, gt, inArray } from "drizzle-orm"
import { agentReads, roomSchedules, taskEvents, type Db } from "@sayabot/db"
import { getDb } from "../db"
import { type CollabAgent, postAgentMessage, resolveAgentRoomId } from "./index"
import { autoCloseMootRequests } from "./tasks-service"

export interface CheckinReportInput {
  roomId?: string
  room?: string
  summary?: string
  changed?: Array<{ taskRef?: string; taskId?: string; eventId?: string }>
  noChange?: boolean
}

export interface CheckinReportResult {
  posted: boolean
  isChanged: boolean
  mode: "stream" | "digest"
  quiet?: boolean
  manufacturedTrivia?: boolean
  validEventCount: number
  messageId?: string
  note: string
}

/**
 * Classifies an agent checkin against actual task_events since the agent's last check-in.
 * In digest mode, no_change checkins post no room message and are rolled up.
 * In stream mode, no_change checkins post with metadata.quiet = true (client collapses).
 */
export async function classifyAndRecordCheckin(
  agent: CollabAgent,
  input: CheckinReportInput,
  dbOverride?: Db,
): Promise<CheckinReportResult> {
  const db = dbOverride || getDb()
  const roomId = await resolveAgentRoomId(agent, input.roomId || input.room)

  // Auto-close any expired or moot requests in this room before evaluating check-in
  await autoCloseMootRequests({ roomId }, db).catch(() => {})

  // 1. Fetch agent cursor (lastReportedAt)
  const [read] = await db
    .select({ lastReportedAt: agentReads.lastReportedAt })
    .from(agentReads)
    .where(and(eq(agentReads.agentId, agent.agentId), eq(agentReads.roomId, roomId)))
    .limit(1)

  const lastReportedAt = read?.lastReportedAt ?? new Date(0)

  // 2. Fetch room schedule checkin mode
  const [schedule] = await db
    .select({ checkinMode: roomSchedules.checkinMode })
    .from(roomSchedules)
    .where(eq(roomSchedules.roomId, roomId))
    .limit(1)

  const checkinMode = schedule?.checkinMode ?? "stream"

  // 3. Classify changes: verify cited events against task_events
  const citedIds = (input.changed ?? [])
    .map((c) => c.eventId)
    .filter((id): id is string => Boolean(id && /^[0-9a-f-]{36}$/i.test(id)))

  let validEvents: Array<{ id: string; taskId: string }> = []
  if (citedIds.length > 0) {
    validEvents = await db
      .select({ id: taskEvents.id, taskId: taskEvents.taskId })
      .from(taskEvents)
      .where(and(inArray(taskEvents.id, citedIds), gt(taskEvents.createdAt, lastReportedAt)))
  }

  const agentClaimedChanged = !input.noChange && (input.changed ?? []).length > 0
  const isChanged = validEvents.length > 0
  const manufacturedTrivia = agentClaimedChanged && !isChanged

  // 4. Update cursor lastReportedAt
  const now = new Date()
  await db
    .insert(agentReads)
    .values({
      agentId: agent.agentId,
      roomId,
      lastReadAt: now,
      lastReportedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [agentReads.agentId, agentReads.roomId],
      set: {
        lastReportedAt: now,
        updatedAt: now,
      },
    })

  const summary = input.summary?.trim() || (isChanged ? "Progress update" : "No state change")

  // 5. Handle posting based on checkinMode
  if (isChanged) {
    const postRes = await postAgentMessage(agent, {
      roomId,
      content: summary,
      metadata: {
        checkin: true,
        changed: true,
        citedEvents: validEvents.map((e) => e.id),
      },
    })

    return {
      posted: true,
      isChanged: true,
      mode: checkinMode,
      validEventCount: validEvents.length,
      messageId: postRes.message_id,
      note: `Check-in posted with ${validEvents.length} cited state change(s).`,
    }
  }

  // No change path:
  if (checkinMode === "digest") {
    // Suppress room message in digest mode!
    return {
      posted: false,
      isChanged: false,
      mode: "digest",
      manufacturedTrivia,
      validEventCount: 0,
      note: manufacturedTrivia
        ? "Report claimed changes but cited no valid task events. Recorded as no_change; room message suppressed (digest mode)."
        : "No state changes reported. Recorded in room digest; room message suppressed.",
    }
  }

  // Stream mode: post with metadata.quiet = true
  const postRes = await postAgentMessage(agent, {
    roomId,
    content: summary,
    metadata: {
      checkin: true,
      no_change: true,
      quiet: true,
      manufacturedTrivia,
    },
  })

  return {
    posted: true,
    isChanged: false,
    mode: "stream",
    quiet: true,
    manufacturedTrivia,
    validEventCount: 0,
    messageId: postRes.message_id,
    note: "No state changes reported. Posted as collapsed quiet check-in.",
  }
}
