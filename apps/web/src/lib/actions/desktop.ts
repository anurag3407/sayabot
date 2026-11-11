"use server"

import { revalidatePath } from "next/cache"
import { getOrgAccess } from "@/lib/auth"
import { audit, fail, ok } from "@/lib/actions/shared"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ActionResult } from "@/lib/types"

async function ownHost(orgSlug: string, hostId: string) {
  const access = await getOrgAccess(orgSlug)
  if (!access) return { error: "Workspace not found" as const }
  const { data: host } = await createAdminClient()
    .from("desktop_hosts")
    .select("id, user_id, settings, name")
    .eq("id", hostId)
    .maybeSingle()
  if (!host || host.user_id !== access.user.id) return { error: "Only the person who set up this computer can change it" as const }
  return { access, host }
}

/** Who can open this computer, whether each session must be allowed at the computer, and the local runner. */
export async function updateHostSettingsAction(input: {
  orgSlug: string
  hostId: string
  whoCanControl?: "only_me" | "admins" | "members"
  askOnComputer?: boolean
  runnerEnabled?: boolean
}): Promise<ActionResult> {
  const check = await ownHost(input.orgSlug, input.hostId)
  if ("error" in check) return fail(check.error ?? "Not allowed")
  const settings = { ...((check.host.settings as Record<string, unknown>) ?? {}) }
  if (input.whoCanControl && ["only_me", "admins", "members"].includes(input.whoCanControl)) settings.whoCanControl = input.whoCanControl
  if (typeof input.askOnComputer === "boolean") settings.askOnComputer = input.askOnComputer
  if (typeof input.runnerEnabled === "boolean") settings.runnerEnabled = input.runnerEnabled
  // Sharing beyond "only me" (and running workspace agents) ties the computer to this workspace.
  const orgId = settings.whoCanControl !== "only_me" || settings.runnerEnabled ? check.access.org.id : null
  await createAdminClient().from("desktop_hosts").update({ settings, org_id: orgId }).eq("id", check.host.id)
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "desktop.settings_changed",
    target: check.host.id,
    metadata: settings,
  })
  revalidatePath(`/${input.orgSlug}/settings/computers`)
  return ok("Saved")
}

export async function removeHostAction(input: { orgSlug: string; hostId: string }): Promise<ActionResult> {
  const check = await ownHost(input.orgSlug, input.hostId)
  if ("error" in check) return fail(check.error ?? "Not allowed")
  await createAdminClient().from("desktop_hosts").update({ revoked_at: new Date().toISOString() }).eq("id", check.host.id)
  revalidatePath(`/${input.orgSlug}/settings/computers`)
  return ok(`${check.host.name} removed`)
}
