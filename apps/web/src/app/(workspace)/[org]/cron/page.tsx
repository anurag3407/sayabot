import type { Metadata } from "next"
import { humanReadableCron } from "@sayabot/core"
import { requireOrgAccess } from "@/lib/auth"
import { listOrgAgents, listRooms } from "@/lib/queries"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { N8nCanvas, type RoutineChatTarget, type RoutineItem } from "@/components/cron/n8n-canvas"

const CHAT_SOURCES = ["telegram", "discord", "whatsapp"]
const CHAT_LABELS: Record<string, string> = { telegram: "Telegram", discord: "Discord", whatsapp: "WhatsApp" }

export const metadata: Metadata = { title: "Cron Automations & Routines" }

export default async function CronPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const supabase = await createSupabaseServerClient()

  const [routinesRes, rooms, agents, connectorsRes] = await Promise.all([
    supabase
      .from("routines")
      .select(`
        id,
        name,
        description,
        schedule_expr,
        schedule_kind,
        timezone,
        prompt,
        enabled,
        next_run_at,
        last_run_at,
        last_status,
        last_error,
        run_count,
        metadata,
        created_at,
        agents ( id, handle, display_name, avatar_url, model ),
        rooms ( id, name, kind )
      `)
      .eq("org_id", access.org.id)
      .order("created_at", { ascending: false }),
    listRooms(access.org.id),
    listOrgAgents(access.org.id),
    supabase
      .from("workspace_connectors")
      .select("id, name, source, status, config")
      .eq("org_id", access.org.id)
      .in("source", CHAT_SOURCES)
      .eq("status", "active"),
  ])

  // Chats a routine can also send its results to: the allowed chats of connectors whose chat
  // is turned on (Settings → Connectors → Chat). The orchestrator re-checks all of this.
  const chatTargets: RoutineChatTarget[] = (connectorsRes.data || []).flatMap((c: any) => {
    const inbound = (c.config?.inbound ?? {}) as { enabled?: boolean; allowedChats?: string[] }
    if (!inbound.enabled) return []
    return (inbound.allowedChats ?? []).map((chatId) => ({
      connectorId: c.id as string,
      chatId,
      label: `${CHAT_LABELS[c.source] ?? c.source} · ${c.name} · ${chatId}`,
    }))
  })

  const initialRoutines: RoutineItem[] = (routinesRes.data || []).map((r: any) => ({
    ...r,
    human_schedule: humanReadableCron(r.schedule_expr),
  }))

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <N8nCanvas
        orgSlug={orgSlug}
        initialRoutines={initialRoutines}
        availableAgents={agents.map((a) => ({
          id: a.id,
          handle: a.handle,
          displayName: a.displayName,
          model: a.model || "standard",
        }))}
        availableRooms={rooms
          .filter((room) => room.kind !== "dm")
          .map((room) => ({ id: room.id, name: room.name, kind: room.kind }))}
        chatTargets={chatTargets}
      />
    </div>
  )
}
