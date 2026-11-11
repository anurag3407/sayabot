import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { requireOrgAccess } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { listProviderKeys, listRooms } from "@/lib/queries"
import { BotWizard, type TemplateSummary } from "@/components/agents/bot-wizard/wizard"

export const metadata: Metadata = { title: "New Bot" }

export default async function NewBotPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>
  searchParams: Promise<{ template?: string }>
}) {
  const { org: orgSlug } = await params
  const { template: initialTemplateSlug } = await searchParams
  const access = await requireOrgAccess(orgSlug)
  if (!access) notFound()

  const admin = createAdminClient()

  // 1. Fetch templates (both curated where org_id IS NULL and custom for this org)
  const { data: rawTemplates } = await admin
    .from("agent_templates")
    .select("*")
    .or(`org_id.is.null,org_id.eq.${access.org.id}`)
    .order("created_at", { ascending: true })

  const templates: TemplateSummary[] = (rawTemplates ?? []).map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    category: t.category,
    defaultCapabilities: t.default_capabilities,
    defaultModel: t.default_model,
    systemPrompt: t.system_prompt,
    secretSlots: t.secret_slots ?? [],
    starterTasks: t.starter_tasks ?? [],
  }))

  // 2. Fetch provider keys and rooms
  const [providerKeys, rooms] = await Promise.all([
    listProviderKeys(access.org.id),
    listRooms(access.org.id),
  ])

  // 3. Fetch org vault secrets
  const { data: rawSecrets } = await admin
    .from("vault_secrets")
    .select("id, label, kind, last4")
    .eq("org_id", access.org.id)
    .order("created_at", { ascending: false })

  const vaultSecrets = rawSecrets ?? []

  return (
    <div className="h-full overflow-y-auto bg-background">
      <BotWizard
        orgSlug={orgSlug}
        templates={templates}
        providerKeys={providerKeys.map((k) => ({ id: k.id, provider: k.provider, label: k.label }))}
        rooms={rooms.filter((r) => r.kind !== "dm").map((r) => ({ id: r.id, name: r.name }))}
        vaultSecrets={vaultSecrets}
        initialTemplateSlug={initialTemplateSlug}
      />
    </div>
  )
}
