import "server-only"
import { applyAnswersToItems, askItemsFromMetadata, extractHandles } from "@sayabot/core"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { audit, errorMessage, fail, ok } from "@/lib/actions/shared"
import { getRoomAccess } from "@/lib/auth"
import { ensureBotDmRoom } from "@/lib/bot-dm"
import { deliverItemAnswers, resolveOpenAsksFromFacts, upsertFact } from "@/lib/facts"
import { mutateTaskInOrchestrator, queueRoomMessage } from "@/lib/orchestrator"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ActionResult } from "@/lib/types"

/**
 * Answers agent questions as a person: keyed items become facts, other open questions waiting
 * on the same key are filled, and the bot gets the answer in the room or privately. Shared by
 * the web Inbox (session) and the phone app (bearer token).
 */
export async function answerRequestsAs(
  who: { user: User; client?: SupabaseClient<any> },
  input: {
  orgSlug: string
  taskId?: string
  packetId?: string
  answer?: string
  alsoPost?: boolean
  /** Keyed answers for a structured question: { start_date: "June 2027" }. */
  itemAnswers?: Record<string, string>
  answers?: Array<{ taskId: string; answer: string; alsoPost?: boolean; itemAnswers?: Record<string, string> }>
  },
): Promise<ActionResult> {
  const user = who.user
  const items: Array<{ taskId: string; answer: string; alsoPost?: boolean; itemAnswers?: Record<string, string> }> = []
  const hasItemAnswers = (value?: Record<string, string>) =>
    Boolean(value && Object.values(value).some((v) => typeof v === "string" && v.trim()))
  if (input.answers && input.answers.length > 0) {
    for (const a of input.answers) {
      const trimmed = a.answer?.trim() ?? ""
      if (trimmed || hasItemAnswers(a.itemAnswers)) {
        items.push({ taskId: a.taskId, answer: trimmed, alsoPost: a.alsoPost, itemAnswers: a.itemAnswers })
      }
    }
  } else if (input.taskId && (input.answer?.trim() || hasItemAnswers(input.itemAnswers))) {
    items.push({
      taskId: input.taskId,
      answer: input.answer?.trim() ?? "",
      alsoPost: input.alsoPost,
      itemAnswers: input.itemAnswers,
    })
  }

  if (items.length === 0) return fail("Write an answer")

  const admin = createAdminClient()
  const touchedRooms = new Map<string, string>() // roomId -> orgId
  const answeredTaskIds: string[] = []

  for (const item of items) {
    if (item.answer.length > 4_000) return fail("Keep answers under 4,000 characters")
    const { data: task } = await admin
      .from("tasks")
      .select("*")
      .eq("id", item.taskId)
      .maybeSingle()
    if (!task) continue
    if (task.kind !== "request") continue
    if (task.status === "done") continue

    const access = await getRoomAccess(input.orgSlug, task.room_id, who.client ? { client: who.client, user } : undefined)
    if (!access) continue
    if (
      task.requested_from_user_id &&
      task.requested_from_user_id !== user.id &&
      !access.canAdmin
    ) {
      continue
    }

    const agent = task.requested_by_agent_id
      ? (
          await admin
            .from("agents")
            .select("id, handle, display_name")
            .eq("id", task.requested_by_agent_id)
            .maybeSingle()
        ).data
      : null

    let targetRoomId = task.room_id
    if (agent && !item.alsoPost) {
      targetRoomId = await ensureBotDmRoom({
        orgId: access.org.id,
        userId: user.id,
        agentId: agent.id,
        agentName: agent.display_name,
      })
    }

    // Keyed question: answers are kept as facts and the question stays open until every item is in.
    const askItems = askItemsFromMetadata(task.metadata)
    if (askItems.length) {
      const applied = applyAnswersToItems(askItems, item.itemAnswers ?? {}, "human")
      if (!applied.answeredKeys.length && !item.answer) continue
      for (const key of applied.answeredKeys) {
        const answered = applied.items.find((i) => i.key === key)
        if (!answered?.answer) continue
        await upsertFact({
          orgId: access.org.id,
          roomId: task.room_id,
          key,
          value: answered.answer,
          source: "answer",
          userId: user.id,
          taskId: task.id,
        })
      }
      // A free-text note with no items left to fill closes the question too.
      const remaining = item.answer && applied.remaining > 0 && !applied.answeredKeys.length ? 0 : applied.remaining
      const delivered = await deliverItemAnswers({
        taskId: task.id,
        roomId: task.room_id,
        agentId: agent?.id ?? null,
        userId: user.id,
        items: applied.items,
        answeredKeys: applied.answeredKeys,
        remaining,
        extra: item.answer,
        targetRoomId,
        metadata: task.metadata ?? {},
      })
      if (!delivered.ok) return fail(delivered.error ?? "Could not post the answer")
      touchedRooms.set(task.room_id, access.org.id)
      answeredTaskIds.push(task.id)
      await audit({
        orgId: access.org.id,
        actorId: user.id,
        action: "request.answered",
        target: task.id,
        metadata: { roomId: task.room_id, targetRoomId, keys: applied.answeredKeys, remaining },
      })
      continue
    }

    const inGroup = targetRoomId === task.room_id
    const content = inGroup && agent ? `@${agent.handle} ${item.answer}` : item.answer
    const { data: message, error } = await admin
      .from("messages")
      .insert({
        room_id: targetRoomId,
        sender_type: "human",
        sender_id: user.id,
        content,
        status: "complete",
        mentions: extractHandles(content),
        metadata: {
          taskId: task.id,
          requestAnswer: true,
          alsoPost: item.alsoPost,
          ...(!inGroup && agent ? { dmToAgentId: agent.id } : {}),
        },
      })
      .select("id")
      .single()

    if (error || !message) return fail(errorMessage(error) || "Could not post the answer")
    await queueRoomMessage(targetRoomId, message.id)

    // Complete request through orchestrator service mutation
    await mutateTaskInOrchestrator({
      taskId: task.id,
      actor: { type: "human", id: user.id },
      status: "done",
      outcome: { kind: "decision", ref: message.id },
      reason: "human answered request",
      note: item.answer,
      metadata: {
        answer: item.answer,
        answeredBy: user.id,
        answeredAt: new Date().toISOString(),
        alsoPost: item.alsoPost,
      },
    })

    await audit({
      orgId: access.org.id,
      actorId: user.id,
      action: "request.answered",
      target: task.id,
      metadata: { roomId: task.room_id, targetRoomId, packetId: input.packetId },
    })
  }

  // One answer fills every other open question in the room that was waiting on the same key.
  for (const [roomId, orgId] of touchedRooms) {
    await resolveOpenAsksFromFacts({ orgId, roomIds: [roomId], userId: user.id, skipTaskIds: answeredTaskIds })
  }

  return ok(items.length > 1 ? `${items.length} answers submitted` : "Answer sent")
}
