import { generateDeviceToken } from "@sayabot/core/server"
import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { userFromRequest } from "@/lib/route-bearer"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * The desktop app registers once with the person's login and gets a host token of its own.
 * Re-registering with a valid host id/token keeps the same computer (and its settings).
 */
export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.clone().json()) as Record<string, unknown>
  } catch {
    // name/platform are optional
  }
  let who = await userFromRequest(request)
  // The desktop's saved login may have expired; its refresh token can renew it once here.
  if (!who && typeof body.refreshToken === "string" && body.refreshToken.length < 4_000) {
    const anon = createClient<any>(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data } = await anon.auth.refreshSession({ refresh_token: body.refreshToken })
    if (data?.user) who = { user: data.user, client: anon }
  }
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "My computer"
  const platform = typeof body.platform === "string" ? body.platform.slice(0, 20) : "unknown"
  const version = typeof body.version === "string" ? body.version.slice(0, 40) : null
  const admin = createAdminClient()
  const token = generateDeviceToken()

  const existing = await hostFromRequest(request)
  if (existing && existing.user_id === who.user.id) {
    await admin
      .from("desktop_hosts")
      .update({ name, platform, app_version: version, token_hash: token.hash, last_seen_at: new Date().toISOString() })
      .eq("id", existing.id)
    return NextResponse.json({ hostId: existing.id, hostToken: token.token })
  }

  const { data, error } = await admin
    .from("desktop_hosts")
    .insert({
      user_id: who.user.id,
      name,
      platform,
      app_version: version,
      token_hash: token.hash,
      settings: { whoCanControl: "only_me", askOnComputer: true, runnerEnabled: false },
      last_seen_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? "could not register" }, { status: 500 })
  return NextResponse.json({ hostId: data.id, hostToken: token.token })
}
