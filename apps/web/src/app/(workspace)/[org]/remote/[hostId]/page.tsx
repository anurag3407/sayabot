import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { requireOrgAccess } from "@/lib/auth"
import { listComputers } from "@/lib/computers"
import { RemoteViewer } from "@/components/computers/remote-viewer"

export const metadata: Metadata = { title: "Remote desktop" }
export const dynamic = "force-dynamic"

export default async function RemotePage({ params }: { params: Promise<{ org: string; hostId: string }> }) {
  const { org: orgSlug, hostId } = await params
  const access = await requireOrgAccess(orgSlug)
  const computer = (await listComputers(access.user.id, access.org.id, access.role)).find((c) => c.id === hostId)
  if (!computer) notFound()
  return <RemoteViewer orgSlug={orgSlug} hostId={computer.id} hostName={computer.name} />
}
