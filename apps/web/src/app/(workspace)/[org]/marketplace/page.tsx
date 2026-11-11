import type { Metadata } from "next"
import { requireOrgAccess } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { MarketplaceView } from "@/components/marketplace/marketplace-view"

export const metadata: Metadata = { title: "Marketplace" }

export default async function MarketplacePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { org: orgSlug } = await params
  const { tab } = await searchParams
  const access = await requireOrgAccess(orgSlug)
  const admin = createAdminClient()
  const [serversRes, templatesRes] = await Promise.all([
    admin
      .from("mcp_servers")
      .select("id, name, url, enabled, room_id")
      .eq("org_id", access.org.id)
      .order("created_at", { ascending: false }),
    admin
      .from("agent_templates")
      .select("id, slug, name, description, category")
      .or(`org_id.is.null,org_id.eq.${access.org.id}`)
      .order("created_at", { ascending: true }),
  ])
  const servers = ((serversRes.data ?? []) as { id: string; name: string; url: string; enabled: boolean; room_id: string | null }[]).map(
    // Never send a saved URL to the browser: some carry the key (Exa, Firecrawl, Zapier).
    (s) => ({ id: s.id, name: s.name, host: safeHost(s.url), enabled: s.enabled }),
  )
  const templates = ((templatesRes.data ?? []) as { id: string; slug: string; name: string; description: string; category: string }[])
  return (
    <MarketplaceView
      orgSlug={orgSlug}
      canManage={access.role === "owner" || access.role === "admin"}
      servers={servers}
      templates={templates}
      initialTab={tab === "agents" ? "agents" : "apps"}
    />
  )
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ""
  }
}
