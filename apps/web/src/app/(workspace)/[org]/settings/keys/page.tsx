import type { Metadata } from "next"
import { requireOrgAdmin } from "@/lib/auth"
import { listOrgAgents, listProviderKeys, listRooms } from "@/lib/queries"
import { ProvidersView } from "@/components/providers/providers-view"

export const maxDuration = 60
export const metadata: Metadata = { title: "AI providers" }

export default async function ProvidersPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAdmin(orgSlug)
  const [keys, agents, rooms] = await Promise.all([
    listProviderKeys(access.org.id),
    listOrgAgents(access.org.id),
    listRooms(access.org.id),
  ])
  const agentCounts: Record<string, number> = {}
  for (const agent of agents) {
    if (agent.providerKeyId) agentCounts[agent.providerKeyId] = (agentCounts[agent.providerKeyId] ?? 0) + 1
  }
  return (
    <ProvidersView
      orgSlug={orgSlug}
      keys={keys}
      agentCounts={agentCounts}
      rooms={rooms.filter((r) => r.kind !== "dm").map((r) => ({ id: r.id, name: r.name }))}
    />
  )
}
