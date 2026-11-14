import "server-only"
import { hashAgentApiKey } from "@sayabot/core/server"
import { createAdminClient } from "@/lib/supabase/admin"

export interface HostRow {
  id: string
  user_id: string
  org_id: string | null
  name: string
  platform: string
  app_version: string | null
  token_hash: string
  permissions: Record<string, string>
  local_agents: Array<Record<string, unknown>>
  settings: {
    whoCanControl?: "only_me" | "admins" | "members"
    askOnComputer?: boolean
    runnerEnabled?: boolean
    /** Run the owner's agents here by default (see packages/db DesktopHostSettings). */
    localDefault?: { app: string } | false
  }
  last_seen_at: string | null
  revoked_at: string | null
  created_at: string
}

function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** The desktop app authenticates every call with its host id + host token. */
export async function hostFromRequest(request: Request): Promise<HostRow | null> {
  const id = request.headers.get("x-host-id") ?? ""
  const token = request.headers.get("x-host-token") ?? ""
  if (!/^[0-9a-f-]{36}$/i.test(id) || !token) return null
  const { data } = await createAdminClient().from("desktop_hosts").select("*").eq("id", id).maybeSingle()
  const host = data as HostRow | null
  if (!host || host.revoked_at) return null
  return sameHash(hashAgentApiKey(token), host.token_hash) ? host : null
}

export async function orgRoleOf(userId: string, orgId: string | null): Promise<"owner" | "admin" | "member" | null> {
  if (!orgId) return null
  const { data } = await createAdminClient()
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle()
  return (data?.role as "owner" | "admin" | "member" | undefined) ?? null
}

/** Best app to run agents with on a Mac, from what it reported as signed in (most capable first). */
const DEFAULT_APP_ORDER = ["claude-code", "codex", "gemini", "opencode", "cursor"]

export function pickDefaultApp(localAgents: Array<Record<string, unknown>>): string | null {
  const ready = new Set(
    localAgents.filter((a) => a.status === "ready").map((a) => String(a.id ?? "")),
  )
  return DEFAULT_APP_ORDER.find((id) => ready.has(id)) ?? null
}

/**
 * Sayabot for Mac runs agents on the Mac by default. The first time a signed-in app shows up,
 * turn the runner and the default on; keep the chosen app current if it gets signed out. Once
 * the owner turns the default off (`false`), leave it alone.
 */
export function withLocalDefault(
  settings: HostRow["settings"],
  localAgents: Array<Record<string, unknown>>,
): HostRow["settings"] | null {
  const best = pickDefaultApp(localAgents)
  if (!best || settings.localDefault === false) return null
  if (settings.localDefault === undefined) {
    return { ...settings, runnerEnabled: true, localDefault: { app: best } }
  }
  const current = settings.localDefault.app
  const stillReady = localAgents.some((a) => a.id === current && a.status === "ready")
  return stillReady || current === best ? null : { ...settings, localDefault: { app: best } }
}
