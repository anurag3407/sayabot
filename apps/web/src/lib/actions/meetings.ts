"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { queueRoomMessage } from "@/lib/orchestrator"
import { adminRoomAccess, audit, errorMessage, fail, field, ok } from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

function meetingPrompt(args: {
  kind: "meeting" | "checkin"
  title: string
  agenda: string
  wake?: boolean
}): string {
  const lead = args.wake
    ? `Wake up: the meeting "${args.title}" is live.`
    : args.kind === "checkin"
      ? `Check-in: ${args.title}.`
      : `Meeting started: ${args.title}.`
  const agenda = args.agenda.trim() ? `\n\nAgenda: ${args.agenda.trim()}` : ""
  return `${lead}${agenda}\n\nAgents: report what you have done, what you are doing next, and anything you need from the humans.`
}

async function postMeetingPrompt(args: {
  orgSlug: string
  roomId: string
  meetingId: string
  kind: "meeting" | "checkin"
  title: string
  agenda: string
  wake?: boolean
  userId: string
}): Promise<{ messageId: string | null; queued: boolean }> {
  const admin = createAdminClient()
  const { data: agents } = await admin
    .from("room_agents")
    .select("agent_id")
    .eq("room_id", args.roomId)
  if (!agents?.length) {
    await admin.from("messages").insert({
      room_id: args.roomId,
      sender_type: "system",
      sender_id: null,
      content: `${args.kind === "checkin" ? "Check-in" : "Meeting"} started: ${args.title}. No agents are in this room yet.`,
      status: "complete",
      metadata: { meetingId: args.meetingId, automated: true },
    })
    return { messageId: null, queued: false }
  }
  const content = meetingPrompt({
    kind: args.kind,
    title: args.title,
    agenda: args.agenda,
    wake: args.wake,
  })
  const { data: message, error } = await admin
    .from("messages")
    .insert({
      room_id: args.roomId,
      sender_type: "human",
      sender_id: args.userId,
      content,
      status: "complete",
      mentions: ["all_bots"],
      metadata: {
        meetingId: args.meetingId,
        automated: true,
        startMeeting: !args.wake,
      },
    })
    .select("id")
    .single()
  if (error || !message) throw new Error(error?.message ?? "Could not post the meeting prompt")
  const queued = await queueRoomMessage(args.roomId, message.id)
  return { messageId: message.id, queued: queued.ok }
}

export async function startMeetingNowAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const check = await adminRoomAccess(orgSlug, roomId)
  if ("error" in check) return fail(check.error)
  const title = field(formData, "title") || "Meeting"
  const agenda = field(formData, "agenda")
  const duration = z.coerce
    .number()
    .int()
    .min(5)
    .max(240)
    .safeParse(field(formData, "durationMinutes") || "15")
  if (title.length > 80) return fail("Keep the meeting title under 80 characters")
  if (agenda.length > 4_000) return fail("Keep the agenda under 4,000 characters")
  if (!duration.success) return fail("Choose a meeting length between 5 and 240 minutes")
  const now = new Date()
  const endsAt = new Date(now.getTime() + duration.data * 60_000)
  const admin = createAdminClient()
  const { data: meeting, error } = await admin
    .from("meetings")
    .insert({
      org_id: check.access.org.id,
      room_id: roomId,
      kind: "meeting",
      title,
      agenda,
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "active",
      created_by: check.access.user.id,
      metadata: { slot: "manual" },
    })
    .select("id")
    .single()
  if (error || !meeting) return fail(errorMessage(error) || "Could not start the meeting")
  try {
    const prompt = await postMeetingPrompt({
      orgSlug,
      roomId,
      meetingId: meeting.id,
      kind: "meeting",
      title,
      agenda,
      userId: check.access.user.id,
    })
    if (prompt.messageId) {
      await admin
        .from("meetings")
        .update({ prompt_message_id: prompt.messageId })
        .eq("id", meeting.id)
    }
  } catch (error) {
    await admin.from("meetings").update({ status: "ended" }).eq("id", meeting.id)
    return fail(errorMessage(error))
  }
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "meeting.started",
    target: meeting.id,
    metadata: { title, duration: duration.data },
  })
  revalidatePath(`/${orgSlug}`, "layout")
  return ok("Meeting started", { meetingId: meeting.id, path: `/${orgSlug}/r/${roomId}` })
}

