import { NextResponse } from "next/server"
import { detectLocalAgents, localDetectionAllowed } from "@/lib/local-agents"
import { reportedAgentsToReports, type LocalAgentsResponse } from "@/lib/local-agents-shared"
import { requireRouteUser } from "@/lib/route-auth"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const headers = { "cache-control": "no-store" }

/**
 * Agent apps for the Providers page. When the server runs on the person's own machine it looks
 * there; otherwise (Sayabot hosted, used from the Mac app or a browser) it shows what their
 * Sayabot Mac app last reported: the same list the model picker offers.
 */
export async function GET(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (localDetectionAllowed(host)) {
    const agents = await detectLocalAgents()
    return NextResponse.json(
      { available: true, agents, source: "server" } satisfies LocalAgentsResponse,
      { headers },
    )
  }

  const url = new URL(request.url)
  const requestedHostId = url.searchParams.get("hostId")

  const { data } = await createAdminClient()
    .from("desktop_hosts")
    .select("id, name, app_version, local_agents, last_seen_at")
    .eq("user_id", auth.user.id)
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(5)
  const rows = (data ?? []) as Array<{
    id: string
    name: string
    app_version: string | null
    local_agents: unknown
    last_seen_at: string | null
  }>
  // When a specific desktop window asks, its own computer wins; otherwise the Mac seen most
  // recently that reported any app; else the most recent one at all.
  const mac =
    (requestedHostId ? rows.find((row) => row.id === requestedHostId) : undefined) ??
    rows.find((row) => reportedAgentsToReports(row.local_agents).length) ??
    rows[0]
  if (!mac)
    return NextResponse.json({ available: false, agents: [] } satisfies LocalAgentsResponse, {
      headers,
    })
  return NextResponse.json(
    {
      available: true,
      agents: reportedAgentsToReports(mac.local_agents),
      source: "mac",
      hostId: mac.id,
      hostName: mac.name,
      lastSeenAt: mac.last_seen_at,
      appVersion: mac.app_version,
    } satisfies LocalAgentsResponse,
    { headers },
  )
}
