import { openSecret } from "@sayabot/llm"
import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { getKek } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

const METHODS = new Set(["tools/list", "tools/call"])
const ENV_KEYS = new Set(["OBSIDIAN_API_KEY", "OBSIDIAN_HOST", "OBSIDIAN_PORT"])

/** One local-app call. The computer maps the app id to a fixed command; the server cannot name a binary. */
export async function POST(request: Request) {
  const host = await hostFromRequest(request)
  if (!host?.org_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const admin = createAdminClient()
  const { data: next } = await admin
    .from("desktop_mcp_calls")
    .select("id")
    .eq("host_id", host.id)
    .eq("status", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle()
  if (!next) return NextResponse.json({ call: null })
  const { data: call } = await admin
    .from("desktop_mcp_calls")
    .update({ status: "running" })
    .eq("id", next.id)
    .eq("status", "queued")
    .select("id, org_id, server_id, app_id, method, params")
    .maybeSingle()
  if (!call || call.org_id !== host.org_id || !METHODS.has(call.method)) return NextResponse.json({ call: null })

  const { data: server } = await admin
    .from("mcp_servers")
    .select("org_id, catalog_app, headers_enc, enabled")
    .eq("id", call.server_id)
    .maybeSingle()
  if (!server || server.org_id !== host.org_id || server.catalog_app !== call.app_id || !server.enabled) {
    await admin.from("desktop_mcp_calls").update({ status: "failed", error: "App is not connected", finished_at: new Date().toISOString() }).eq("id", call.id)
    return NextResponse.json({ call: null })
  }
  const env: Record<string, string> = {}
  if (server.headers_enc) {
    try {
      const parsed = JSON.parse(openSecret(server.headers_enc, getKek())) as { env?: Record<string, unknown> }
      for (const [key, value] of Object.entries(parsed.env ?? {})) {
        if (ENV_KEYS.has(key) && typeof value === "string") env[key] = value
      }
    } catch {
      await admin.from("desktop_mcp_calls").update({ status: "failed", error: "Could not read the saved key", finished_at: new Date().toISOString() }).eq("id", call.id)
      return NextResponse.json({ call: null })
    }
  }
  return NextResponse.json({
    call: { id: call.id, serverId: call.server_id, appId: call.app_id, method: call.method, params: call.params ?? {}, env },
  })
}
