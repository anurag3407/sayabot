"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { getOrgAccess, requireUser } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  adminRoomAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  optionalField,
  revalidateOrg,
} from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

const roomKindSchema = z.enum(["public", "private", "dm"])
const turnModeSchema = z.enum(["mentions", "debate", "moderated"])

export async function createRoom(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const user = await requireUser(`/${orgSlug}`)
  const access = await getOrgAccess(orgSlug)
  if (!access) return fail("Organization not found")
  const nameInput = field(formData, "name")
  const kindParsed = roomKindSchema.safeParse(field(formData, "kind") || "private")
  const memberId = field(formData, "memberId")
  if (!kindParsed.success) return fail("Choose a room kind")
  if (nameInput.length > 60) return fail("Room name is too long")
  const kind = kindParsed.data
  if (kind === "dm" && !memberId) return fail("Choose a person for the direct message")
  if (kind === "dm" && memberId === user.id) return fail("Choose someone other than yourself")

  const admin = createAdminClient()
  let name = nameInput
  if (kind === "dm") {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", [user.id, memberId])
    const other = profiles?.find((p) => p.id === memberId)?.display_name ?? "direct message"
    const mine = profiles?.find((p) => p.id === user.id)?.display_name ?? "you"
    name = `${mine} / ${other}`
  }
  if (!name) return fail("Give the room a name")
  if (kind !== "dm" && memberId) {
    const { data: member } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", access.org.id)
      .eq("user_id", memberId)
      .maybeSingle()
    if (!member) return fail("That person is not in this organization")
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("preferences")
    .eq("id", user.id)
    .maybeSingle()
  const preferredZone =
    typeof profile?.preferences?.timezone === "string" ? profile.preferences.timezone : null
  let timezone = preferredZone ?? "UTC"
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date())
  } catch {
    timezone = "UTC"
  }

  const { data: room, error } = await admin
    .from("rooms")
    .insert({
      org_id: access.org.id,
      name,
      kind,
      turn_mode: "mentions",
      timezone,
      created_by: user.id,
    })
    .select("id")
    .single()
  if (error || !room) return fail(errorMessage(error) || "Could not create the room")

  const memberRows: { room_id: string; user_id: string; role: "admin" | "member" }[] = [
    { room_id: room.id, user_id: user.id, role: "admin" },
  ]
  if (memberId) memberRows.push({ room_id: room.id, user_id: memberId, role: "member" })
  const { error: memberError } = await admin.from("room_members").insert(memberRows)
  if (memberError) {
    await admin.from("rooms").delete().eq("id", room.id)
    return fail("Could not add room members")
  }
  if (kind !== "dm") {
    await admin.from("room_schedules").insert({ room_id: room.id, timezone })
  }
  await admin.from("room_reads").insert(
    memberRows.map((member) => ({
      room_id: room.id,
      user_id: member.user_id,
      last_read_at: new Date().toISOString(),
    })),
  )
  await audit({
    orgId: access.org.id,
    actorId: user.id,
    action: "room.created",
    target: room.id,
    metadata: { name, kind },
  })
  revalidateOrg(orgSlug)
  redirect(`/${orgSlug}/r/${room.id}`)
}

