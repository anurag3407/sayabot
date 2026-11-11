import "server-only"
import { canOpenHost, hostOnline } from "@sayabot/core"
import type { HostRow } from "@/lib/desktop-hosts"
import { createAdminClient } from "@/lib/supabase/admin"

export interface ComputerView {
  id: string
  name: string
  platform: string
  appVersion: string | null
  online: boolean
  lastSeenAt: string | null
  mine: boolean
  ownerName: string | null
  permissions: Record<string, string>
  localAgents: Array<{ id: string; name: string; status: string; version: string | null }>
  settings: HostRow["settings"]
}

/** Computers this person can open: their own, plus ones shared with this workspace. */
export async function listComputers(userId: string, orgId: string, role: "owner" | "admin" | "member"): Promise<ComputerView[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("desktop_hosts")
    .select("*")
    .is("revoked_at", null)
    .or(`user_id.eq.${userId},org_id.eq.${orgId}`)
    .order("created_at")
  if (error) return []
  const hosts = (data ?? []) as HostRow[]
  const ownerIds = [...new Set(hosts.map((h) => h.user_id))]
  const { data: owners } = ownerIds.length ? await admin.from("profiles").select("id, display_name").in("id", ownerIds) : { data: [] }
  const ownerNames = new Map(((owners ?? []) as { id: string; display_name: string }[]).map((o) => [o.id, o.display_name]))
  return hosts
    .filter((h) =>
      canOpenHost({
        ownerId: h.user_id,
        viewerId: userId,
        hostOrgId: h.org_id,
        whoCanControl: h.settings?.whoCanControl,
        viewerOrgRole: h.org_id === orgId ? role : null,
      }),
    )
    .map((h) => ({
      id: h.id,
      name: h.name,
      platform: h.platform,
      appVersion: h.app_version,
      online: hostOnline(h.last_seen_at),
      lastSeenAt: h.last_seen_at,
      mine: h.user_id === userId,
      ownerName: ownerNames.get(h.user_id) ?? null,
      permissions: h.permissions ?? {},
      localAgents: (h.local_agents ?? []) as ComputerView["localAgents"],
      settings: h.settings ?? {},
    }))
}
