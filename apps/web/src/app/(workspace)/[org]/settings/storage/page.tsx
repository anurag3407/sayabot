import type { Metadata } from "next"
import { requireOrgAccess } from "@/lib/auth"
import { listOrgAgents, listRooms } from "@/lib/queries"
import { createAdminClient } from "@/lib/supabase/admin"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { StorageView, type StorageCategory } from "@/components/storage/storage-view"

export const metadata: Metadata = { title: "Storage" }
export const dynamic = "force-dynamic"

interface Summary {
  measured_at: string
  chat: { bytes: number; count: number }
  files: { bytes: number; count: number }
  memory: { bytes: number; count: number }
  tools: { bytes: number; count: number }
  computers: { bytes: number; count: number }
  agents: Array<{ agent_id: string; chat_bytes: number; messages: number; memory_bytes: number; memories: number; computer_bytes: number }>
  rooms: Array<{ room_id: string; bytes: number; messages: number; files: number }>
}

export default async function StoragePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const supabase = await createSupabaseServerClient()
  const [summaryRes, agents, rooms, hostsRes] = await Promise.all([
    supabase.rpc("storage_summary", { p_org: access.org.id }),
    listOrgAgents(access.org.id),
    listRooms(access.org.id),
    createAdminClient()
      .from("desktop_hosts")
      .select("id, name, storage")
      .eq("user_id", access.user.id)
      .is("revoked_at", null),
  ])
  const summary = (summaryRes.error ? null : summaryRes.data) as Summary | null
  const n = (v: unknown) => Number(v) || 0
  const categories: StorageCategory[] = summary
    ? [
        { id: "chat", label: "Chat history", bytes: n(summary.chat.bytes), count: n(summary.chat.count), unit: "messages", color: "#5b9df5" },
        { id: "files", label: "Files & canvases", bytes: n(summary.files.bytes), count: n(summary.files.count), unit: "files", color: "#4fcdb0" },
        { id: "memory", label: "Agent memory", bytes: n(summary.memory.bytes), count: n(summary.memory.count), unit: "memories", color: "#b79cf0" },
        { id: "tools", label: "Tool activity", bytes: n(summary.tools.bytes), count: n(summary.tools.count), unit: "calls", color: "#f2c14e" },
        { id: "computers", label: "Agent computers", bytes: n(summary.computers.bytes), count: n(summary.computers.count), unit: "computers", color: "#ff7a70" },
      ]
    : []
  const agentById = new Map(agents.map((a) => [a.id, a]))
  const roomById = new Map(rooms.map((r) => [r.id, r]))

  return (
    <StorageView
      unavailable={!summary}
      measuredAt={summary?.measured_at ?? null}
      categories={categories}
      agents={(summary?.agents ?? [])
        .map((a) => {
          const agent = agentById.get(a.agent_id)
          return {
            id: a.agent_id,
            name: agent?.displayName ?? "Agent",
            handle: agent?.handle ?? a.agent_id,
            bytes: n(a.chat_bytes) + n(a.memory_bytes) + n(a.computer_bytes),
            messages: n(a.messages),
            memories: n(a.memories),
          }
        })
        .sort((a, b) => b.bytes - a.bytes)}
      rooms={(summary?.rooms ?? [])
        .filter((r) => n(r.bytes) > 0)
        .map((r) => ({
          id: r.room_id,
          name: roomById.get(r.room_id)?.name ?? "Chat",
          bytes: n(r.bytes),
          messages: n(r.messages),
          files: n(r.files),
        }))}
      computers={((hostsRes.data ?? []) as { id: string; name: string; storage: Record<string, unknown> | null }[]).map((h) => {
        const s = (h.storage ?? {}) as { measuredAt?: string; appData?: { bytes?: number }; agents?: Array<{ handle: string; bytes: number; files: number }> }
        return { id: h.id, name: h.name, measuredAt: s.measuredAt ?? null, appBytes: n(s.appData?.bytes), agents: s.agents ?? [] }
      })}
    />
  )
}
