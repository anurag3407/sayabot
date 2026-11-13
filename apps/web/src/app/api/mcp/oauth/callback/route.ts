import { NextResponse } from "next/server"
import { completeMcpOAuth, serverIdFromMcpOAuthState } from "@sayabot/llm"
import { audit } from "@/lib/actions/shared"
import { getCurrentUser, getOrgAccess, isOrgAdmin } from "@/lib/auth"
import { getAppUrl } from "@/lib/env"
import { listMcpTools } from "@/lib/actions/mcp"
import { persistMcpOAuth, readMcpOAuth } from "@/lib/mcp-oauth"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 60

/**
 * Vendors send people back here after "Sign in with …" for a Marketplace app. The state names
 * the connection; the person must still be signed in to Sayabot as an admin of its workspace,
 * and the state must match the one sealed on the row when the sign-in started.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const appUrl = getAppUrl()
  const back = (slug: string | null, params: Record<string, string>) => {
    const target = new URL(slug ? `/${slug}/marketplace` : "/", appUrl)
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
    return NextResponse.redirect(target)
  }

  const user = await getCurrentUser()
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(url.pathname + url.search)}`, appUrl))

  const state = url.searchParams.get("state") ?? ""
  const serverId = serverIdFromMcpOAuthState(state)
  if (!serverId) return back(null, { signin_error: "That sign-in link is not valid." })

  const admin = createAdminClient()
  const { data: row } = await admin
    .from("mcp_servers")
    .select("id, org_id, name, url, oauth_enc, auth_kind, catalog_app, orgs!inner(slug)")
    .eq("id", serverId)
    .maybeSingle()
  const slug = (row as { orgs?: { slug?: string } } | null)?.orgs?.slug ?? null
  if (!row || !slug || row.auth_kind !== "oauth") return back(null, { signin_error: "That connection no longer exists." })

  const access = await getOrgAccess(slug, { user })
  if (!access || !isOrgAdmin(access.role)) return back(slug, { signin_error: "Only workspace admins can connect apps." })

  const vendorError = url.searchParams.get("error")
  if (vendorError) {
    const detail = url.searchParams.get("error_description")
    return back(slug, {
      signin_error: vendorError === "access_denied" ? `${row.name} sign-in was cancelled.` : `${row.name}: ${detail || vendorError}`,
    })
  }
  const code = url.searchParams.get("code")
  const saved = readMcpOAuth(row)
  if (!code || !saved) return back(slug, { signin_error: `${row.name} sign-in expired. Start it again.` })

  try {
    await completeMcpOAuth({
      serverId: row.id,
      serverUrl: row.url,
      state: saved,
      code,
      callbackState: state,
      callbackIssuer: url.searchParams.get("iss") ?? undefined,
      persist: persistMcpOAuth(row.id),
    })
  } catch (error) {
    return back(slug, { signin_error: `${row.name}: ${error instanceof Error ? error.message : "sign-in failed"}` })
  }

  await admin.from("mcp_servers").update({ auth_status: "ok", updated_at: new Date().toISOString() }).eq("id", row.id)
  await audit({
    orgId: row.org_id,
    actorId: access.user.id,
    action: "mcp_server.signed_in",
    target: row.name,
    metadata: { marketplaceApp: row.catalog_app, serverId: row.id },
  })
  const test = await listMcpTools(slug, row.id)
  const tools = (test.data as { tools?: unknown[] } | undefined)?.tools
  return back(slug, { connected: row.name, ...(Array.isArray(tools) ? { tools: String(tools.length) } : {}) })
}
