import { NextResponse } from "next/server"
import { desktopGuestModeEnabled, getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env"

export const dynamic = "force-dynamic"

/**
 * Tells the desktop app whether it may start without an account, and where to create the
 * guest. The desktop then calls Supabase's anonymous sign-up itself, so Supabase's per-IP
 * limit applies to each person's own address instead of this server's.
 *
 * Both values returned here are already public (they ship in the web bundle).
 * Anonymous sign-ins must also be enabled in Supabase (Authentication → Sign In / Providers).
 */
export async function GET() {
  if (!desktopGuestModeEnabled()) {
    return NextResponse.json({ enabled: false })
  }
  try {
    return NextResponse.json({
      enabled: true,
      supabaseUrl: getSupabaseUrl(),
      anonKey: getSupabaseAnonKey(),
    })
  } catch (err) {
    console.error("[desktop/guest] Supabase is not configured:", err)
    return NextResponse.json({ enabled: false })
  }
}
