import type { Metadata } from "next"
import { requireOrgAccess } from "@/lib/auth"
import { listOrgAgents, listRooms, type RoomListItem } from "@/lib/queries"
import type { AgentView } from "@/lib/types"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { loadRecentUsageEvents, loadUsageRollup } from "@/lib/usage"
import {
  UsageDashboard,
  type ModelPricingInfo,
  type UsageEventRow,
} from "@/components/analytics/usage-dashboard"

export const metadata: Metadata = { title: "Token Usage & Analytics" }

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>
  searchParams: Promise<{ days?: string }>
}) {
  const { org: orgSlug } = await params
  const query = await searchParams
  const days = query.days === "1" || query.days === "7" || query.days === "90" ? Number(query.days) : 30
  const access = await requireOrgAccess(orgSlug)
  const supabase = await createSupabaseServerClient()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const [sample, rollup, agents, rooms, pricingResult] = await Promise.all([
    loadRecentUsageEvents(access.org.id, since),
    loadUsageRollup(access.org.id, since),
    listOrgAgents(access.org.id),
    listRooms(access.org.id),
    supabase
      .from("model_pricing")
      .select("provider, model, input_per_mtok, output_per_mtok"),
  ])

  const events = sample.events as UsageEventRow[]
  const pricingData = ((pricingResult as any)?.data ?? []) as Array<{
    provider: string
    model: string
    input_per_mtok: number | string
    output_per_mtok: number | string
    cache_read_per_mtok?: number | string | null
  }>

  const pricing: ModelPricingInfo[] = pricingData.map((p) => ({
    provider: p.provider,
    model: p.model,
    inputPerMtok: Number(p.input_per_mtok) || 0,
    outputPerMtok: Number(p.output_per_mtok) || 0,
    cacheReadPerMtok: p.cache_read_per_mtok ? Number(p.cache_read_per_mtok) : null,
  }))

  const agentInfos = (agents as AgentView[]).map((a) => ({
    id: a.id,
    handle: a.handle,
    displayName: a.displayName,
    avatarUrl: null,
    role: (a.params as Record<string, any>)?.role ?? null,
  }))

  const roomInfos = (rooms as RoomListItem[]).map((r) => ({
    id: r.id,
    name: r.name,
  }))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <UsageDashboard
          initialEvents={events}
          rollup={rollup}
          eventsComplete={sample.complete}
          agents={agentInfos}
          rooms={roomInfos}
          pricing={pricing}
          orgSlug={orgSlug}
          currentDays={days}
        />
      </div>
    </div>
  )
}
