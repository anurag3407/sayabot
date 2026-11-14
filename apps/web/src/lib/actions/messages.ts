"use server"

import { getRoomAccess } from "@/lib/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { macApprovalBlock, readMacMarker, rememberMacAllow } from "@/lib/mac-runner"
import { insertHumanMessage } from "@/lib/message-send"
import { queueRoomMessage, stopRunInOrchestrator } from "@/lib/orchestrator"
import { audit, fail, ok } from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

export async function sendMessage(input: {
  orgSlug: string
  roomId: string
  content: string
  threadRootId?: string | null
  clientId?: string | null
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail("Your session expired. Sign in again.")
  const access = await getRoomAccess(input.orgSlug, input.roomId)
  if (!access) return fail("Room not found")
  const inserted = await insertHumanMessage({
    supabase,
    userId: user.id,
    roomId: input.roomId,
    content: input.content,
    threadRootId: input.threadRootId ?? null,
    clientId: input.clientId ?? null,
  })
  if (!inserted.ok) return fail(inserted.error)
  const queued = await queueRoomMessage(input.roomId, inserted.id)
  return {
    ok: true,
    data: { messageId: inserted.id },
    warning: queued.ok ? undefined : "Message saved, but agents could not be reached, so they will not reply to it.",
  }
}

/** Runs a failed turn again from the human message that started it. */
export async function retryMessageAction(input: {
  orgSlug: string
  roomId: string
  messageId: string
}): Promise<ActionResult> {
  const access = await getRoomAccess(input.orgSlug, input.roomId)
  if (!access) return fail("Room not found")
  const supabase = await createSupabaseServerClient()
  const { data: failed } = await supabase
    .from("messages")
    .select("id, thread_root_id, created_at")
    .eq("id", input.messageId)
    .eq("room_id", input.roomId)
    .maybeSingle()
  if (!failed) return fail("Message not found")
  let trigger = supabase
    .from("messages")
    .select("id")
    .eq("room_id", input.roomId)
    .eq("sender_type", "human")
    .lte("created_at", failed.created_at)
  trigger = failed.thread_root_id
    ? trigger.eq("thread_root_id", failed.thread_root_id)
    : trigger.is("thread_root_id", null)
  const { data: source } = await trigger
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!source) return fail("There is no earlier message to retry from")
  const queued = await queueRoomMessage(input.roomId, source.id)
  if (!queued.ok) return fail("The agent service could not be reached. Try again in a moment.")
  return ok("Retrying")
}

export async function stopGeneration(input: {
  orgSlug: string
  roomId: string
  runId: string
}): Promise<ActionResult> {
  const access = await getRoomAccess(input.orgSlug, input.roomId)
  if (!access) return fail("Room not found")
  const supabase = await createSupabaseServerClient()
  const { data: run } = await supabase
    .from("agent_runs")
    .select("id")
    .eq("id", input.runId)
    .eq("room_id", input.roomId)
    .maybeSingle()
  if (!run) return fail("Run not found in this room")
  const result = await stopRunInOrchestrator(input.runId)
  if (!result.ok) {
    return fail("The agent service could not be reached, so the agent is still running.")
  }
  return ok("Stopping")
}

export async function resolveToolCall(input: {
  orgSlug: string
  toolCallId: string
  decision: "approved" | "rejected"
  /** Mac runs: also allow this kind of step from now on, without asking. */
  remember?: boolean
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail("Your session expired. Sign in again.")
  const { data: toolCall } = await supabase
    .from("tool_calls")
    .select("id, room_id, status, tool_name, args")
    .eq("id", input.toolCallId)
    .maybeSingle()
  if (!toolCall) return fail("Tool call not found")
  const access = await getRoomAccess(input.orgSlug, toolCall.room_id)
  if (!access) return fail("Room not found")
  // A step on someone's Mac is theirs to allow; anything else needs a room admin.
  const macBlock = await macApprovalBlock(toolCall.args, user.id)
  if (macBlock) return fail(macBlock)
  const isMac = Boolean(readMacMarker(toolCall.args))
  if (!isMac && !access.canAdmin) return fail("Only room admins can approve tool calls")
  if (toolCall.status !== "pending_approval") return fail("This tool call is no longer pending")
  let remembered = false
  if (isMac && input.remember && input.decision === "approved") {
    const saved = await rememberMacAllow(toolCall.args, toolCall.tool_name)
    if (!saved.ok) return fail(saved.error)
    remembered = true
  }
  const admin = createAdminClient()
  const { error } = await admin
    .from("tool_calls")
    .update({
      status: input.decision,
      approved_by: user.id,
      resolved_at: new Date().toISOString(),
      ...(remembered
        ? { args: { ...(toolCall.args as Record<string, unknown>), _remembered: true } }
        : {}),
    })
    .eq("id", input.toolCallId)
    .eq("status", "pending_approval")
  if (error) return fail(error.message)
  await admin.rpc("notify_tool_resolution", {
    p_tool_call: input.toolCallId,
    p_status: input.decision,
  })
  await audit({
    orgId: access.org.id,
    actorId: user.id,
    action: `tool.${input.decision}`,
    target: input.toolCallId,
    metadata: { tool: toolCall.tool_name, roomId: toolCall.room_id },
  })
  if (remembered) return ok("Allowed, and won't ask again for this")
  return ok(input.decision === "approved" ? "Tool approved" : "Tool rejected")
}
