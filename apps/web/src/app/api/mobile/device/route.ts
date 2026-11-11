import { hashAgentApiKey } from "@sayabot/core/server"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * A paired phone checks in when it opens or wakes. "revoked" tells it to sign out, which is
 * how removing a phone on the computer takes effect.
 */
export async function GET(req: Request) {
  const deviceId = req.headers.get("x-device-id") ?? ""
  const token = req.headers.get("x-device-token") ?? ""
  if (!/^[0-9a-f-]{36}$/i.test(deviceId) || !token) return NextResponse.json({ status: "unknown" }, { status: 400 })
  const admin = createAdminClient()
  const { data } = await admin
    .from("device_pairings")
    .select("id, status, device_token_hash")
    .eq("id", deviceId)
    .maybeSingle()
  if (!data) return NextResponse.json({ status: "revoked" })
  if (data.status !== "paired" || !data.device_token_hash || data.device_token_hash !== hashAgentApiKey(token)) {
    return NextResponse.json({ status: "revoked" })
  }
  await admin.from("device_pairings").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id)
  return NextResponse.json({ status: "active" }, { headers: { "cache-control": "no-store" } })
}
