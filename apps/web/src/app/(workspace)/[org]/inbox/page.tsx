import type { Metadata } from "next"
import { requireOrgAccess } from "@/lib/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { loadBotJoinRequests, loadInbox, loadOwnerFacts } from "@/lib/queries-ia"
import { InboxView } from "@/components/ia/inbox-view"

export const metadata: Metadata = { title: "Inbox" }

export default async function InboxPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const supabase = await createSupabaseServerClient()
  const [data, joinRequests, facts, roomAdminRes, roomsRes] = await Promise.all([
    loadInbox(access),
    loadBotJoinRequests(access),
    loadOwnerFacts(access),
    supabase
      .from("room_members")
      .select("room_id")
      .eq("user_id", access.user.id)
      .eq("role", "admin"),
    supabase.from("rooms").select("id, name, kind").eq("org_id", access.org.id).neq("kind", "dm").order("name"),
  ])
  const adminRoomIds = ((roomAdminRes.data ?? []) as { room_id: string }[]).map((row) => row.room_id)
  const rooms = ((roomsRes.data ?? []) as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }))
  return (
    <InboxView
      orgSlug={orgSlug}
      approvals={data.approvals}
      requests={data.requests}
      agedStuck={data.agedStuck}
      done={data.done}
      orgAdmin={access.role === "owner" || access.role === "admin"}
      adminRoomIds={adminRoomIds}
      viewerId={access.user.id}
      joinRequests={joinRequests}
      facts={facts}
      rooms={rooms}
    />
  )
}
