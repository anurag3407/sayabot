import { NextResponse } from "next/server"
import { detectLocalAgents, localDetectionAllowed } from "@/lib/local-agents"
import { requireRouteUser } from "@/lib/route-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Agent apps on this computer, for the Providers page. Only when the server is the person's own machine. */
export async function GET(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (!localDetectionAllowed(host)) {
    return NextResponse.json({ available: false, agents: [] }, { headers: { "cache-control": "no-store" } })
  }
  const agents = await detectLocalAgents()
  return NextResponse.json({ available: true, agents }, { headers: { "cache-control": "no-store" } })
}
