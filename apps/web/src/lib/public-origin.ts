/**
 * Resolves the public origin for OAuth callbacks and external redirects.
 *
 * Rules:
 * 1. 0.0.0.0 is an internal bind address (all interfaces). It is NEVER a routable client
 *    destination. Google Chrome and all modern Chromium browsers explicitly block 0.0.0.0
 *    with ERR_CONNECTION_REFUSED. If detected, it is replaced with "localhost".
 * 2. Behind reverse proxies (Nginx, Caddy, Cloudflare Tunnel), respects x-forwarded-host
 *    and x-forwarded-proto so that production domains (e.g. sayabot.example.com) are preserved.
 * 3. In development, preserves the current listening port (e.g. localhost:3000, localhost:3005).
 * 4. Falls back to NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_APP_URL.
 */
export function getPublicOrigin(request?: Request): string {
  if (request) {
    const forwardedHost = request.headers.get("x-forwarded-host")
    const forwardedProto = request.headers.get("x-forwarded-proto") || "http"
    const host = forwardedHost || request.headers.get("host")

    if (host) {
      let origin = `${forwardedProto}://${host}`
      if (origin.includes("0.0.0.0")) {
        origin = origin.replace("0.0.0.0", "localhost")
      }
      return origin.replace(/\/+$/, "")
    }

    try {
      let origin = new URL(request.url).origin
      if (origin.includes("0.0.0.0")) {
        origin = origin.replace("0.0.0.0", "localhost")
      }
      return origin.replace(/\/+$/, "")
    } catch {}
  }

  const configured =
    process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

  let origin = configured.replace(/\/+$/, "")
  if (origin.includes("0.0.0.0")) {
    origin = origin.replace("0.0.0.0", "localhost")
  }
  return origin
}

/**
 * The default server host configured for the apps (if any).
 */
export const DEFAULT_APP_SERVER_HOST = process.env.DEFAULT_APP_SERVER_HOST || ""

/**
 * True when the apps need to be pointed at this server (always true for self-hosted instances).
 */
export function needsServerAddress(origin: string): boolean {
  try {
    const defaultHost = process.env.DEFAULT_APP_SERVER_HOST || DEFAULT_APP_SERVER_HOST
    if (!defaultHost) return true
    return new URL(origin).hostname !== defaultHost
  } catch {
    return true
  }
}
