import type { Metadata } from "next"
import { requireOrgAccess } from "@/lib/auth"
import { listOrgAgents } from "@/lib/queries"
import { loadBotChats, loadChatList } from "@/lib/queries-ia"
import { ChatsView } from "@/components/ia/chats-view"

export const metadata: Metadata = { title: "Chats" }

export default async function OrgHomePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const [chatData, handoffs, agents] = await Promise.all([
    loadChatList(access),
    loadBotChats(access),
    listOrgAgents(access.org.id),
  ])

  return (
    <ChatsView
      orgSlug={orgSlug}
      items={chatData.items}
      handoffs={handoffs}
      bots={agents.map((agent) => ({
        id: agent.id,
        handle: agent.handle,
        displayName: agent.displayName,
        kind: agent.kind,
      }))}
      inboxCount={chatData.inboxCount}
    />
  )
}
