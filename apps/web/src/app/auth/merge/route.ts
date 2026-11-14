import { NextResponse } from "next/server"
import { findMergeTicket, MERGE_COOKIE, MERGE_TTL_SECONDS } from "@/lib/guest-merge"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { safeNextPath } from "@/lib/safe-next"

export const dynamic = "force-dynamic"

function siteOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") || "https"
    return `${proto}://${forwardedHost}`
  }
  return (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/, "")
}

/**
 * Entry point of the guest → account merge link. Moves the ticket out of the URL into an
 * httpOnly cookie, then sends the person to sign in (or straight to the confirm step when this
 * browser is already signed in to a real account).
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = siteOrigin(request)
  const ticket = url.searchParams.get("ticket") ?? ""
  const next = safeNextPath(url.searchParams.get("next"), "")

  if (!(await findMergeTicket(ticket))) {
    const message = "This link to save your guest workspace has expired. Start again from the app."
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, origin))
  }

  const finish = `/auth/merge/finish${next ? `?next=${encodeURIComponent(next)}` : ""}`

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const destination =
    user && user.is_anonymous !== true
      ? finish
      : `/login?force=true&merge=1&next=${encodeURIComponent(finish)}`

  const response = NextResponse.redirect(new URL(destination, origin))
  response.cookies.set(MERGE_COOKIE, ticket, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: MERGE_TTL_SECONDS,
  })
  return response
}
