import type { Metadata } from "next"
import { requireOrgAccess } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { BotStoreView, type BotTemplateItem } from "@/components/bot-store/bot-store-view"

export const metadata: Metadata = { title: "Bot Store" }

export default async function BotStorePage({
  params,
}: {
  params: Promise<{ org: string }>
}) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const admin = createAdminClient()

  const { data: templatesData } = await admin
    .from("agent_templates")
    .select("id, slug, name, description, category")
    .or(`org_id.is.null,org_id.eq.${access.org.id}`)
    .order("created_at", { ascending: true })

  const templates: BotTemplateItem[] = (templatesData ?? []).map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description ?? "",
    category: t.category ?? "general",
  }))

  return <BotStoreView orgSlug={orgSlug} templates={templates} />
}
