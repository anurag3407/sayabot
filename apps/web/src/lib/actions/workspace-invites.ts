"use server"

import { generateJoinCode } from "@sayabot/core/server"
import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth"
import { adminOrgAccess, audit, errorMessage, fail, ok, revalidateOrg } from "@/lib/actions/shared"
import { getAppUrl } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"
import { planGate } from "@/lib/plan-limits"
import type { ActionResult } from "@/lib/types"

const LINK_TTL_MS = 24 * 60 * 60 * 1000

function joinUrl(code: string): string {
  return `${getAppUrl().replace(/\/+$/, "")}/join/${code}`
}

async function cleanRoomIds(orgId: string, roomIds: string[] | undefined): Promise<string[]> {
  if (!roomIds?.length) return []
  const { data } = await createAdminClient()
    .from("rooms")
    .select("id")
    .eq("org_id", orgId)
    .neq("kind", "dm")
    .in("id", roomIds)
  return (data ?? []).map((r) => r.id as string)
}

/**
 * "Invite link" (works once, 24 hours) or "Perma link" (never expires). Opening either asks to
 * join; a workspace admin approves. One live permanent link per role: asking again returns it.
 */
export async function createInviteLinkAction(input: {
  orgSlug: string
  kind: "link" | "permanent"
  role: "member" | "admin"
  roomIds?: string[]
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const role = input.role === "admin" ? "admin" : "member"
  const admin = createAdminClient()
  const roomIds = await cleanRoomIds(check.access.org.id, input.roomIds)

  if (input.kind === "permanent" && !roomIds.length) {
    const { data: existing } = await admin
      .from("workspace_invites")
      .select("id, code")
      .eq("org_id", check.access.org.id)
      .eq("kind", "permanent")
      .eq("role", role)
      .is("revoked_at", null)
      .eq("room_ids", "{}")
      .limit(1)
      .maybeSingle()
    if (existing?.code)
      return ok("Link ready", { id: existing.id, url: joinUrl(existing.code), expiresAt: null })
  }

  const code = generateJoinCode()
  const expiresAt = input.kind === "link" ? new Date(Date.now() + LINK_TTL_MS).toISOString() : null
  const { data, error } = await admin
    .from("workspace_invites")
    .insert({
      org_id: check.access.org.id,
      kind: input.kind,
      code,
      role,
      room_ids: roomIds,
      max_uses: input.kind === "link" ? 1 : null,
      created_by: check.access.user.id,
      expires_at: expiresAt,
    })
    .select("id")
    .single()
  if (error || !data) return fail(errorMessage(error) || "Could not make the link")
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: input.kind === "link" ? "invite.link_created" : "invite.permanent_link_created",
    target: data.id,
    metadata: { role, roomIds },
  })
  revalidateOrg(input.orgSlug)
  return ok("Link ready", { id: data.id, url: joinUrl(code), expiresAt })
}

/**
 * Revoke: links stop working at once. An email invite that hasn't been used yet also takes
 * the person back out of the workspace, since they never signed in.
 */
export async function revokeInviteAction(input: {
  orgSlug: string
  inviteId: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: invite } = await admin
    .from("workspace_invites")
    .select("id, org_id, kind, user_id, email")
    .eq("id", input.inviteId)
    .maybeSingle()
  if (!invite || invite.org_id !== check.access.org.id) return fail("Invitation not found")
  await admin
    .from("workspace_invites")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invite.id)

  if (invite.kind === "email" && invite.user_id) {
    const { data: userRes } = await admin.auth.admin.getUserById(invite.user_id)
    if (!userRes?.user?.last_sign_in_at) {
      const { data: rooms } = await admin
        .from("rooms")
        .select("id")
        .eq("org_id", check.access.org.id)
      const roomIds = (rooms ?? []).map((r) => r.id as string)
      if (roomIds.length)
        await admin
          .from("room_members")
          .delete()
          .eq("user_id", invite.user_id)
          .in("room_id", roomIds)
      await admin
        .from("org_members")
        .delete()
        .eq("org_id", check.access.org.id)
        .eq("user_id", invite.user_id)
        .neq("role", "owner")
    }
  }
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "invite.revoked",
    target: invite.id,
    metadata: { kind: invite.kind, email: invite.email },
  })
  revalidateOrg(input.orgSlug)
  return ok("Invitation revoked")
}

