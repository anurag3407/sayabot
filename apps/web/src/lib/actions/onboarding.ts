"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { formatMinutes, parseTimeToMinutes } from "@sayabot/core"
import { requireUser } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { queueRoomMessage } from "@/lib/orchestrator"
import { ensureSayaAgent } from "@/lib/saya"
import {
  adminRoomAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  uniqueOrgSlug,
} from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date())
    return true
  } catch {
    return false
  }
}

export async function setupWorkspaceAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser("/onboarding")
  const roomName = field(formData, "roomName")
  const workspaceName = field(formData, "workspaceName") || roomName
  const timezone = field(formData, "timezone") || "UTC"
  if (workspaceName.length < 2 || workspaceName.length > 60) {
    return fail("Workspace name must be 2 to 60 characters")
  }
  if (roomName.length < 1 || roomName.length > 60) {
    return fail("Room name must be 1 to 60 characters")
  }
  if (!validTimeZone(timezone)) return fail("Choose a valid time zone")

  const admin = createAdminClient()
  const { data: memberships } = await admin
    .from("org_members")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
  if (memberships?.length) return fail("You already have a workspace")

  const slug = await uniqueOrgSlug(workspaceName)
  const { data: org, error: orgError } = await admin
    .from("orgs")
    .insert({ name: workspaceName, slug })
    .select("id, slug")
    .single()
  if (orgError || !org) return fail(errorMessage(orgError) || "Could not create the workspace")

  try {
    const { error: memberError } = await admin
      .from("org_members")
      .insert({ org_id: org.id, user_id: user.id, role: "owner" })
    if (memberError) throw new Error(memberError.message)

    const { data: room, error: roomError } = await admin
      .from("rooms")
      .insert({
        org_id: org.id,
        name: roomName,
        kind: "private",
        turn_mode: "mentions",
        turn_cap: 3,
        timezone,
        created_by: user.id,
      })
      .select("id")
      .single()
    if (roomError || !room) throw new Error(roomError?.message ?? "Could not create the room")

    const { error: roomMemberError } = await admin.from("room_members").insert({
      room_id: room.id,
      user_id: user.id,
      role: "admin",
    })
    if (roomMemberError) throw new Error(roomMemberError.message)

    await admin
      .from("room_reads")
      .upsert(
        { user_id: user.id, room_id: room.id, last_read_at: new Date().toISOString() },
        { onConflict: "user_id,room_id" },
      )
    await admin
      .from("room_schedules")
      .upsert({ room_id: room.id, timezone }, { onConflict: "room_id" })
    const { data: profile } = await admin
      .from("profiles")
      .select("preferences")
      .eq("id", user.id)
      .maybeSingle()
    await admin
      .from("profiles")
      .update({
        preferences: {
          ...((profile?.preferences as Record<string, unknown>) ?? {}),
          timezone,
          onboarding: { orgSlug: org.slug, roomId: room.id },
        },
      })
      .eq("id", user.id)
    await admin.from("canvases").insert({
      room_id: room.id,
      kind: "markdown",
      title: "Room notes",
      snapshot_text: `# ${roomName}\n\n`,
      created_by: user.id,
    })
    // The workspace orchestrator is part of a finished workspace, not an optional extra. A
    // failure here must not roll the workspace back, so it is logged and the user keeps their
    // room; the next room created by Saya re-runs the same idempotent ensure.
    try {
      await ensureSayaAgent({ orgId: org.id, userId: user.id, roomId: room.id }, admin)
    } catch (error) {
      console.warn("[saya] could not create the workspace orchestrator", error)
    }
    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "workspace.onboarding_created",
      target: org.slug,
      metadata: { roomName, timezone },
    })
    return ok("Workspace ready", { orgSlug: org.slug, orgId: org.id, roomId: room.id })
  } catch (error) {
    await admin.from("orgs").delete().eq("id", org.id)
    return fail(errorMessage(error))
  }
}

