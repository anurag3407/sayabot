import type { Metadata } from "next"
import { requireOrgAccess } from "@/lib/auth"
import { listComputers } from "@/lib/computers"
import { ComputersView } from "@/components/computers/computers-view"

export const metadata: Metadata = { title: "Computers" }
export const dynamic = "force-dynamic"

export default async function ComputersPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const computers = await listComputers(access.user.id, access.org.id, access.role)
  return <ComputersView orgSlug={orgSlug} computers={computers} />
}
