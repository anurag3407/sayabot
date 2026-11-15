import type { Metadata } from "next"
import { isOrgAdmin, requireOrgAccess } from "@/lib/auth"
import { listComputers } from "@/lib/computers"
import { ComputersView } from "@/components/computers/computers-view"
import { createAdminClient } from "@/lib/supabase/admin"

export const metadata: Metadata = { title: "Computers" }
export const dynamic = "force-dynamic"

export default async function ComputersPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const computers = await listComputers(access.user.id, access.org.id, access.role)
  const { data, error } = await createAdminClient()
    .from("org_computer_settings")
    .select("boat_last4, vps_ssh_alias, vps_start_automatically")
    .eq("org_id", access.org.id)
    .maybeSingle()
  const settings = error ? null : data
  return (
    <ComputersView
      orgSlug={orgSlug}
      computers={computers}
      canEdit={isOrgAdmin(access.role)}
      boatLast4={(settings?.boat_last4 as string | null) ?? null}
      vpsSshAlias={(settings?.vps_ssh_alias as string | null) ?? ""}
      vpsStartAutomatically={settings?.vps_start_automatically === true}
    />
  )
}
