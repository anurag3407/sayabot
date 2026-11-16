import type { Metadata } from "next"
import { isOrgAdmin, requireOrgAccess } from "@/lib/auth"
import { listComputers } from "@/lib/computers"
import { loadComputerProviders } from "@/lib/computer-providers"
import { ComputersView } from "@/components/computers/computers-view"

export const metadata: Metadata = { title: "Computers" }
export const dynamic = "force-dynamic"

export default async function ComputersPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const [computers, providers] = await Promise.all([
    listComputers(access.user.id, access.org.id, access.role),
    loadComputerProviders(access.org.id),
  ])
  return (
    <ComputersView
      orgSlug={orgSlug}
      computers={computers}
      canEdit={isOrgAdmin(access.role)}
      providers={providers}
    />
  )
}
