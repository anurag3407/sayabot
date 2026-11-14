import type { Metadata } from "next"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { DesktopHandoffClient, type SessionPayload } from "./desktop-handoff-client"

export const metadata: Metadata = { title: "Connecting to Sayabot Mac · Sayabot" }
export const dynamic = "force-dynamic"

export default async function DesktopAuthPage() {
  let serverSession: SessionPayload | null = null

  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session) {
        serverSession = {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          email: session.user.email ?? user.email ?? "",
          userId: user.id,
        }
      }
    }
  } catch (err) {
    console.error("[DesktopAuthPage] Error reading server session:", err)
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://sayabot.sayalabs.in"

  return <DesktopHandoffClient serverSession={serverSession} siteUrl={siteUrl} />
}
