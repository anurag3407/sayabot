import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { requireOrgAdmin } from "@/lib/auth"
import { listOrgToolConfigs } from "@/lib/queries"
import { WebSearchConfig } from "@/components/settings/web-search-config"

export const maxDuration = 60

export const metadata: Metadata = {
  title: "Search Providers",
}

export default async function SearchSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAdmin(orgSlug)
  if (!access) notFound()

  const configs = await listOrgToolConfigs(access.org.id)
  const webSearch = configs.find((config) => config.tool === "web_search")

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-[18px] font-medium tracking-tight text-text">Web Search Providers</h2>
        <p className="text-[13px] leading-relaxed text-muted">
          Configure search engines and web extraction APIs for autonomous agents in this workspace.
          Agents use these providers during turns to search the live web, read current news, and
          ground code solutions.
        </p>
      </div>

      <WebSearchConfig orgSlug={orgSlug} savedConfig={webSearch} />
    </div>
  )
}
