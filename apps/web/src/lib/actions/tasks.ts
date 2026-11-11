"use server"

import { revalidatePath } from "next/cache"
import { getRoomAccess, requireUser } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { answerRequestsAs } from "@/lib/answer-requests"
import { mutateTaskInOrchestrator } from "@/lib/orchestrator"
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

export async function answerTaskRequestAction(input: Parameters<typeof answerRequestsAs>[1]): Promise<ActionResult> {
  const user = await requireUser(`/${input.orgSlug}`)
  const result = await answerRequestsAs({ user }, input)
  if (result.ok) revalidatePath(`/${input.orgSlug}`, "layout")
  return result
}
