import "server-only"
import {
  openMcpOAuthState,
  sealMcpOAuthState,
  StoredMcpOAuthProvider,
  type McpOAuthState,
} from "@sayabot/llm"
import { getAppUrl, getKek } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

/** Where vendors send people back after "Sign in with …". Must match the client registration. */
export function mcpOAuthRedirectUrl(): string {
  return `${getAppUrl()}/api/mcp/oauth/callback`
}

/** Saves the sealed sign-in state on the row. */
export function persistMcpOAuth(serverId: string) {
  return async (state: McpOAuthState) => {
    const { error } = await createAdminClient()
      .from("mcp_servers")
      .update({ oauth_enc: sealMcpOAuthState(state, getKek()), updated_at: new Date().toISOString() })
      .eq("id", serverId)
    if (error) throw new Error(`Could not save the sign-in: ${error.message}`)
  }
}

export function readMcpOAuth(row: { oauth_enc: string | null }): McpOAuthState | null {
  if (!row.oauth_enc) return null
  try {
    return openMcpOAuthState(row.oauth_enc, getKek())
  } catch {
    return null
  }
}

/**
 * For testing a signed-in server from the web app (tool list, Try a tool). Refreshed tokens
 * are saved; a refused refresh marks the row signed out.
 */
export function mcpAuthProviderFor(row: {
  id: string
  auth_kind?: string | null
  oauth_enc: string | null
}): StoredMcpOAuthProvider | undefined {
  if (row.auth_kind !== "oauth") return undefined
  const state = readMcpOAuth(row)
  if (!state?.tokens) throw new Error("Sign in first")
  return new StoredMcpOAuthProvider({
    serverId: row.id,
    state,
    persist: persistMcpOAuth(row.id),
    onRedirect: () => {
      void createAdminClient()
        .from("mcp_servers")
        .update({ auth_status: "signed_out", updated_at: new Date().toISOString() })
        .eq("id", row.id)
    },
  })
}