export async function startScheduledMeetingAction(
  orgSlug: string,
  meetingId: string,
): Promise<ActionResult> {
  const admin = createAdminClient()
  const { data: meeting } = await admin
    .from("meetings")
    .select("*")
    .eq("id", meetingId)
    .maybeSingle()
  if (!meeting) return fail("Meeting not found")
  const check = await adminRoomAccess(orgSlug, meeting.room_id)
  if ("error" in check) return fail(check.error)
  if (meeting.status !== "scheduled") return fail("This meeting is no longer scheduled")
  const now = new Date()
  const { data: claimed, error } = await admin
    .from("meetings")
    .update({ status: "active", starts_at: now.toISOString() })
    .eq("id", meetingId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle()
  if (error) return fail(errorMessage(error))
  if (!claimed) return fail("This meeting has already started or was canceled")
  try {
    const prompt = await postMeetingPrompt({
      orgSlug,
      roomId: meeting.room_id,
      meetingId,
      kind: meeting.kind,
      title: meeting.title,
      agenda: meeting.agenda,
      userId: check.access.user.id,
    })
    if (prompt.messageId) {
      await admin
        .from("meetings")
        .update({ prompt_message_id: prompt.messageId })
        .eq("id", meetingId)
    }
  } catch (error) {
    await admin.from("meetings").update({ status: "scheduled" }).eq("id", meetingId)
    return fail(errorMessage(error))
  }
  revalidatePath(`/${orgSlug}`, "layout")
  return ok("Meeting started")
}

export async function endMeetingAction(orgSlug: string, meetingId: string): Promise<ActionResult> {
  const admin = createAdminClient()
  const { data: meeting } = await admin
    .from("meetings")
    .select("*")
    .eq("id", meetingId)
    .maybeSingle()
  if (!meeting) return fail("Meeting not found")
  const check = await adminRoomAccess(orgSlug, meeting.room_id)
  if ("error" in check) return fail(check.error)
  const now = new Date()
  const { data: ended, error } = await admin
    .from("meetings")
    .update({ status: "ended", ends_at: now.toISOString() })
    .eq("id", meetingId)
    .eq("status", "active")
    .select("id")
    .maybeSingle()
  if (error) return fail(errorMessage(error))
  if (!ended) return fail("This meeting is not active")
  await admin.from("messages").insert({
    room_id: meeting.room_id,
    sender_type: "system",
    sender_id: null,
    content: `Meeting ended: ${meeting.title}.`,
    status: "complete",
    metadata: { meetingId, automated: true },
  })
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "meeting.ended",
    target: meetingId,
  })
  revalidatePath(`/${orgSlug}`, "layout")
  return ok("Meeting ended")
}

export async function wakeBotsAction(orgSlug: string, meetingId: string): Promise<ActionResult> {
  const admin = createAdminClient()
  const { data: meeting } = await admin
    .from("meetings")
    .select("*")
    .eq("id", meetingId)
    .maybeSingle()
  if (!meeting) return fail("Meeting not found")
  const check = await adminRoomAccess(orgSlug, meeting.room_id)
  if ("error" in check) return fail(check.error)
  if (meeting.status !== "active") return fail("Start the meeting before waking the bots")
  try {
    await postMeetingPrompt({
      orgSlug,
      roomId: meeting.room_id,
      meetingId,
      kind: meeting.kind,
      title: meeting.title,
      agenda: meeting.agenda,
      wake: true,
      userId: check.access.user.id,
    })
  } catch (error) {
    return fail(errorMessage(error))
  }
  revalidatePath(`/${orgSlug}`, "layout")
  return ok("Wake prompt posted")
}

export async function scheduleMeetingAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const check = await adminRoomAccess(orgSlug, roomId)
  if ("error" in check) return fail(check.error)
  const title = field(formData, "title")
  const agenda = field(formData, "agenda")
  const when = field(formData, "startsAt")
  const duration = z.coerce
    .number()
    .int()
    .min(5)
    .max(240)
    .safeParse(field(formData, "durationMinutes") || "15")
  if (title.length < 2 || title.length > 80) return fail("Give the meeting a short title")
  if (agenda.length > 4_000) return fail("Keep the agenda under 4,000 characters")
  if (!duration.success) return fail("Choose a meeting length between 5 and 240 minutes")
  // A value without a zone would be read in the server's zone, not the user's.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(when)) return fail("Choose a start date and time")
  const startsAt = new Date(when)
  if (Number.isNaN(startsAt.getTime())) return fail("Choose a start date and time")
  if (startsAt.getTime() < Date.now() - 60_000) return fail("Schedule the meeting in the future")
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("meetings")
    .insert({
      org_id: check.access.org.id,
      room_id: roomId,
      kind: "meeting",
      title,
      agenda,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + duration.data * 60_000).toISOString(),
      status: "scheduled",
      created_by: check.access.user.id,
      metadata: { slot: "scheduled" },
    })
    .select("id")
    .single()
  if (error || !data) return fail(errorMessage(error) || "Could not schedule the meeting")
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "meeting.scheduled",
    target: data.id,
    metadata: { title, startsAt: startsAt.toISOString() },
  })
  revalidatePath(`/${orgSlug}`, "layout")
  return ok("Meeting scheduled", { meetingId: data.id })
}
