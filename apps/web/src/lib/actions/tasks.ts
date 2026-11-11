"use server"

import { revalidatePath } from "next/cache"
import { applyAnswersToItems, askItemsFromMetadata, extractHandles } from "@sayabot/core"
import { getRoomAccess, requireUser } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureBotDmRoom } from "@/lib/bot-dm"
import { deliverItemAnswers, resolveOpenAsksFromFacts, upsertFact } from "@/lib/facts"
import { mutateTaskInOrchestrator, queueRoomMessage } from "@/lib/orchestrator"
import { audit, errorMessage, fail, field, ok } from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

type TaskStatus = "open" | "in_progress" | "stuck" | "done"
const TASK_KINDS = ["task", "request"] as const

async function agentForRoom(orgId: string, roomId: string, agentId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from("agents")
    .select("id, org_id, handle, display_name")
    .eq("id", agentId)
    .eq("org_id", orgId)
    .maybeSingle()
  if (!data) return null
  const { data: membership } = await admin
    .from("room_agents")
    .select("agent_id")
    .eq("room_id", roomId)
    .eq("agent_id", agentId)
    .maybeSingle()
  return membership ? data : null
}

export async function createTaskAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const access = await getRoomAccess(orgSlug, roomId)
  if (!access) return fail("Room not found")
  const title = field(formData, "title")
  const description = field(formData, "description")
  const kind = field(formData, "kind") as (typeof TASK_KINDS)[number]
  const assignee = field(formData, "assignee")
  if (title.length < 2 || title.length > 120) return fail("Title must be 2 to 120 characters")
  if (description.length > 4_000) return fail("Keep the description under 4,000 characters")
  if (!TASK_KINDS.includes(kind)) return fail("Choose task or request")
  let assigneeUserId: string | null = null
  let assigneeAgentId: string | null = null
  if (assignee.startsWith("user:")) assigneeUserId = assignee.slice(5)
  if (assignee.startsWith("agent:")) assigneeAgentId = assignee.slice(6)
  if (assigneeAgentId) {
    const agent = await agentForRoom(access.org.id, roomId, assigneeAgentId)
    if (!agent) return fail("That agent is not in this room")
  }
  if (assigneeUserId) {
    const admin = createAdminClient()
    const { data: member } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", access.org.id)
      .eq("user_id", assigneeUserId)
      .maybeSingle()
    if (!member) return fail("That person is not in this workspace")
    const { data: roomMember } = await admin
      .from("room_members")
      .select("user_id")
      .eq("room_id", roomId)
      .eq("user_id", assigneeUserId)
      .maybeSingle()
    if (!roomMember) return fail("That person is not in this room")
  }
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("tasks")
    .insert({
      org_id: access.org.id,
      room_id: roomId,
      kind,
      title,
      description,
      status: "open",
      assignee_user_id: assigneeUserId,
      assignee_agent_id: assigneeAgentId,
      created_by: access.user.id,
      metadata: {},
    })
    .select("id, number")
    .single()
  if (error || !data) return fail(errorMessage(error) || "Could not create the task")
  await audit({
    orgId: access.org.id,
    actorId: access.user.id,
    action: kind === "request" ? "request.created" : "task.created",
    target: data.id,
    metadata: { roomId, title },
  })
  revalidatePath(`/${orgSlug}`, "layout")
  return ok(kind === "request" ? "Request created" : "Task created", {
    taskId: data.id,
    number: data.number,
  })
}