export async function saveRoomScheduleAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const check = await adminRoomAccess(orgSlug, roomId)
  if ("error" in check) return fail(check.error)
  if (check.access.room.kind === "dm") {
    return fail("Direct chats do not run meetings or check-ins")
  }
  const timezone = field(formData, "timezone") || "UTC"
  if (!validTimeZone(timezone)) return fail("Choose a valid time zone")
  const morningStart = parseTimeToMinutes(field(formData, "morningStart") || "09:00")
  const morningEnd = parseTimeToMinutes(field(formData, "morningEnd") || "09:30")
  const eveningStart = parseTimeToMinutes(field(formData, "eveningStart") || "17:00")
  const eveningEnd = parseTimeToMinutes(field(formData, "eveningEnd") || "17:30")
  const checkinStart = parseTimeToMinutes(field(formData, "checkinStart") || "09:00")
  const checkinEnd = parseTimeToMinutes(field(formData, "checkinEnd") || "17:30")
  const interval = z.coerce
    .number()
    .int()
    .min(15)
    .max(480)
    .safeParse(field(formData, "checkinInterval") || "60")
  const duration = z.coerce
    .number()
    .int()
    .min(5)
    .max(60)
    .safeParse(field(formData, "checkinDuration") || "10")
  if (
    morningStart === null ||
    morningEnd === null ||
    eveningStart === null ||
    eveningEnd === null
  ) {
    return fail("Use valid meeting times")
  }
  if (morningEnd <= morningStart || eveningEnd <= eveningStart) {
    return fail("Each meeting must end after it starts")
  }
  if (checkinStart === null || checkinEnd === null) return fail("Use valid check-in times")
  if (!interval.success || !duration.success)
    return fail("Choose a valid check-in interval and length")
  const checkinMode = field(formData, "checkinMode") === "digest" ? "digest" : "stream"
  const admin = createAdminClient()
  const { error } = await admin.from("room_schedules").upsert(
    {
      room_id: roomId,
      timezone,
      morning_start_minutes: morningStart,
      morning_end_minutes: morningEnd,
      evening_start_minutes: eveningStart,
      evening_end_minutes: eveningEnd,
      checkins_enabled: field(formData, "checkinsEnabled") === "on",
      checkin_interval_minutes: interval.data,
      checkin_start_minutes: checkinStart,
      checkin_end_minutes: checkinEnd,
      checkin_duration_minutes: duration.data,
      checkin_mode: checkinMode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "room_id" },
  )
  if (error) return fail(errorMessage(error))
  await admin.from("rooms").update({ timezone }).eq("id", roomId)
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "room.schedule_changed",
    target: roomId,
    metadata: {
      morning: `${formatMinutes(morningStart)}-${formatMinutes(morningEnd)}`,
      evening: `${formatMinutes(eveningStart)}-${formatMinutes(eveningEnd)}`,
      checkins: field(formData, "checkinsEnabled") === "on",
    },
  })
  revalidatePath(`/${orgSlug}`, "layout")
  return ok("Schedule saved")
}

export async function finishOnboardingAction(
  orgSlug: string,
  roomId: string,
): Promise<ActionResult> {
  const check = await adminRoomAccess(orgSlug, roomId)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from("profiles")
    .select("preferences")
    .eq("id", check.access.user.id)
    .maybeSingle()
  const { onboarding: _finished, ...preferences } =
    (profile?.preferences as Record<string, unknown> | null) ?? {}
  await admin.from("profiles").update({ preferences }).eq("id", check.access.user.id)
  const { data: existing } = await admin
    .from("messages")
    .select("id")
    .eq("room_id", roomId)
    .contains("metadata", { onboarding: true })
    .limit(1)
  if (existing?.length) {
    return ok("Room ready", { path: `/${orgSlug}/r/${roomId}` })
  }
  const { data: agents } = await admin.from("room_agents").select("agent_id").eq("room_id", roomId)
  const room = check.access.room
  let messageId: string | null = null
  if (agents?.length) {
    const content = `@all_bots Welcome to ${room.name}. Introduce yourself in one sentence and say what you can help with.`
    const { data: message } = await admin
      .from("messages")
      .insert({
        room_id: roomId,
        sender_type: "human",
        sender_id: check.access.user.id,
        content,
        status: "complete",
        mentions: ["all_bots"],
        metadata: { onboarding: true },
      })
      .select("id")
      .single()
    messageId = message?.id ?? null
    if (messageId) await queueRoomMessage(roomId, messageId)
  } else {
    await admin.from("messages").insert({
      room_id: roomId,
      sender_type: "system",
      sender_id: null,
      content: `Welcome to ${room.name}.`,
      status: "complete",
      metadata: { onboarding: true },
    })
  }
  await admin.from("room_reads").upsert(
    {
      user_id: check.access.user.id,
      room_id: roomId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "user_id,room_id" },
  )
  return ok("Room ready", {
    path: `/${orgSlug}/r/${roomId}`,
    queued: Boolean(messageId),
  })
}
