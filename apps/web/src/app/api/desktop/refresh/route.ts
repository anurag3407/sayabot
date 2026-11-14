import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken.trim() : ""
  if (!refreshToken || refreshToken.length > 4_000) {
    return NextResponse.json({ error: "Missing or invalid refreshToken" }, { status: 400 })
  }

  try {
    const anon = createClient<any>(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await anon.auth.refreshSession({ refresh_token: refreshToken })
    if (error || !data.session) {
      // 401 tells the Mac app the login is dead and it should sign out locally. Network or
      // Supabase outages (no status / 5xx) are retryable, so they must not log anyone out.
      const retryable = error?.name === "AuthRetryableFetchError" || (error?.status ?? 0) >= 500
      return NextResponse.json(
        { error: error?.message || "Could not refresh session" },
        { status: retryable ? 502 : 401 },
      )
    }

    return NextResponse.json({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      email: data.session.user.email ?? "",
      userId: data.session.user.id,
      // A guest who saved their account becomes a normal user; the desktop picks that up here.
      isAnonymous: data.session.user.is_anonymous === true,
      expiresAt: data.session.expires_at,
    })
  } catch (err) {
    console.error("[desktop/refresh] Error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
