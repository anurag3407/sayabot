"use server"

import { beginMcpOAuth, sealSecret } from "@sayabot/llm"
import { listMcpTools } from "@/lib/actions/mcp"
import { adminOrgAccess, audit, errorMessage, fail, ok, revalidateOrg } from "@/lib/actions/shared"
import { getKek } from "@/lib/env"
import { findMarketplaceApp, type MarketplaceApp } from "@/lib/marketplace"
import { mcpOAuthRedirectUrl, persistMcpOAuth, readMcpOAuth } from "@/lib/mcp-oauth"
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
  let sealedEnv: Record<string, string> | null = null

  if (app.transport === "stdio") {
    if (app.auth.kind === "token" && app.auth.env) {
      if (!secret) return fail(`Paste your ${app.auth.label.toLowerCase()}`)
      if (!/^[A-Z][A-Z0-9_]{0,40}$/.test(app.auth.env)) return fail("That app isn't set up to take a key")
      sealedEnv = { [app.auth.env]: secret }
    }
  }

  if (app.transport !== "stdio") switch (app.auth.kind) {
    case "oauth":
      return fail(`${app.name} connects with a sign-in. Use Sign in instead.`)
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
      headers_enc: sealedEnv
        ? sealSecret(JSON.stringify({ env: sealedEnv }), getKek())
        : Object.keys(headers).length
          ? sealSecret(JSON.stringify({ headers }), getKek())
          : null,
      dangerous_tools: app.dangerousTools ?? [],
      enabled: true,
      created_by: check.access.user.id,
      catalog_app: app.id,
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

  if (app.transport === "stdio") {
    revalidateOrg(input.orgSlug)
    const where =
      app.runOn === "desktop"
        ? "It runs on a computer with the Sayabot app open."
        : "The first time an agent uses it, Sayabot installs the program."
    return ok(`${app.name} saved. ${where}`, { serverId: server.id, reachable: true })
  }

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

/** What a sign-in app may do without asking: reads only, unless the catalog names the writes. */
function signInDangerousTools(app: MarketplaceApp): string[] {
  return app.dangerousTools?.length ? app.dangerousTools : ["@writes"]
}

/**
 * Starts "Sign in with …" for a Marketplace app. Returns the vendor's sign-in page; the browser
 * goes there and the vendor sends it back to /api/mcp/oauth/callback. Passing `serverId` signs
 * an existing connection in again (expired or revoked tokens).
 */
export async function startMarketplaceSignInAction(input: {
  orgSlug: string
  appId: string
  serverId?: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const app = findMarketplaceApp(input.appId)
  if (!app) return fail("App not found")
  if (app.auth.kind !== "oauth") return fail(`${app.name} connects with a key, not a sign-in`)

  const admin = createAdminClient()
  const orgId = check.access.org.id
  let row: { id: string; url: string; oauth_enc: string | null } | null = null
  if (input.serverId) {
    const { data } = await admin
      .from("mcp_servers")
      .select("id, org_id, url, oauth_enc, auth_kind")
      .eq("id", input.serverId)
      .maybeSingle()
    if (!data || data.org_id !== orgId || data.auth_kind !== "oauth") return fail("Connection not found")
    row = data
  } else {
    // A sign-in that was started and abandoned is picked up again rather than duplicated.
    const { data: pendingRow } = await admin
      .from("mcp_servers")
      .select("id, url, oauth_enc")
      .eq("org_id", orgId)
      .eq("catalog_app", app.id)
      .eq("auth_status", "pending")
      .is("room_id", null)
      .limit(1)
      .maybeSingle()
    if (pendingRow) {
      row = pendingRow
    } else {
      const { data: created, error } = await admin
        .from("mcp_servers")
        .insert({
          org_id: orgId,
          room_id: null,
          name: app.name,
          transport: app.transport,
          url: app.url,
          headers_enc: null,
          dangerous_tools: signInDangerousTools(app),
          enabled: true,
          created_by: check.access.user.id,
          auth_kind: "oauth",
          auth_status: "pending",
          catalog_app: app.id,
        })
        .select("id, url, oauth_enc")
        .single()
      if (error || !created) return fail(errorMessage(error) || "Could not start the sign-in")
      row = created
    }
  }

  try {
    const { authorizationUrl } = await beginMcpOAuth({
      serverId: row.id,
      serverUrl: row.url,
      redirectUrl: mcpOAuthRedirectUrl(),
      persist: persistMcpOAuth(row.id),
      previous: readMcpOAuth(row) ?? undefined,
    })
    if (!authorizationUrl) {
      await admin.from("mcp_servers").update({ auth_status: "ok" }).eq("id", row.id)
      revalidateOrg(input.orgSlug)
      return ok(`${app.name} connected`, { serverId: row.id, authorizationUrl: null })
    }
    if (input.serverId) {
      await admin.from("mcp_servers").update({ auth_status: "pending" }).eq("id", row.id)
    }
    return ok(`Opening ${app.name} sign-in`, { serverId: row.id, authorizationUrl })
  } catch (error) {
    return fail(`${app.name} sign-in could not start: ${errorMessage(error)}`)
  }
}
