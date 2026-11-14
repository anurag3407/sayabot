import { NextResponse } from "next/server"
import {
  desktopGuestModeEnabled,
  edition,
  getSupabaseAnonKey,
  getSupabaseUrl,
  instanceName,
} from "@/lib/env"
import { getPublicOrigin } from "@/lib/public-origin"

export const dynamic = "force-dynamic"

/**
 * "Is this a Sayabot server, and what kind?" The Mac and phone apps call this before
 * connecting to an address someone typed, and show the server's name. Public: nothing here is
 * secret (the Supabase anon key is meant for browsers).
 */
export function GET(request: Request) {
  return NextResponse.json(
    {
      sayabot: true,
      name: instanceName(),
      edition: edition(),
      url: getPublicOrigin(request),
      guestMode: desktopGuestModeEnabled(),
      // Public values (every browser gets them): the phone app signs in against this server's
      // own Supabase, so a self-hosted server never touches Sayabot Cloud.
      supabase: { url: getSupabaseUrl(), anonKey: getSupabaseAnonKey() },
      version: process.env.APP_VERSION || process.env.NEXT_PUBLIC_APP_VERSION || null,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    },
  )
}