export async function updateRoomSettings(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const check = await adminRoomAccess(orgSlug, roomId)
  if ("error" in check) return fail(check.error)
  const { access } = check
  // The name lives in the "Room" form now; a form without it keeps the current name.
  const name = formData.has("name") ? field(formData, "name") : access.room.name
  const turnModeParsed = turnModeSchema.safeParse(field(formData, "turnMode"))
  const turnCapParsed = z.coerce.number().int().min(1).max(10).safeParse(field(formData, "turnCap"))
  const rpmRaw = optionalField(formData, "rpmLimit")
  const budgetRaw = optionalField(formData, "dailyBudgetUsd")
  const directive = optionalField(formData, "systemDirective")
  const rpmParsed = rpmRaw ? z.coerce.number().int().min(1).max(1000).safeParse(rpmRaw) : null
  const budgetParsed = budgetRaw
    ? z.coerce.number().min(0).max(1_000_000).safeParse(budgetRaw)
    : null
  if (name.length < 1 || name.length > 60) return fail("Room name must be 1 to 60 characters")
  if (!turnModeParsed.success) return fail("Choose a valid turn mode")
  if (!turnCapParsed.success) return fail("Turn cap must be between 1 and 10")
  if (rpmParsed && !rpmParsed.success) return fail("RPM limit must be between 1 and 1000")
  if (budgetParsed && !budgetParsed.success) return fail("Budget must be a non-negative number")
  if (directive && directive.length > 4_000) {
    return fail("Keep the room directive under 4,000 characters")
  }

  const admin = createAdminClient()
  const { data: roomAgents } = await admin
    .from("room_agents")
    .select("agent_id")
    .eq("room_id", roomId)
  const roomAgentIds = new Set((roomAgents ?? []).map((r) => r.agent_id))
  const moderatorAgentId = optionalField(formData, "moderatorAgentId")
  if (moderatorAgentId) {
    if (!roomAgentIds.has(moderatorAgentId)) return fail("The lead agent must be an agent in this room")
    const { data: lead } = await admin
      .from("agents")
      .select("kind")
      .eq("id", moderatorAgentId)
      .maybeSingle()
    if (lead?.kind !== "llm") {
      return fail("The lead agent must be one made in Sayabot. Invited apps can't lead a room.")
    }
  }
  if (turnModeParsed.data === "moderated" && !moderatorAgentId) {
    return fail("Choose a lead agent, or pick another way for agents to reply")
  }
  let debateOrder: string[] = []
  const orderRaw = field(formData, "debateOrder")
  if (orderRaw) {
    try {
      const parsed = JSON.parse(orderRaw) as unknown
      if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string")) {
        return fail("Invalid debate order")
      }
      debateOrder = (parsed as string[]).filter((id) => roomAgentIds.has(id))
    } catch {
      return fail("Invalid debate order")
    }
  }

  const { error } = await admin
    .from("rooms")
    .update({
      name,
      turn_mode: turnModeParsed.data,
      system_directive: directive,
      turn_cap: turnCapParsed.data,
      rpm_limit: rpmParsed?.success ? rpmParsed.data : null,
      daily_budget_usd: budgetParsed?.success ? budgetParsed.data : null,
      moderator_agent_id: moderatorAgentId,
      debate_order: debateOrder,
    })
    .eq("id", roomId)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: access.org.id,
    actorId: access.user.id,
    action: "room.settings_changed",
    target: roomId,
    metadata: { name, turn_mode: turnModeParsed.data },
  })
  revalidateOrg(orgSlug)
  return ok("Room settings saved")
}

/** Room basics: its name and, for group rooms, who can see it (private or public). */
export async function updateRoomBasics(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const check = await adminRoomAccess(orgSlug, roomId)
  if ("error" in check) return fail(check.error)
  const { access } = check
  const name = field(formData, "name")
  if (name.length < 1 || name.length > 60) return fail("Room name must be 1 to 60 characters")
  const update: { name: string; kind?: "public" | "private" } = { name }
  if (access.room.kind !== "dm" && formData.has("kind")) {
    const kind = z.enum(["public", "private"]).safeParse(field(formData, "kind"))
    if (!kind.success) return fail("Choose who can see the room")
    update.kind = kind.data
  }
  const { error } = await createAdminClient().from("rooms").update(update).eq("id", roomId)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: access.org.id,
    actorId: access.user.id,
    action: "room.settings_changed",
    target: roomId,
    metadata: update,
  })
  revalidateOrg(orgSlug)
  return ok("Room saved")
}

