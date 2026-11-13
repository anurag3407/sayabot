import { NextResponse } from "next/server"
import { userFromRequest } from "@/lib/route-bearer"
import { createAdminClient } from "@/lib/supabase/admin"

const EXPO_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,}\]$/

/** The phone registers (POST) or removes (DELETE) its Expo push token for this person. */
export async function POST(request: Request) {
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { token?: string; platform?: string }
  if (!body.token || !EXPO_TOKEN.test(body.token)) return NextResponse.json({ error: "invalid token" }, { status: 400 })
  await createAdminClient()
    .from("mobile_push_tokens")
    .upsert(
      { user_id: who.user.id, token: body.token, platform: (body.platform ?? "").slice(0, 20) || null, last_seen_at: new Date().toISOString() },
      { onConflict: "token" },
    )
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { token?: string }
  if (body.token) await createAdminClient().from("mobile_push_tokens").delete().eq("token", body.token).eq("user_id", who.user.id)
  return NextResponse.json({ ok: true })
}
