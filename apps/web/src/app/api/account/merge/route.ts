import { NextResponse } from "next/server"
import { createMergeTicket } from "@/lib/guest-merge"
import { userFromRequest } from "@/lib/route-bearer"
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
 * A guest (desktop bearer token or web cookie) asks to move their data into a real account.
 * Returns the link to open, usually in the system browser, where they sign in or sign up.
 */
export async function POST(request: Request) {
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (who.user.is_anonymous !== true) {
    return NextResponse.json({ error: "Only guest accounts can be merged" }, { status: 400 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    // next is optional
  }
  const next = safeNextPath(typeof body.next === "string" ? body.next : "", "")

  try {
    const ticket = await createMergeTicket(who.user.id)
    const url = new URL("/auth/merge", siteOrigin(request))
    url.searchParams.set("ticket", ticket)
    if (next) url.searchParams.set("next", next)
    return NextResponse.json({ url: url.toString() })
  } catch (err) {
    console.error("[account/merge] ticket error", err)
    return NextResponse.json({ error: "Could not start saving your account" }, { status: 500 })
  }
}
