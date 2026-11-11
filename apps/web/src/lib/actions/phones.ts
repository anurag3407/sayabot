"use server"

import { formatPairingCode, PAIRING_TTL_MINUTES, pairingDeepLink } from "@sayabot/core"
import { generatePairingCode, hashAgentApiKey } from "@sayabot/core/server"
import { revalidatePath } from "next/cache"
import { getOrgAccess } from "@/lib/auth"
import { audit, errorMessage, fail, ok } from "@/lib/actions/shared"
import { getAppUrl } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ActionResult } from "@/lib/types"

export interface PhoneView {
  id: string
  deviceName: string
  platform: string | null
  pairedAt: string | null
  lastSeenAt: string | null
}

/** "Add a phone" → "Yes, sign in": a one-time code valid for 10 minutes. */
export async function createPhonePairingAction(input: { orgSlug: string }): Promise<ActionResult> {
  const access = await getOrgAccess(input.orgSlug)
  if (!access) return fail("Workspace not found")
  const admin = createAdminClient()
  // One live code per person: starting again replaces the old one.
  await admin.from("device_pairings").delete().eq("user_id", access.user.id).eq("status", "waiting")
  const code = generatePairingCode()
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000).toISOString()
  const { data, error } = await admin
    .from("device_pairings")
    .insert({
      user_id: access.user.id,
      org_id: access.org.id,
      code_hash: hashAgentApiKey(code),
      status: "waiting",
      expires_at: expiresAt,
    })
    .select("id")
    .single()
  if (error || !data) return fail(errorMessage(error) || "Could not make a code")
  const server = getAppUrl().replace(/\/+$/, "")
  return ok(undefined, {
    pairingId: data.id,
    code: formatPairingCode(code),
    deepLink: pairingDeepLink(code, server),
    server,
    expiresAt,
  })
}

/** Polled by the modal so it flips to "connected" when the phone uses the code. */
export async function phonePairingStatusAction(input: { orgSlug: string; pairingId: string }): Promise<ActionResult> {
  const access = await getOrgAccess(input.orgSlug)
  if (!access) return fail("Workspace not found")
  const { data } = await createAdminClient()
    .from("device_pairings")
    .select("id, user_id, status, device_name, platform, expires_at")
    .eq("id", input.pairingId)
    .maybeSingle()
  if (!data || data.user_id !== access.user.id) return fail("Code not found")
  const expired = data.status === "waiting" && new Date(data.expires_at).getTime() < Date.now()
  return ok(undefined, {
    status: expired ? "expired" : data.status,
    deviceName: data.device_name,
    platform: data.platform,
  })
}

export async function revokePhoneAction(input: { orgSlug: string; phoneId: string }): Promise<ActionResult> {
  const access = await getOrgAccess(input.orgSlug)
  if (!access) return fail("Workspace not found")
  const admin = createAdminClient()
  const { data } = await admin
    .from("device_pairings")
    .select("id, user_id, device_name")
    .eq("id", input.phoneId)
    .maybeSingle()
  if (!data || data.user_id !== access.user.id) return fail("Phone not found")
  await admin
    .from("device_pairings")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), device_token_hash: null })
    .eq("id", data.id)
  await audit({
    orgId: access.org.id,
    actorId: access.user.id,
    action: "phone.revoked",
    target: data.id,
    metadata: { deviceName: data.device_name },
  })
  revalidatePath(`/${input.orgSlug}/settings/phones`)
  return ok(`${data.device_name ?? "Phone"} removed`)
}
