"use server"

import { revalidatePath } from "next/cache"
import { computerSettingsUpdate } from "@/lib/computer-settings"
import { getOrgAccess, isOrgAdmin } from "@/lib/auth"
import { audit, fail, ok } from "@/lib/actions/shared"
import { pickDefaultApp } from "@/lib/desktop-hosts"
import { getKek } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ActionResult } from "@/lib/types"

async function ownHost(orgSlug: string, hostId: string) {
  const access = await getOrgAccess(orgSlug)
  if (!access) return { error: "Workspace not found" as const }
  const { data: host } = await createAdminClient()
    .from("desktop_hosts")
    .select("id, user_id, settings, name, local_agents")
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
  /** Run my agents on this computer by default (no key or computer picked). */
  localDefault?: boolean
}): Promise<ActionResult> {
  const check = await ownHost(input.orgSlug, input.hostId)
  if ("error" in check) return fail(check.error ?? "Not allowed")
  const settings = { ...((check.host.settings as Record<string, unknown>) ?? {}) }
  if (input.whoCanControl && ["only_me", "admins", "members"].includes(input.whoCanControl)) settings.whoCanControl = input.whoCanControl
  if (typeof input.askOnComputer === "boolean") settings.askOnComputer = input.askOnComputer
  if (typeof input.runnerEnabled === "boolean") settings.runnerEnabled = input.runnerEnabled
  if (input.localDefault === false) settings.localDefault = false
  if (input.localDefault === true) {
    const app = pickDefaultApp((check.host.local_agents as Array<Record<string, unknown>>) ?? [])
    if (!app) return fail("Sign in to Claude Code, Codex, Gemini CLI or OpenCode on this computer first")
    settings.localDefault = { app }
    settings.runnerEnabled = true
  }
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

/**
 * One Boat key for the whole app, plus the VPS this workspace may use.
 * The key is sealed. A Cloud relay token is never written here, and a saved key wins over it.
 */
export async function saveWorkspaceComputersAction(input: {
  orgSlug: string
  boatToken?: string
  clearBoat?: boolean
  vpsSshAlias?: string
  vpsStartAutomatically?: boolean
}): Promise<ActionResult> {
  const access = await getOrgAccess(input.orgSlug)
  if (!access) return fail("Workspace not found")
  if (!isOrgAdmin(access.role)) return fail("Only an admin can change computers")
  const built = computerSettingsUpdate({
    orgId: access.org.id,
    boatToken: input.boatToken,
    clearBoat: input.clearBoat,
    vpsSshAlias: input.vpsSshAlias,
    vpsStartAutomatically: input.vpsStartAutomatically,
    kek: getKek(),
  })
  if (!built.ok) return fail(built.error)
  const { error } = await createAdminClient().from("org_computer_settings").upsert(built.row)
  if (error) return fail("Could not save computer settings")
  await audit({
    orgId: access.org.id,
    actorId: access.user.id,
    action: "computers.settings_changed",
    target: access.org.id,
    metadata: {
      boat: Boolean(built.row.boat_ciphertext),
      clearBoat: Boolean(input.clearBoat),
      vps: Boolean(built.row.vps_ssh_alias),
    },
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
