import type { Metadata } from "next"
import { humanReadableCron } from "@sayabot/core"
import { requireOrgAccess } from "@/lib/auth"
import { listOrgAgents, listRooms } from "@/lib/queries"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { N8nCanvas, type RoutineItem } from "@/components/cron/n8n-canvas"

export const metadata: Metadata = { title: "Cron Automations & Routines" }

export default async function CronPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  const supabase = await createSupabaseServerClient()

  const [routinesRes, rooms, agents] = await Promise.all([
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
  ])

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
      />
    </div>
  )
}
