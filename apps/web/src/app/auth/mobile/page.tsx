import type { Metadata } from "next"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { MobileHandoffClient, type MobileSessionPayload } from "./mobile-handoff-client"

export const metadata: Metadata = { title: "Connecting to Sayabot Mobile · Sayabot" }
export const dynamic = "force-dynamic"

export default async function MobileAuthPage() {
  let serverSession: MobileSessionPayload | null = null

  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (session) {
      serverSession = {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        email: session.user.email ?? "",
        userId: session.user.id,
      }
    }
  } catch (err) {
    console.error("[MobileAuthPage] Error reading server session:", err)
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://sayabot.sayalabs.in"

  return <MobileHandoffClient serverSession={serverSession} siteUrl={siteUrl} />
}
