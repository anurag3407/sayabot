"use server"

import { redirect } from "next/navigation"
import { z } from "zod"
import { requireUser } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  adminOrgAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  revalidateOrg,
  uniqueOrgSlug,
} from "@/lib/actions/shared"
import { ssoEnabled } from "@/lib/env"
import { ensureSayaAgent } from "@/lib/saya"
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
  const { data: org, error } = await admin.from("orgs").insert({ name, slug }).select("id").single()
  if (error || !org) return fail(errorMessage(error) || "Could not create the workspace")
  const { error: memberError } = await admin
    .from("org_members")
    .insert({ org_id: org.id, user_id: user.id, role: "owner" })
  if (memberError) {
    await admin.from("orgs").delete().eq("id", org.id)
    return fail("Could not add you as the workspace owner")
  }
  try {
    await ensureSayaAgent({ orgId: org.id, userId: user.id }, admin)
  } catch (error) {
    console.warn("[saya] could not create the workspace orchestrator", error)
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

/** Email invitations are gone. Share a link; an admin approves whoever opens it. */
export async function inviteMember(
  _prev: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  return fail("Share an invite link instead. Email invitations are turned off.")
}

/** Email invitations are gone. Share a link from the room; an admin approves whoever opens it. */
export async function inviteToRoom(
  _prev: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  return fail("Share an invite link instead. Email invitations are turned off.")
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
