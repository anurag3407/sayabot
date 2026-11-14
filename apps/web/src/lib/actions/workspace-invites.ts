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
 * "Invite link" (works once, 24 hours) or "Perma link" (never expires, anyone holding it can
 * join). One live permanent link per role: asking again returns the same link.
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
    if (existing?.code) return ok("Link ready", { id: existing.id, url: joinUrl(existing.code), expiresAt: null })
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
export async function revokeInviteAction(input: { orgSlug: string; inviteId: string }): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: invite } = await admin
    .from("workspace_invites")
    .select("id, org_id, kind, user_id, email")
    .eq("id", input.inviteId)
    .maybeSingle()
  if (!invite || invite.org_id !== check.access.org.id) return fail("Invitation not found")
  await admin.from("workspace_invites").update({ revoked_at: new Date().toISOString() }).eq("id", invite.id)

  if (invite.kind === "email" && invite.user_id) {
    const { data: userRes } = await admin.auth.admin.getUserById(invite.user_id)
    if (!userRes?.user?.last_sign_in_at) {
      const { data: rooms } = await admin.from("rooms").select("id").eq("org_id", check.access.org.id)
      const roomIds = (rooms ?? []).map((r) => r.id as string)
      if (roomIds.length) await admin.from("room_members").delete().eq("user_id", invite.user_id).in("room_id", roomIds)
      await admin.from("org_members").delete().eq("org_id", check.access.org.id).eq("user_id", invite.user_id).neq("role", "owner")
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
  | { ok: true; inviteId: string; orgId: string; orgSlug: string; orgName: string; role: string; roomIds: string[]; inviterName: string | null }
  | { ok: false; reason: string }

/** Shared by the join page (to show the card) and the accept action (to re-check before joining). */
export async function checkJoinCode(code: string): Promise<JoinCheck> {
  if (!/^j_[A-Za-z0-9_-]{16,64}$/.test(code)) return { ok: false, reason: "This invite link isn't valid." }
  const admin = createAdminClient()
  const { data: invite } = await admin
    .from("workspace_invites")
    .select("id, org_id, kind, role, room_ids, max_uses, use_count, expires_at, revoked_at, created_by")
    .eq("code", code)
    .maybeSingle()
  if (!invite) return { ok: false, reason: "This invite link isn't valid." }
  if (invite.revoked_at) return { ok: false, reason: "This invite link was turned off. Ask for a new one." }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "This invite link expired. Ask for a new one." }
  }
  if (invite.max_uses !== null && invite.use_count >= invite.max_uses) {
    return { ok: false, reason: "This invite link was already used. Ask for a new one." }
  }
  const { data: org } = await admin.from("orgs").select("slug, name").eq("id", invite.org_id).maybeSingle()
  if (!org) return { ok: false, reason: "That workspace no longer exists." }
  let inviterName: string | null = null
  if (invite.created_by) {
    const { data: p } = await admin.from("profiles").select("display_name").eq("id", invite.created_by).maybeSingle()
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

export async function acceptInviteAction(code: string): Promise<ActionResult> {
  const user = await requireUser(`/join/${code}`)
  const check = await checkJoinCode(code)
  if (!check.ok) return fail(check.reason)
  const admin = createAdminClient()

  const { data: already } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", check.orgId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!already) {
    const seat = await planGate(check.orgId, "members")
    if (!seat.ok) {
      return fail(`${check.orgName} is full on its current plan. Ask an admin to upgrade it in Settings → Plan & billing.`)
    }
    // Claim a use first; the guard keeps a single-use link single-use even if two people race.
    const { data: invite } = await admin
      .from("workspace_invites")
      .select("use_count, max_uses")
      .eq("id", check.inviteId)
      .single()
    const { data: claimed } = await admin
      .from("workspace_invites")
      .update({ use_count: (invite?.use_count ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq("id", check.inviteId)
      .eq("use_count", invite?.use_count ?? 0)
      .select("id")
      .maybeSingle()
    if (!claimed) return fail("Someone used this link a moment ago. Ask for a new one.")
    const { error } = await admin.from("org_members").insert({ org_id: check.orgId, user_id: user.id, role: check.role })
    if (error) return fail(errorMessage(error))
  }

  if (check.roomIds.length) {
    await admin
      .from("room_members")
      .upsert(check.roomIds.map((roomId) => ({ room_id: roomId, user_id: user.id, role: "member" })), {
        onConflict: "room_id,user_id",
        ignoreDuplicates: true,
      })
    await admin.from("room_reads").upsert(
      check.roomIds.map((roomId) => ({ room_id: roomId, user_id: user.id, last_read_at: new Date().toISOString() })),
      { onConflict: "user_id,room_id" },
    )
  }
  await audit({
    orgId: check.orgId,
    actorId: user.id,
    action: "invite.accepted",
    target: check.inviteId,
    metadata: { role: check.role, alreadyMember: Boolean(already) },
  })
  redirect(check.roomIds.length === 1 ? `/${check.orgSlug}/r/${check.roomIds[0]}` : `/${check.orgSlug}`)
}
