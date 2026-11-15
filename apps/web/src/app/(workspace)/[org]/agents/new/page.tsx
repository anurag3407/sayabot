import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { requireOrgAccess } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { NewBotForm } from "@/components/agents/new-bot-form"

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
  const [{ data: template }, { data: room }] = await Promise.all([
    // From the Marketplace: start from that template's name and prompt.
    templateParam
      ? admin
          .from("agent_templates")
          .select("id, org_id, name, system_prompt")
          .or(`slug.eq.${templateParam},id.eq.${templateParam}`)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    roomParam
      ? admin.from("rooms").select("id, name, org_id, kind").eq("id", roomParam).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const usableTemplate = template && (template.org_id === null || template.org_id === access.org.id) ? template : null
  const inRoom = room && room.org_id === access.org.id && room.kind !== "dm" ? room : null

  return (
    <div className="h-full overflow-y-auto">
      <NewBotForm
        orgSlug={orgSlug}
        initialTemplate={
          usableTemplate
            ? { id: usableTemplate.id, name: usableTemplate.name, systemPrompt: usableTemplate.system_prompt ?? "" }
            : undefined
        }
        roomId={inRoom?.id}
        roomName={inRoom?.name}
      />
    </div>
  )
}