export async function addRoomMember(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const memberId = field(formData, "memberId")
  const check = await adminRoomAccess(orgSlug, roomId)
  if ("error" in check) return fail(check.error)
  if (!z.string().uuid().safeParse(memberId).success) return fail("Choose a person")
  const admin = createAdminClient()
  const { data: member } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", check.access.org.id)
    .eq("user_id", memberId)
    .maybeSingle()
  if (!member) return fail("That person is not in this workspace")
  const { data: existing } = await admin
    .from("room_members")
    .select("user_id")
    .eq("room_id", roomId)
    .eq("user_id", memberId)
    .maybeSingle()
  if (existing) return fail("That person is already in the room")
  const { error } = await admin
    .from("room_members")
    .insert({ room_id: roomId, user_id: memberId, role: "member" })
  if (error) return fail(errorMessage(error))
  await admin.from("room_reads").upsert(
    { user_id: memberId, room_id: roomId, last_read_at: new Date().toISOString() },
    { onConflict: "user_id,room_id" },
  )
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "room.member_added",
    target: roomId,
    metadata: { memberId },
  })
  revalidateOrg(orgSlug)
  return ok("Person added to the room")
}

export async function removeRoomMember(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const memberId = field(formData, "memberId")
  const check = await adminRoomAccess(orgSlug, roomId)
  if ("error" in check) return fail(check.error)
  if (!z.string().uuid().safeParse(memberId).success) return fail("Choose a person")
  const admin = createAdminClient()
  const { data: target } = await admin
    .from("room_members")
    .select("user_id, role")
    .eq("room_id", roomId)
    .eq("user_id", memberId)
    .maybeSingle()
  if (!target) return fail("That person is not in the room")
  if (target.role === "admin") {
    const { count } = await admin
      .from("room_members")
      .select("user_id", { count: "exact", head: true })
      .eq("room_id", roomId)
      .eq("role", "admin")
    if ((count ?? 0) <= 1) return fail("Add another room admin before removing this one")
  }
  const { error } = await admin
    .from("room_members")
    .delete()
    .eq("room_id", roomId)
    .eq("user_id", memberId)
  if (error) return fail(errorMessage(error))
  await admin.from("room_reads").delete().eq("room_id", roomId).eq("user_id", memberId)
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "room.member_removed",
    target: roomId,
    metadata: { memberId },
  })
  revalidateOrg(orgSlug)
  return ok("Person removed from the room")
}

export async function addAgentToRoom(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const agentId = field(formData, "agentId")
  const check = await adminRoomAccess(orgSlug, roomId)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from("agents")
    .select("id, org_id, handle")
    .eq("id", agentId)
    .maybeSingle()
  if (!agent || agent.org_id !== check.access.org.id) return fail("Agent not found in this organization")
  const { data: existing } = await admin
    .from("room_agents")
    .select("agent_id")
    .eq("room_id", roomId)
    .eq("agent_id", agentId)
    .maybeSingle()
  if (existing) return fail(`@${agent.handle} is already in this room`)
  const { data: last } = await admin
    .from("room_agents")
    .select("position")
    .eq("room_id", roomId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle()
  const { error } = await admin
    .from("room_agents")
    .insert({ room_id: roomId, agent_id: agentId, position: (last?.position ?? -1) + 1 })
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "room.agent_added",
    target: roomId,
    metadata: { agentId },
  })
  revalidateOrg(orgSlug)
  return ok(`@${agent.handle} added`)
}

export async function removeAgentFromRoom(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const agentId = field(formData, "agentId")
  const check = await adminRoomAccess(orgSlug, roomId)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: room } = await admin
    .from("rooms")
    .select("moderator_agent_id")
    .eq("id", roomId)
    .single()
  if (room?.moderator_agent_id === agentId) {
    await admin.from("rooms").update({ moderator_agent_id: null }).eq("id", roomId)
  }
  const { error } = await admin
    .from("room_agents")
    .delete()
    .eq("room_id", roomId)
    .eq("agent_id", agentId)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "room.agent_removed",
    target: roomId,
    metadata: { agentId },
  })
  revalidateOrg(orgSlug)
  return ok("Agent removed")
}

export async function deleteRoomAction(input: {
  orgSlug: string
  roomId: string
}): Promise<ActionResult> {
  const check = await adminRoomAccess(input.orgSlug, input.roomId)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { error } = await admin.from("rooms").delete().eq("id", input.roomId)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "room.deleted",
    target: input.roomId,
    metadata: { name: check.access.room.name },
  })
  revalidateOrg(input.orgSlug)
  return ok("Room deleted")
}
