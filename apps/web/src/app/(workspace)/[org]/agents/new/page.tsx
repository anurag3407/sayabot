import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { requireOrgAccess } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { NewBotForm, type BotTemplate } from "@/components/agents/new-bot-form"

export const metadata: Metadata = { title: "New bot" }

export default async function NewBotPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>
  searchParams: Promise<{ template?: string; room?: string }>
}) {
  const { org: orgSlug } = await params
  const { template: templateParam, room: roomParam } = await searchParams
  const access = await requireOrgAccess(orgSlug)
  if (!access) notFound()

  const admin = createAdminClient()
  const [{ data: rawTemplates }, { data: room }] = await Promise.all([
    admin
      .from("agent_templates")
      .select("id, slug, name, description, system_prompt, default_capabilities")
      .or(`org_id.is.null,org_id.eq.${access.org.id}`)
      .order("created_at", { ascending: true }),
    roomParam
      ? admin.from("rooms").select("id, name, org_id, kind").eq("id", roomParam).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const templates: BotTemplate[] = (rawTemplates ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description ?? "",
    systemPrompt: t.system_prompt ?? "",
    defaultCapabilities: t.default_capabilities ?? null,
  }))
  // From the Marketplace: start from that template.
  const preselected = templateParam
    ? (rawTemplates ?? []).find((t) => t.slug === templateParam || t.id === templateParam)
    : undefined
  const inRoom = room && room.org_id === access.org.id && room.kind !== "dm" ? room : null

  return (
    <div className="h-full overflow-y-auto">
      <NewBotForm
        orgSlug={orgSlug}
        templates={templates}
        initialTemplateId={preselected?.id}
        roomId={inRoom?.id}
        roomName={inRoom?.name}
      />
    </div>
  )
}
