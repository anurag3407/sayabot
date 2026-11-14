"use server"

import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { z } from "zod"
import { requireUser } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  adminOrgAccess,
  adminRoomAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  revalidateOrg,
  uniqueOrgSlug,
} from "@/lib/actions/shared"
import { ssoEnabled } from "@/lib/env"
import { sendRoomInviteEmail, sendWorkspaceInviteEmail } from "@/lib/email"
import type { ActionResult } from "@/lib/types"

const orgRoleSchema = z.enum(["owner", "admin", "member"])

export async function createOrg(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser("/onboarding")
  const name = field(formData, "name")
  if (name.length < 2 || name.length > 60) return fail("Name must be 2 to 60 characters")
  const requestedSlug = field(formData, "slug")
  if (requestedSlug && !/^[a-z0-9][a-z0-9-]{1,47}$/.test(requestedSlug)) {
    return fail("Slug can use lowercase letters, numbers and hyphens")
  }
  const slug = await uniqueOrgSlug(requestedSlug || name)
  const admin = createAdminClient()
  const { data: org, error } = await admin
    .from("orgs")
    .insert({ name, slug })
    .select("id")
    .single()
  if (error || !org) return fail(errorMessage(error) || "Could not create the workspace")
  const { error: memberError } = await admin
    .from("org_members")
    .insert({ org_id: org.id, user_id: user.id, role: "owner" })
  if (memberError) {
    await admin.from("orgs").delete().eq("id", org.id)
    return fail("Could not add you as the workspace owner")
  }
  await audit({
    orgId: org.id,
    actorId: user.id,
    action: "org.created",
    target: slug,
    metadata: { name },
  })
  redirect(`/${slug}`)
}

async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  const admin = createAdminClient()
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) return null
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return { id: found.id }
    if (data.users.length < 200) return null
  }
  return null
}

export async function inviteMember(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const email = field(formData, "email").toLowerCase()
  const roleParsed = orgRoleSchema.safeParse(field(formData, "role") || "member")
  if (!z.string().email().safeParse(email).success) return fail("Enter a valid email")
  if (!roleParsed.success) return fail("Choose a valid role")
  const role = roleParsed.data
  if (role === "owner" && check.access.role !== "owner") {
    return fail("Only an owner can add another owner")
  }

  const existing = await findUserByEmail(email)
  let userId = existing?.id
  let inviteActionLink: string | null = null

  const headerList = await headers()
  const origin = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    headerList.get("origin") ||
    `http://${headerList.get("host") ?? "localhost:3000"}`
  ).replace(/\/+$/, "")
  const redirectUrl = `${origin}/auth/complete?next=/${orgSlug}`

  if (!userId) {
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo: redirectUrl },
    })

    if (linkErr || !linkData?.user) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: redirectUrl,
      })
      if (error || !data.user) {
        return fail(error?.message ?? "Could not invite that address")
      }
      userId = data.user.id
    } else {
      userId = linkData.user.id
      inviteActionLink = linkData.properties.action_link
    }
  }

  const { data: already } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", check.access.org.id)
    .eq("user_id", userId)
    .maybeSingle()
  if (already) return fail("That person is already a member")

  const { error } = await admin
    .from("org_members")
    .insert({ org_id: check.access.org.id, user_id: userId, role })
  if (error) return fail(errorMessage(error))
  if (!existing) {
    await admin.from("workspace_invites").insert({
      org_id: check.access.org.id,
      kind: "email",
      email,
      user_id: userId,
      role: role === "admin" ? "admin" : "member",
      created_by: check.access.user.id,
    })
  }

  const requestedRooms = formData
    .getAll("roomIds")
    .filter((value): value is string => typeof value === "string")
  if (requestedRooms.length) {
    const { data: rooms } = await admin
      .from("rooms")
      .select("id")
      .eq("org_id", check.access.org.id)
      .neq("kind", "dm")
      .in("id", requestedRooms)
    const roomIds = (rooms ?? []).map((room) => room.id as string)
    if (roomIds.length) {
      await admin
        .from("room_members")
        .upsert(
          roomIds.map((roomId) => ({ room_id: roomId, user_id: userId, role: "member" })),
          { onConflict: "room_id,user_id" },
        )
      await admin.from("room_reads").upsert(
        roomIds.map((roomId) => ({
          room_id: roomId,
          user_id: userId,
          last_read_at: new Date().toISOString(),
        })),
        { onConflict: "user_id,room_id" },
      )
    }
  }
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "member.invited",
    target: email,
    metadata: { role },
  })

  try {
    const { data: inviterProfile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", check.access.user.id)
      .maybeSingle()

    await sendWorkspaceInviteEmail({
      email,
      inviterName: inviterProfile?.display_name || check.access.user.email,
      workspaceName: check.access.org.name,
      role,
      joinUrl: inviteActionLink || redirectUrl,
      isExistingUser: Boolean(existing),
    })
  } catch (err) {
    console.error("[orgs] Failed to send workspace invite email:", err)
  }

  revalidateOrg(orgSlug)
  return ok(existing ? "Member added" : "Invitation sent")
}

