"use server"

import { revalidatePath } from "next/cache"
import { getOrgAccess, getRoomAccess, requireUser } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureBotDmRoom } from "@/lib/bot-dm"
import { audit, errorMessage, fail, ok } from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

export async function markRoomReadAction(orgSlug: string, roomId: string): Promise<ActionResult> {
  const access = await getRoomAccess(orgSlug, roomId)
  if (!access) return fail("Room not found")
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("room_reads")
    .select("*")
    .eq("user_id", access.user.id)
    .eq("room_id", roomId)
    .maybeSingle()
  const { error } = await admin.from("room_reads").upsert(
    {
      user_id: access.user.id,
      room_id: roomId,
      last_read_at: new Date().toISOString(),
      pinned: existing?.pinned ?? false,
      muted_until: existing?.muted_until ?? null,
      archived: existing?.archived ?? false,
    },
    { onConflict: "user_id,room_id" },
  )
  if (error) return fail(errorMessage(error))
  return ok()
}

export async function setChatPreferenceAction(input: {
  orgSlug: string
  roomId: string
  action: "pin" | "unpin" | "mute" | "unmute" | "archive" | "unarchive" | "mark_unread"
  duration?: "8h" | "1w" | "always"
}): Promise<ActionResult> {
  const access = await getRoomAccess(input.orgSlug, input.roomId)
  if (!access) return fail("Room not found")
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("room_reads")
    .select("*")
    .eq("user_id", access.user.id)
    .eq("room_id", input.roomId)
    .maybeSingle()
  const now = new Date()
  const values = {
    last_read_at: existing?.last_read_at ?? now.toISOString(),
    pinned: existing?.pinned ?? false,
    muted_until: existing?.muted_until ?? null,
    archived: existing?.archived ?? false,
  }
  if (input.action === "pin") {
    const { data: pinned } = await admin
      .from("room_reads")
      .select("room_id")
      .eq("user_id", access.user.id)
      .eq("pinned", true)
    if ((pinned?.length ?? 0) >= 3) return fail("You can pin up to 3 chats")
    values.pinned = true
  }
  if (input.action === "unpin") values.pinned = false
  if (input.action === "mute") {
    const until =
      input.duration === "always"
        ? new Date("9999-12-31T23:59:59Z")
        : new Date(now.getTime() + (input.duration === "1w" ? 7 * 86_400_000 : 8 * 3_600_000))
    values.muted_until = until.toISOString()
  }
  if (input.action === "unmute") values.muted_until = null
  if (input.action === "archive") values.archived = true
  if (input.action === "unarchive") values.archived = false
  if (input.action === "mark_unread") {
    const { data: latest } = await admin
      .from("messages")
      .select("created_at")
      .eq("room_id", input.roomId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    values.last_read_at = latest?.created_at
      ? new Date(new Date(latest.created_at).getTime() - 1_000).toISOString()
      : new Date(now.getTime() - 1_000).toISOString()
  }
  const { error } = await admin.from("room_reads").upsert(
    { user_id: access.user.id, room_id: input.roomId, ...values },
    { onConflict: "user_id,room_id" },
  )
  if (error) return fail(errorMessage(error))
  revalidatePath(`/${input.orgSlug}`, "layout")
  return ok("Chat updated")
}

export async function openBotDmAction(orgSlug: string, agentId: string): Promise<ActionResult> {
  const user = await requireUser(`/${orgSlug}`)
  const access = await getOrgAccess(orgSlug)
  if (!access) return fail("Workspace not found")
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from("agents")
    .select("id, org_id, display_name, handle")
    .eq("id", agentId)
    .maybeSingle()
  if (!agent || agent.org_id !== access.org.id) return fail("Agent not found")
  try {
    const roomId = await ensureBotDmRoom({
      orgId: access.org.id,
      userId: user.id,
      agentId: agent.id,
      agentName: agent.display_name,
    })
    await audit({
      orgId: access.org.id,
      actorId: user.id,
      action: "bot_dm.opened",
      target: roomId,
      metadata: { agent: agent.handle },
    })
    revalidatePath(`/${orgSlug}`, "layout")
    return ok("Bot chat ready", { path: `/${orgSlug}/r/${roomId}` })
  } catch (error) {
    return fail(errorMessage(error))
  }
}

/**
 * How bots in this chat ask before acting, picked from the composer. Either mode keeps risky
 * steps behind a person's OK; "review_all" also holds reading and searching for approval.
 * Anyone in the chat (or a workspace admin) may change it.
 */
export async function setRoomExecutionModeAction(input: {
  orgSlug: string
  roomId: string
  mode: "ask_risky" | "review_all"
}): Promise<ActionResult> {
  if (input.mode !== "ask_risky" && input.mode !== "review_all") return fail("Unknown mode")
  const access = await getRoomAccess(input.orgSlug, input.roomId)
  if (!access) return fail("Room not found")
  if (access.roomRole === null && !access.canAdmin) return fail("Only people in this chat can change this")
  const { error } = await createAdminClient()
    .from("rooms")
    .update({ execution_mode: input.mode })
    .eq("id", input.roomId)
    .eq("org_id", access.org.id)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: access.org.id,
    actorId: access.user.id,
    action: "room.execution_mode_set",
    target: input.roomId,
    metadata: { mode: input.mode },
  })
  return ok(input.mode === "review_all" ? "Bots will ask before every step here" : "Bots will ask before risky steps")
}
