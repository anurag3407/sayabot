import { isPairingCode, normalizePairingCode } from "@sayabot/core"
import { generateDeviceToken, hashAgentApiKey } from "@sayabot/core/server"
import { NextResponse } from "next/server"
import { audit } from "@/lib/actions/shared"
import { getSupabaseUrl } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  })
}

/**
 * The phone trades a one-time code from the computer for a sign-in. It gets a single-use
 * Supabase token hash (redeemed on the phone with verifyOtp) plus a device token it keeps
 * to learn later if this phone was removed.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: "Send JSON with the code." }, 400)
  }
  const code = normalizePairingCode(typeof body.code === "string" ? body.code : "")
  if (!isPairingCode(code))
    return json({ error: "That code doesn't look right. Check it on your computer." }, 400)
  const deviceName = typeof body.deviceName === "string" ? body.deviceName.trim().slice(0, 80) : ""
  const platform = typeof body.platform === "string" ? body.platform.trim().slice(0, 20) : ""

  const admin = createAdminClient()
  const device = generateDeviceToken()
  const now = new Date().toISOString()
  // The status + expiry guard makes the code single-use even if two phones race.
  const { data: pairing } = await admin
    .from("device_pairings")
    .update({
      status: "paired",
      paired_at: now,
      last_seen_at: now,
      device_name: deviceName || (platform ? `${platform} phone` : "Phone"),
      platform: platform || null,
      device_token_hash: device.hash,
    })
    .eq("code_hash", hashAgentApiKey(code))
    .eq("status", "waiting")
    .gt("expires_at", now)
    .select("id, user_id, org_id")
    .maybeSingle()
  if (!pairing)
    return json(
      { error: "That code expired or was already used. Make a new one on your computer." },
      410,
    )

  const { data: userRes, error: userError } = await admin.auth.admin.getUserById(pairing.user_id)
  let email = userRes?.user?.email
  if (!email && userRes?.user) {
    // Guest or anonymous accounts in Supabase don't have an email by default.
    // Assign a synthetic confirmed email so Supabase can generate the magic link OTP token.
    const syntheticEmail = `guest-${pairing.user_id.slice(0, 8)}@sayabot.internal`
    const { data: updateRes, error: updateError } = await admin.auth.admin.updateUserById(
      pairing.user_id,
      {
        email: syntheticEmail,
        email_confirm: true,
      },
    )
    if (!updateError && updateRes?.user?.email) {
      email = updateRes.user.email
    }
  }

  if (userError || !email) {
    await admin
      .from("device_pairings")
      .update({ status: "revoked", revoked_at: now })
      .eq("id", pairing.id)
    return json(
      {
        error:
          "This account has no email (guest mode). Please sign in with Google or GitHub on your computer first, then try again.",
      },
      409,
    )
  }
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  const tokenHash = link?.properties?.hashed_token
  if (linkError || !tokenHash) {
    await admin
      .from("device_pairings")
      .update({ status: "revoked", revoked_at: now })
      .eq("id", pairing.id)
    return json({ error: "Could not sign this phone in. Try a new code." }, 500)
  }

  let orgSlug: string | null = null
  if (pairing.org_id) {
    const { data: org } = await admin
      .from("orgs")
      .select("slug")
      .eq("id", pairing.org_id)
      .maybeSingle()
    orgSlug = org?.slug ?? null
  }
  if (pairing.org_id) {
    await audit({
      orgId: pairing.org_id,
      actorId: pairing.user_id,
      action: "phone.paired",
      target: pairing.id,
      metadata: { platform, deviceName },
    })
  }

  return json({
    token_hash: tokenHash,
    type: "magiclink",
    email,
    org_slug: orgSlug,
    device_id: pairing.id,
    device_token: device.token,
    supabase_url: getSupabaseUrl(),
  })
}