export type JoinCheck =
  | {
      ok: true
      inviteId: string
      orgId: string
      orgSlug: string
      orgName: string
      role: string
      roomIds: string[]
      inviterName: string | null
    }
  | { ok: false; reason: string }

/** Shared by the join page (to show the card) and the accept action (to re-check before joining). */
export async function checkJoinCode(code: string): Promise<JoinCheck> {
  if (!/^j_[A-Za-z0-9_-]{16,64}$/.test(code))
    return { ok: false, reason: "This invite link isn't valid." }
  const admin = createAdminClient()
  const { data: invite } = await admin
    .from("workspace_invites")
    .select(
      "id, org_id, kind, role, room_ids, max_uses, use_count, expires_at, revoked_at, created_by",
    )
    .eq("code", code)
    .maybeSingle()
  if (!invite) return { ok: false, reason: "This invite link isn't valid." }
  if (invite.revoked_at)
    return { ok: false, reason: "This invite link was turned off. Ask for a new one." }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "This invite link expired. Ask for a new one." }
  }
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    return { ok: false, reason: "This invite link was already used. Ask for a new one." }
  }
  const { data: org } = await admin
    .from("orgs")
    .select("slug, name")
    .eq("id", invite.org_id)
    .maybeSingle()
  if (!org) return { ok: false, reason: "That workspace no longer exists." }
  let inviterName: string | null = null
  if (invite.created_by) {
    const { data: p } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", invite.created_by)
      .maybeSingle()
    inviterName = p?.display_name ?? null
  }
  return {
    ok: true,
    inviteId: invite.id,
    orgId: invite.org_id,
    orgSlug: org.slug,
    orgName: org.name,
    role: invite.role,
    roomIds: invite.room_ids ?? [],
    inviterName,
  }
}

/** Ask to join. Does not add the person; a workspace admin approves that. */
export async function requestJoinAction(code: string): Promise<ActionResult> {
  const user = await requireUser(`/join/${code}`)
  const check = await checkJoinCode(code)
  if (!check.ok) return fail(check.reason)
  const admin = createAdminClient()

  const { data: member } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", check.orgId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (member) redirect(`/${check.orgSlug}`)

  const { data: invite } = await admin
    .from("workspace_invites")
    .select("max_uses")
    .eq("id", check.inviteId)
    .maybeSingle()
  const { data: rows } = await admin
    .from("workspace_join_requests")
    .select("id, user_id, status")
    .eq("invite_id", check.inviteId)
  const mine = (rows ?? []).find((row) => row.user_id === user.id)
  if (
    invite?.max_uses !== null &&
    invite?.max_uses !== undefined &&
    (rows ?? []).some(
      (row) => row.user_id !== user.id && (row.status === "pending" || row.status === "approved"),
    )
  ) {
    return fail("Someone else is already using this link. Ask for a new one.")
  }
  if (mine?.status === "pending") return ok("Waiting for a workspace admin to approve you.")

  const role = check.role === "admin" ? "admin" : "member"
  if (mine) {
    const { error } = await admin
      .from("workspace_join_requests")
      .update({
        status: "pending",
        role,
        room_ids: check.roomIds,
        decided_by: null,
        decided_at: null,
      })
      .eq("id", mine.id)
    if (error) return fail(errorMessage(error))
  } else {
    const { error } = await admin.from("workspace_join_requests").insert({
      org_id: check.orgId,
      invite_id: check.inviteId,
      user_id: user.id,
      status: "pending",
      role,
      room_ids: check.roomIds,
    })
    if (error) {
      if (error.code === "23505") return ok("Waiting for a workspace admin to approve you.")
      return fail(errorMessage(error))
    }
  }
  await audit({
    orgId: check.orgId,
    actorId: user.id,
    action: "invite.requested",
    target: check.inviteId,
    metadata: { role },
  })
  revalidateOrg(check.orgSlug)
  return ok("Asked to join. A workspace admin has to approve you.")
}

