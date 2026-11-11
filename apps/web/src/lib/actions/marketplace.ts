"use server"

import { sealSecret } from "@sayabot/llm"
import { listMcpTools } from "@/lib/actions/mcp"
import { adminOrgAccess, audit, errorMessage, fail, ok, revalidateOrg } from "@/lib/actions/shared"
import { getKek } from "@/lib/env"
import { findMarketplaceApp } from "@/lib/marketplace"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ActionResult } from "@/lib/types"

/**
 * Connects a Marketplace app. The browser sends only the app id and the person's key; the
 * URL, transport and headers come from the catalog. The connection is tested right away so
 * a wrong key shows up here, not later in a room.
 */
export async function connectMarketplaceAppAction(input: {
  orgSlug: string
  appId: string
  secret?: string
  personalUrl?: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const app = findMarketplaceApp(input.appId)
  if (!app) return fail("App not found")

  const secret = input.secret?.trim() ?? ""
  let url = app.url
  const headers: Record<string, string> = {}

  switch (app.auth.kind) {
    case "oauth":
      return fail(`${app.name} needs a sign-in flow that isn't available yet.`)
    case "none":
      break
    case "token":
      if (!secret && !app.auth.optional) return fail(`Paste your ${app.auth.label.toLowerCase()}`)
      if (secret) headers[app.auth.header] = `${app.auth.prefix}${secret}`
      break
    case "url-key":
      if (!secret) return fail(`Paste your ${app.auth.label.toLowerCase()}`)
      if (/[\s/?#&]/.test(secret)) return fail("That key has characters a key can't have. Copy it again.")
      url = app.auth.template.replace("{key}", encodeURIComponent(secret))
      break
    case "personal-url": {
      const personal = input.personalUrl?.trim() ?? ""
      let parsed: URL
      try {
        parsed = new URL(personal)
      } catch {
        return fail(`Paste your ${app.name} URL`)
      }
      const host = app.auth.host
      if (parsed.protocol !== "https:" || !(parsed.host === host || parsed.host.endsWith(`.${host}`))) {
        return fail(`That doesn't look like a ${app.name} URL (it should be on ${host}).`)
      }
      url = parsed.toString()
      break
    }
  }

  const admin = createAdminClient()
  const { data: server, error } = await admin
    .from("mcp_servers")
    .insert({
      org_id: check.access.org.id,
      room_id: null,
      name: app.name,
      transport: app.transport,
      url,
      headers_enc: Object.keys(headers).length ? sealSecret(JSON.stringify({ headers }), getKek()) : null,
      dangerous_tools: app.dangerousTools ?? [],
      enabled: true,
      created_by: check.access.user.id,
    })
    .select("id")
    .single()
  if (error || !server) return fail(errorMessage(error) || "Could not save the connection")

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "mcp_server.created",
    target: app.name,
    metadata: { marketplaceApp: app.id, transport: app.transport },
  })

  const test = await listMcpTools(input.orgSlug, server.id)
  revalidateOrg(input.orgSlug)
  const tools = Array.isArray((test.data as { tools?: unknown[] } | undefined)?.tools)
    ? ((test.data as { tools: unknown[] }).tools.length)
    : null
  if (!test.ok) {
    return ok(`Saved, but ${app.name} didn't answer yet: ${test.error ?? "unknown error"}. Check the key and try again.`, {
      serverId: server.id,
      reachable: false,
    })
  }
  return ok(tools !== null ? `${app.name} connected with ${tools} tools` : `${app.name} connected`, {
    serverId: server.id,
    reachable: true,
    tools,
  })
}

export async function disconnectMarketplaceServerAction(input: { orgSlug: string; serverId: string }): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: server } = await admin.from("mcp_servers").select("id, org_id, name").eq("id", input.serverId).maybeSingle()
  if (!server || server.org_id !== check.access.org.id) return fail("Connection not found")
  const { error } = await admin.from("mcp_servers").delete().eq("id", server.id)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "mcp_server.deleted",
    target: server.name,
  })
  revalidateOrg(input.orgSlug)
  return ok(`${server.name} disconnected`)
}
