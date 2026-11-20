import { isPairingCode, normalizePairingCode } from "@sayabot/core"
import { generateDeviceToken, hashAgentApiKey } from "@sayabot/core/server"
import { NextResponse } from "next/server"
import { audit } from "@/lib/actions/shared"
import { getSupabaseUrl } from "@/lib/env"
import { magicLinkForPairing, restoreGuestAnonymous } from "@/lib/guest-phone-auth"
import { supabaseUrlForPhone } from "@/lib/phone-tunnel"
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

  const linked = await magicLinkForPairing(
    {
      async getUserById(id) {
        const { data, error } = await admin.auth.admin.getUserById(id)
        return {
          data: {
            user: data.user
              ? {
                  id: data.user.id,
                  email: data.user.email,
                  is_anonymous: data.user.is_anonymous,
                }
              : null,
          },
          error: error ? { message: error.message } : null,
        }
      },
      async updateUserById(id, attrs) {
        const { data, error } = await admin.auth.admin.updateUserById(id, attrs)
        return {
          data: {
            user: data.user ? { id: data.user.id, email: data.user.email } : null,
          },
          error: error ? { message: error.message } : null,
        }
      },
      async generateLink(args) {
        const { data, error } = await admin.auth.admin.generateLink(args)
        return {
          data: data ? { properties: { hashed_token: data.properties?.hashed_token } } : null,
          error: error ? { message: error.message } : null,
        }
      },
    },
    pairing.user_id,
  )
  if (!linked.ok) {
    await admin
      .from("device_pairings")
      .update({ status: "revoked", revoked_at: now })
      .eq("id", pairing.id)
    return json({ error: linked.error }, 409)
  }
  if (linked.wasAnonymous) await restoreGuestAnonymous(pairing.user_id)
  const requestHost = /^https?:\/\/(\[[^\]]+\]|[^/:]+)/i.exec(req.url)?.[1] ?? null
  // Prefer the Host the phone actually called (the tunnel), not the server-side request URL.
  const hostHeader = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  const phoneHost = hostHeader?.split(",")[0]?.trim().replace(/:\d+$/, "") || requestHost

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
    token_hash: linked.tokenHash,
    type: "magiclink",
    email: linked.email,
    org_slug: orgSlug,
    device_id: pairing.id,
    device_token: device.token,
    supabase_url: supabaseUrlForPhone(getSupabaseUrl(), phoneHost),
  })
}
