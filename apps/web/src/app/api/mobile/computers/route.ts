import { NextResponse } from "next/server"
import { getOrgAccess } from "@/lib/auth"
import { listComputers } from "@/lib/computers"
import { userFromRequest } from "@/lib/route-bearer"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

/** The phone's Computers screen: your Macs (remote desktop, local runner) and agents' cloud computers. */
export async function GET(request: Request) {
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const access = await getOrgAccess(new URL(request.url).searchParams.get("orgSlug") ?? "", { client: who.client, user: who.user })
  if (!access) return NextResponse.json({ error: "workspace not found" }, { status: 404 })
  const [macs, cloudRes] = await Promise.all([
    listComputers(who.user.id, access.org.id, access.role),
    createAdminClient()
      .from("agent_computers")
      .select("agent_id, status, profile, disk_used_mb, disk_mb, last_active_at, error, agents!inner(handle, display_name)")
      .eq("org_id", access.org.id),
  ])
  return NextResponse.json(
    {
      macs,
      cloud: ((cloudRes.data ?? []) as unknown as Array<{
        agent_id: string
        status: string
        profile: string
        disk_used_mb: number
        disk_mb: number
        last_active_at: string | null
        error: string | null
        agents: { handle: string; display_name: string }
      }>).map((c) => ({
        agentId: c.agent_id,
        handle: c.agents.handle,
        name: c.agents.display_name,
        status: c.status,
        profile: c.profile,
        diskUsedMb: c.disk_used_mb,
        diskMb: c.disk_mb,
        lastActiveAt: c.last_active_at,
        error: c.error,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  )
}
