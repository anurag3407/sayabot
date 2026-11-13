import type { Metadata } from "next"
import { requireOrgAccess } from "@/lib/auth"
import { listOrgAgents, listRooms } from "@/lib/queries"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { loadRecentUsageEvents, loadUsageRollup } from "@/lib/usage"
import {
  UsageDashboard,
  type ModelPricingInfo,
  type UsageEventRow,
} from "@/components/analytics/usage-dashboard"

export const metadata: Metadata = { title: "Usage" }

const PERIODS = new Set([1, 7, 30, 90])

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>
  searchParams: Promise<{ days?: string }>
}) {
  const { org: orgSlug } = await params
  const query = await searchParams
  const requested = Number(query.days)
  const days = PERIODS.has(requested) ? requested : 30
  const access = await requireOrgAccess(orgSlug)
  const supabase = await createSupabaseServerClient()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const [sample, rollup, agents, rooms, pricingResult] = await Promise.all([
    loadRecentUsageEvents(access.org.id, since),
    loadUsageRollup(access.org.id, since),
    listOrgAgents(access.org.id),
    listRooms(access.org.id),
    supabase.from("model_pricing").select("provider, model, input_per_mtok, output_per_mtok"),
  ])

  const pricingRows = (pricingResult.data ?? []) as Array<{
    provider: string
    model: string
    input_per_mtok: number | string
    output_per_mtok: number | string
  }>
  const pricing: ModelPricingInfo[] = pricingRows.map((row) => ({
    provider: row.provider,
    model: row.model,
    inputPerMtok: Number(row.input_per_mtok) || 0,
    outputPerMtok: Number(row.output_per_mtok) || 0,
  }))

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10">
        <UsageDashboard
          events={sample.events as UsageEventRow[]}
          eventsComplete={sample.complete}
          rollup={rollup}
          agents={agents.map((agent) => ({
            id: agent.id,
            handle: agent.handle,
            displayName: agent.displayName,
          }))}
          rooms={rooms.map((room) => ({ id: room.id, name: room.name, kind: room.kind }))}
          pricing={pricing}
          orgSlug={orgSlug}
          days={days}
          sinceIso={since}
          canEditPrices={access.role === "owner" || access.role === "admin"}
        />
      </div>
    </div>
  )
}