export async function updateTaskAction(input: {
  orgSlug: string
  taskId: string
  status?: TaskStatus
  assignee?: string
  dueAt?: string | null
  unblockNeeds?: string | null
  unblockDetail?: string | null
  blockedBy?: string[] | null
  outcome?: { kind: string; ref?: string | null } | null
  reason?: string | null
  note?: string | null
}): Promise<ActionResult> {
  const admin = createAdminClient()
  const { data: task } = await admin.from("tasks").select("*").eq("id", input.taskId).maybeSingle()
  if (!task) return fail("Task not found")
  const access = await getRoomAccess(input.orgSlug, task.room_id)
  if (!access) return fail("Room not found")

  let assigneeUserId: string | null | undefined = undefined
  let assigneeAgentId: string | null | undefined = undefined

  if (input.assignee !== undefined) {
    if (input.assignee.startsWith("user:")) {
      const userId = input.assignee.slice(5)
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return fail("Choose a valid person")
      const { data: member } = await admin
        .from("org_members")
        .select("user_id")
        .eq("org_id", access.org.id)
        .eq("user_id", userId)
        .maybeSingle()
      if (!member) return fail("That person is not in this workspace")
      const { data: roomMember } = await admin
        .from("room_members")
        .select("user_id")
        .eq("room_id", task.room_id)
        .eq("user_id", userId)
        .maybeSingle()
      if (!roomMember) return fail("That person is not in this room")
      assigneeUserId = userId
      assigneeAgentId = null
    } else if (input.assignee.startsWith("agent:")) {
      const agent = await agentForRoom(access.org.id, task.room_id, input.assignee.slice(6))
      if (!agent) return fail("That agent is not in this room")
      assigneeAgentId = agent.id
      assigneeUserId = null
    } else {
      assigneeUserId = null
      assigneeAgentId = null
    }
  }

  // Mutate through orchestrator service layer enforcing task integrity & event recording
  const mutation = await mutateTaskInOrchestrator({
    taskId: input.taskId,
    actor: { type: "human", id: access.user.id },
    status: input.status,
    assigneeUserId,
    assigneeAgentId,
    dueAt: input.dueAt,
    unblockNeeds: input.unblockNeeds,
    unblockDetail: input.unblockDetail,
    blockedBy: input.blockedBy,
    outcome: input.outcome,
    reason: input.reason,
    note: input.note,
  })

  if (!mutation.ok) {
    return fail(mutation.error ?? "Failed to update task")
  }

  await audit({
    orgId: access.org.id,
    actorId: access.user.id,
    action: "task.updated",
    target: input.taskId,
    metadata: {
      roomId: task.room_id,
      status: input.status ?? null,
      assignee: input.assignee ?? null,
    },
  })
  revalidatePath(`/${input.orgSlug}`, "layout")
  return ok("Task updated")
}

export async function addTaskCommentAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const taskId = field(formData, "taskId")
  const content = field(formData, "content")
  if (!content) return fail("Write a comment")
  if (content.length > 4_000) return fail("Keep comments under 4,000 characters")
  const admin = createAdminClient()
  const { data: task } = await admin.from("tasks").select("room_id").eq("id", taskId).maybeSingle()
  if (!task) return fail("Task not found")
  const access = await getRoomAccess(orgSlug, task.room_id)
  if (!access) return fail("Room not found")
  const { error } = await admin.from("task_comments").insert({
    task_id: taskId,
    author_type: "human",
    author_id: access.user.id,
    content,
  })
  if (error) return fail(errorMessage(error))
  revalidatePath(`/${orgSlug}`, "layout")
  return ok("Comment added")
}

export async function answerTaskRequestAction(input: {
  orgSlug: string
  taskId?: string
  packetId?: string
  answer?: string
  alsoPost?: boolean
  /** Keyed answers for a structured question: { start_date: "June 2027" }. */
  itemAnswers?: Record<string, string>
  answers?: Array<{ taskId: string; answer: string; alsoPost?: boolean; itemAnswers?: Record<string, string> }>
}): Promise<ActionResult> {
  const user = await requireUser(`/${input.orgSlug}`)
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

    const access = await getRoomAccess(input.orgSlug, task.room_id)
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

  revalidatePath(`/${input.orgSlug}`, "layout")
  return ok(items.length > 1 ? `${items.length} answers submitted` : "Answer sent")
}
