import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { createAdminClient } from "@/lib/supabase/admin"

const PERMISSION_VALUES = new Set(["granted", "denied", "not-determined", "restricted", "unknown"])

/**
 * Every couple of seconds the desktop app says it's alive (with its permission state and the
 * agent apps it found) and picks up remote-desktop requests waiting for it.
 */
export async function POST(request: Request) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    // empty heartbeat is fine
  }
  const permissions: Record<string, string> = {}
  if (body.permissions && typeof body.permissions === "object") {
    for (const [k, v] of Object.entries(body.permissions as Record<string, unknown>)) {
      if (typeof v === "string" && PERMISSION_VALUES.has(v) && /^[a-z_]{1,30}$/.test(k)) permissions[k] = v
    }
  }
  const localAgents = Array.isArray(body.localAgents)
    ? (body.localAgents as unknown[])
        .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object")
        .slice(0, 20)
        .map((a) => ({
          id: String(a.id ?? "").slice(0, 40),
          name: String(a.name ?? "").slice(0, 60),
          status: String(a.status ?? "").slice(0, 20),
          version: a.version ? String(a.version).slice(0, 20) : null,
        }))
    : host.local_agents

  // Sent every ~10 minutes: what Sayabot takes up on that computer.
  let storage: Record<string, unknown> | undefined
  if (body.storage && typeof body.storage === "object") {
    const raw = body.storage as Record<string, unknown>
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)
    const appData = (raw.appData ?? {}) as Record<string, unknown>
    storage = {
      measuredAt: new Date().toISOString(),
      appData: { bytes: num(appData.bytes), approximate: appData.approximate === true },
      agents: Array.isArray(raw.agents)
        ? (raw.agents as Record<string, unknown>[]).slice(0, 100).map((a) => ({
            handle: String(a.handle ?? "").slice(0, 40),
            bytes: num(a.bytes),
            files: num(a.files),
            approximate: a.approximate === true,
          }))
        : [],
    }
  }

  const admin = createAdminClient()
  await admin
    .from("desktop_hosts")
    .update({ last_seen_at: new Date().toISOString(), permissions, local_agents: localAgents, ...(storage ? { storage } : {}) })
    .eq("id", host.id)

  // Requests older than two minutes were abandoned by the viewer.
  const since = new Date(Date.now() - 120_000).toISOString()
  const { data: sessions } = await admin
    .from("remote_sessions")
    .select("id, viewer_user_id, control, offer, created_at")
    .eq("host_id", host.id)
    .eq("status", "requested")
    .gte("created_at", since)
    .order("created_at")
    .limit(4)
  const viewerIds = [...new Set((sessions ?? []).map((s) => s.viewer_user_id as string))]
  const { data: viewers } = viewerIds.length
    ? await admin.from("profiles").select("id, display_name").in("id", viewerIds)
    : { data: [] }
  const names = new Map(((viewers ?? []) as { id: string; display_name: string }[]).map((v) => [v.id, v.display_name]))

  const { count: queuedJobs } = await admin
    .from("local_runner_jobs")
    .select("id", { count: "exact", head: true })
    .eq("host_id", host.id)
    .eq("status", "queued")
  const { count: secretJobs } = await admin
    .from("desktop_secret_jobs")
    .select("id", { count: "exact", head: true })
    .eq("host_id", host.id)
    .eq("status", "queued")
  const { count: mcpCalls } = await admin
    .from("desktop_mcp_calls")
    .select("id", { count: "exact", head: true })
    .eq("host_id", host.id)
    .eq("status", "queued")

  return NextResponse.json({
    settings: host.settings,
    sessions: (sessions ?? []).map((s) => ({
      id: s.id,
      viewerName: names.get(s.viewer_user_id as string) ?? "Someone",
      isOwner: s.viewer_user_id === host.user_id,
      control: s.control,
      offer: s.offer,
    })),
    queuedJobs: queuedJobs ?? 0,
    secretJobs: secretJobs ?? 0,
    mcpCalls: mcpCalls ?? 0,
  })
}