/** Kept so an older client cannot skip approval and join on its own. */
export async function acceptInviteAction(code: string): Promise<ActionResult> {
  return requestJoinAction(code)
}

/** Approve or decline someone who opened an invite link. */
export async function decideJoinRequestAction(input: {
  orgSlug: string
  requestId: string
  approve: boolean
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: request } = await admin
    .from("workspace_join_requests")
    .select("id, org_id, invite_id, user_id, status, role, room_ids")
    .eq("id", input.requestId)
    .maybeSingle()
  if (!request || request.org_id !== check.access.org.id) return fail("That request is gone.")
  if (request.status !== "pending") return fail("That request was already decided.")

  if (!input.approve) {
    const { data: declined } = await admin
      .from("workspace_join_requests")
      .update({
        status: "declined",
        decided_by: check.access.user.id,
        decided_at: new Date().toISOString(),
      })
      .eq("id", request.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle()
    if (!declined) return fail("That request was already decided.")
    await audit({
      orgId: check.access.org.id,
      actorId: check.access.user.id,
      action: "invite.declined",
      target: request.id,
      metadata: { userId: request.user_id },
    })
    revalidateOrg(input.orgSlug)
    return ok("Declined")
  }

  const { data: invite } = await admin
    .from("workspace_invites")
    .select("id, revoked_at, expires_at, max_uses, use_count")
    .eq("id", request.invite_id)
    .maybeSingle()
  if (!invite || invite.revoked_at) return fail("This invite link was turned off.")
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return fail("This invite link expired.")
  }

  const { data: already } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", request.org_id)
    .eq("user_id", request.user_id)
    .maybeSingle()
  let claimedUse = false
  if (!already) {
    const seat = await planGate(request.org_id, "members")
    if (!seat.ok) {
      return fail(
        "This workspace is full on its current plan. Upgrade it in Settings → Plan & billing, then approve.",
      )
    }
    if (invite.max_uses !== null) {
      const { data: claimed } = await admin
        .from("workspace_invites")
        .update({ use_count: (invite.use_count ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq("id", invite.id)
        .eq("use_count", invite.use_count ?? 0)
        .select("id")
        .maybeSingle()
      if (!claimed) return fail("This link was already used.")
      claimedUse = true
    } else {
      await admin
        .from("workspace_invites")
        .update({ use_count: (invite.use_count ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq("id", invite.id)
    }
    const role = request.role === "admin" ? "admin" : "member"
    const { error } = await admin
      .from("org_members")
      .insert({ org_id: request.org_id, user_id: request.user_id, role })
    if (error && error.code !== "23505") {
      if (claimedUse) {
        await admin
          .from("workspace_invites")
          .update({ use_count: invite.use_count ?? 0 })
          .eq("id", invite.id)
      }
      return fail(errorMessage(error))
    }
  }

  const roomIds = ((request.room_ids ?? []) as unknown[]).filter(
    (id): id is string => typeof id === "string",
  )
  if (roomIds.length) {
    await admin.from("room_members").upsert(
      roomIds.map((roomId) => ({
        room_id: roomId,
        user_id: request.user_id,
        role: "member" as const,
      })),
      { onConflict: "room_id,user_id", ignoreDuplicates: true },
    )
    await admin.from("room_reads").upsert(
      roomIds.map((roomId) => ({
        room_id: roomId,
        user_id: request.user_id,
        last_read_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,room_id" },
    )
  }

  const { data: approved } = await admin
    .from("workspace_join_requests")
    .update({
      status: "approved",
      decided_by: check.access.user.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", request.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle()
  if (!approved) return fail("That request was already decided.")
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "invite.approved",
    target: request.id,
    metadata: { userId: request.user_id, role: request.role },
  })
  revalidateOrg(input.orgSlug)
  return ok("Approved. They can open the workspace.")
}
