import type { Metadata } from "next"
import { requireOrgAccess } from "@/lib/auth"
import { sayaAiPublic } from "@/lib/env"
import { listMemberViews, listOrgAgents } from "@/lib/queries"
import { NewChatView } from "@/components/ia/new-chat-view"

export const metadata: Metadata = { title: "New chat" }

export default async function NewChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { org: orgSlug } = await params
  const { tab } = await searchParams
  const access = await requireOrgAccess(orgSlug)
  const [members, agents] = await Promise.all([
    listMemberViews(access.org.id),
    listOrgAgents(access.org.id),
  ])
  return (
    <NewChatView
      orgSlug={orgSlug}
      members={members}
      selfId={access.user.id}
      agents={agents}
      saya={sayaAiPublic()}
      initialTab={tab === "agent" ? "bot" : "room"}
    />
  )
}
