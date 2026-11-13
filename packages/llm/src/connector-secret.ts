/** A connector's stored secret is either the token itself, or a token plus a chat-webhook secret. */
export function unwrapConnectorSecret(plain: string): { token: string; inboundSecret: string | null } {
  const trimmed = plain.trim()
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { token?: unknown; inboundSecret?: unknown }
      if (typeof parsed.token === "string" && parsed.token.length > 0) {
        return {
          token: parsed.token,
          inboundSecret: typeof parsed.inboundSecret === "string" && parsed.inboundSecret.length > 0 ? parsed.inboundSecret : null,
        }
      }
    } catch {
      // A token that happens to start with "{" is still just a token.
    }
  }
  return { token: plain, inboundSecret: null }
}

export function wrapConnectorSecret(token: string, inboundSecret: string | null): string {
  if (!inboundSecret) return token
  return JSON.stringify({ token, inboundSecret })
}
