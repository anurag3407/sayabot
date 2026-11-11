"use server"

import { canonicalFactKey } from "@sayabot/core"
import { revalidatePath } from "next/cache"
import { getOrgAccess, getRoomAccess, isOrgAdmin } from "@/lib/auth"
import { audit, fail, ok } from "@/lib/actions/shared"
import { resolveOpenAsksFromFacts, upsertFact } from "@/lib/facts"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ActionResult } from "@/lib/types"

/**
 * Editing what bots know about you. Room facts need room admin; facts for every room need
 * workspace admin, because every bot in the workspace will read them.
 */
async function canWriteScope(orgSlug: string, roomId: string | null) {
  if (roomId) {
    const access = await getRoomAccess(orgSlug, roomId)
    if (!access) return { error: "Room not found" as const }
    if (!access.canAdmin) return { error: "Only room admins can change what bots in this room know" as const }
    return { orgId: access.org.id, userId: access.user.id }
  }
  const access = await getOrgAccess(orgSlug)
  if (!access) return { error: "Workspace not found" as const }
  if (!isOrgAdmin(access.role)) return { error: "Only workspace admins can change facts for every room" as const }
  return { orgId: access.org.id, userId: access.user.id }
}

export async function saveOwnerFactAction(input: {
  orgSlug: string
  id?: string
  label: string
  value: string
  roomId: string | null
}): Promise<ActionResult> {
  const check = await canWriteScope(input.orgSlug, input.roomId)
  if ("error" in check) return fail(check.error ?? "Not allowed")
  const admin = createAdminClient()

  let key = canonicalFactKey(input.label)
  if (input.id) {
    const { data: existing } = await admin
      .from("owner_facts")
      .select("id, org_id, key, room_id")
      .eq("id", input.id)
      .maybeSingle()
    if (!existing || existing.org_id !== check.orgId) return fail("Fact not found")
    // Moving between "this room" and "every room" needs rights on the old scope too.
    if (existing.room_id !== input.roomId) {
      const old = await canWriteScope(input.orgSlug, existing.room_id)
      if ("error" in old) return fail(old.error ?? "Not allowed")
      await admin.from("owner_facts").delete().eq("id", existing.id)
    }
    key = existing.key
  }
  if (!key) return fail("Give it a name, like Start date")

  const result = await upsertFact({
    orgId: check.orgId,
    roomId: input.roomId,
    key,
    label: input.label,
    value: input.value,
    source: "manual",
    userId: check.userId,
  })
  if (!result.ok) return fail(result.error ?? "Could not save")

  await audit({
    orgId: check.orgId,
    actorId: check.userId,
    action: "owner_fact.saved",
    target: key,
    metadata: { roomId: input.roomId },
  })
  const filled = await resolveOpenAsksFromFacts({
    orgId: check.orgId,
    roomIds: input.roomId ? [input.roomId] : null,
    userId: check.userId,
  })
  revalidatePath(`/${input.orgSlug}`, "layout")
  return ok(filled ? `Saved, and answered ${filled} waiting question${filled === 1 ? "" : "s"}` : "Saved")
}

export async function deleteOwnerFactAction(input: { orgSlug: string; id: string }): Promise<ActionResult> {
  const admin = createAdminClient()
  const { data: fact } = await admin
    .from("owner_facts")
    .select("id, org_id, room_id, key")
    .eq("id", input.id)
    .maybeSingle()
  if (!fact) return fail("Fact not found")
  const check = await canWriteScope(input.orgSlug, fact.room_id)
  if ("error" in check) return fail(check.error ?? "Not allowed")
  if (fact.org_id !== check.orgId) return fail("Fact not found")
  await admin.from("owner_facts").delete().eq("id", fact.id)
  await audit({
    orgId: check.orgId,
    actorId: check.userId,
    action: "owner_fact.deleted",
    target: fact.key,
    metadata: { roomId: fact.room_id },
  })
  revalidatePath(`/${input.orgSlug}`, "layout")
  return ok("Forgotten")
}
