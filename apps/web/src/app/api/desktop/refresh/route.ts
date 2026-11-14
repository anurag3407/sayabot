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
      return NextResponse.json(
        { error: error?.message || "Could not refresh session" },
        { status: 401 },
      )
    }

    return NextResponse.json({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      email: data.session.user.email ?? "",
      userId: data.session.user.id,
      expiresAt: data.session.expires_at,
    })
  } catch (err) {
    console.error("[desktop/refresh] Error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