/**
 * Adds someone to a room from inside it. Room admins can pull in existing workspace
 * members; bringing in someone new also needs workspace admin rights, because that
 * grants access to the whole workspace.
 */
export async function inviteToRoom(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const check = await adminRoomAccess(orgSlug, roomId)
  if ("error" in check) return fail(check.error)
  if (check.access.room.kind === "dm") return fail("Direct chats can't have more people")

  const email = field(formData, "email").toLowerCase()
  if (!z.string().email().safeParse(email).success) return fail("Enter a valid email")

  const admin = createAdminClient()
  const orgId = check.access.org.id
  const existing = await findUserByEmail(email)
  let userId = existing?.id ?? null
  let inOrg = false
  if (userId) {
    const { data } = await admin
      .from("org_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle()
    inOrg = Boolean(data)
  }

  if (!inOrg && check.access.orgRole === "member") {
    return fail("That person isn't in this workspace yet. Ask a workspace admin to invite them.")
  }

  let inviteActionLink: string | null = null
  const headerList = await headers()
  const origin = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    headerList.get("origin") ||
    `http://${headerList.get("host") ?? "localhost:3000"}`
  ).replace(/\/+$/, "")
  const redirectUrl = `${origin}/auth/complete?next=/${orgSlug}/r/${roomId}`

  if (!userId) {
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo: redirectUrl },
    })

    if (linkErr || !linkData?.user) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: redirectUrl,
      })
      if (error || !data.user) return fail(error?.message ?? "Could not invite that address")
      userId = data.user.id
    } else {
      userId = linkData.user.id
      inviteActionLink = linkData.properties.action_link
    }
  }

  if (!inOrg) {
    const { error } = await admin
      .from("org_members")
      .insert({ org_id: orgId, user_id: userId, role: "member" })
    if (error) return fail(errorMessage(error))
    if (!existing) {
      await admin.from("workspace_invites").insert({
        org_id: orgId,
        kind: "email",
        email,
        user_id: userId,
        role: "member",
        room_ids: [roomId],
        created_by: check.access.user.id,
      })
    }
  }

  const { data: seat } = await admin
    .from("room_members")
    .select("user_id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle()
  if (seat) return fail("That person is already in the room")

  const { error } = await admin
    .from("room_members")
    .insert({ room_id: roomId, user_id: userId, role: "member" })
  if (error) return fail(errorMessage(error))
  await admin.from("room_reads").upsert(
    { user_id: userId, room_id: roomId, last_read_at: new Date().toISOString() },
    { onConflict: "user_id,room_id" },
  )
  await audit({
    orgId,
    actorId: check.access.user.id,
    action: "room.member_invited",
    target: roomId,
    metadata: { email, newAccount: !existing, newToWorkspace: !inOrg },
  })

  try {
    const { data: inviterProfile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", check.access.user.id)
      .maybeSingle()

    await sendRoomInviteEmail({
      email,
      inviterName: inviterProfile?.display_name || check.access.user.email,
      roomName: check.access.room.name,
      joinUrl: inviteActionLink || redirectUrl,
    })
  } catch (err) {
    console.error("[orgs] Failed to send room invite email:", err)
  }

  revalidateOrg(orgSlug)
  return ok(existing ? "Added to the room" : "Invitation sent")
}

export async function renameWorkspaceAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const name = field(formData, "name")
  if (name.length < 2 || name.length > 60) return fail("Name must be 2 to 60 characters")
  const admin = createAdminClient()
  const { error } = await admin.from("orgs").update({ name }).eq("id", check.access.org.id)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "org.renamed",
    target: orgSlug,
    metadata: { name },
  })
  revalidateOrg(orgSlug)
  return ok("Workspace renamed")
}

export async function removeMemberAction(input: {
  orgSlug: string
  userId: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  if (input.userId === check.access.user.id) return fail("You cannot remove yourself")
  const admin = createAdminClient()
  const orgId = check.access.org.id
  const { data: members } = await admin
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", orgId)
  const target = members?.find((member) => member.user_id === input.userId)
  if (!target) return fail("Member not found")
  if (target.role === "owner" && check.access.role !== "owner") {
    return fail("Only an owner can remove another owner")
  }
  const ownerCount = members?.filter((member) => member.role === "owner").length ?? 0
  if (target.role === "owner" && ownerCount <= 1) {
    return fail("A workspace needs at least one owner")
  }
  // Room membership has no link to the workspace row, so it has to be cleared here too.
  const { data: rooms } = await admin.from("rooms").select("id").eq("org_id", orgId)
  const roomIds = (rooms ?? []).map((room) => room.id as string)
  if (roomIds.length) {
    await admin.from("room_members").delete().eq("user_id", input.userId).in("room_id", roomIds)
    await admin.from("room_reads").delete().eq("user_id", input.userId).in("room_id", roomIds)
  }
  const { error } = await admin
    .from("org_members")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", input.userId)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId,
    actorId: check.access.user.id,
    action: "member.removed",
    target: input.userId,
    metadata: { role: target.role },
  })
  revalidateOrg(input.orgSlug)
  return ok("Member removed")
}

export async function setMemberRole(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const userId = field(formData, "userId")
  const roleParsed = orgRoleSchema.safeParse(field(formData, "role"))
  if (!userId || !roleParsed.success) return fail("Invalid member or role")
  const role = roleParsed.data
  if (role === "owner" && check.access.role !== "owner") {
    return fail("Only an owner can promote someone to owner")
  }
  const admin = createAdminClient()
  const { data: members } = await admin
    .from("org_members")
    .select("user_id, role")
    .eq("org_id", check.access.org.id)
  const target = members?.find((m) => m.user_id === userId)
  if (!target) return fail("Member not found")
  if (target.role === "owner" && check.access.role !== "owner") {
    return fail("Only an owner can change another owner")
  }
  const ownerCount = members?.filter((m) => m.role === "owner").length ?? 0
  if (target.role === "owner" && role !== "owner" && ownerCount <= 1) {
    return fail("A workspace needs at least one owner")
  }
  const { error } = await admin
    .from("org_members")
    .update({ role })
    .eq("org_id", check.access.org.id)
    .eq("user_id", userId)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "member.role_changed",
    target: userId,
    metadata: { from: target.role, to: role },
  })
  revalidateOrg(orgSlug)
  return ok("Role updated")
}

export async function updateSso(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  if (!ssoEnabled()) return fail("SAML SSO is disabled for this deployment")
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  if (check.access.role !== "owner") return fail("Only the owner can change SSO")
  const enabled = field(formData, "enabled") === "true"
  const admin = createAdminClient()
  const { error } = await admin
    .from("orgs")
    .update({ sso_enabled: enabled })
    .eq("id", check.access.org.id)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "org.sso_changed",
    metadata: { enabled },
  })
  revalidateOrg(orgSlug)
  return ok(enabled ? "SSO flag enabled" : "SSO flag disabled")
}

