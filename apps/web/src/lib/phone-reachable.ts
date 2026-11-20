import os from "node:os"

// Which address can a phone actually open? A Sayabot running on someone's Mac knows itself as
// http://localhost:7431, which on a phone means the phone. These helpers swap in an address the
// phone can reach, and say how far it reaches, so pairing works for self-hosted and Mac setups.

export type Reach = "anywhere" | "same-wifi" | "this-computer"

function hostnameOf(url: string): string | null {
  const m = /^https?:\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(url.trim())
  return m?.[1] ? m[1].toLowerCase() : null
}

/** localhost, 127.x, ::1, 0.0.0.0: addresses that only ever mean "this machine". */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    /^127\./.test(h) ||
    h === "::1" ||
    h === "0.0.0.0"
  )
}

/** Home and office network addresses: reachable from a phone on the same Wi-Fi only. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return (
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h.endsWith(".local")
  )
}

export function reachOf(url: string): Reach {
  const host = hostnameOf(url)
  if (!host || isLoopbackHost(host)) return "this-computer"
  return isPrivateHost(host) ? "same-wifi" : "anywhere"
}

type Interfaces = ReturnType<typeof os.networkInterfaces>

/** This machine's Wi-Fi/Ethernet IPv4 address (192.168.x.x first), or null. */
export function lanIPv4(interfaces: Interfaces = os.networkInterfaces()): string | null {
  const found: string[] = []
  for (const list of Object.values(interfaces)) {
    for (const addr of list ?? []) {
      const v4 = addr.family === "IPv4" || (addr.family as unknown) === 4
      if (
        v4 &&
        !addr.internal &&
        isPrivateHost(addr.address) &&
        !/^169\.254\./.test(addr.address)
      ) {
        found.push(addr.address)
      }
    }
  }
  return found.find((a) => a.startsWith("192.168.")) ?? found[0] ?? null
}

function withHost(url: string, hostname: string): string {
  return url.replace(/^(https?:\/\/)(\[[^\]]+\]|[^/:?#]+)/i, `$1${hostname}`)
}

/**
 * The best address to hand a phone, in order: the address the person's browser is using right
 * now (a domain, a tunnel, a LAN IP), the configured app URL, then the app URL with this machine's
 * LAN IP in place of localhost.
 */
export function phoneServerUrl(
  appUrl: string,
  requestOrigin: string | null,
  lanIp: string | null,
): { url: string; reach: Reach } {
  const app = appUrl.replace(/\/+$/, "")
  const fromRequest = requestOrigin?.replace(/\/+$/, "") ?? null
  if (fromRequest && reachOf(fromRequest) !== "this-computer") {
    return { url: fromRequest, reach: reachOf(fromRequest) }
  }
  if (reachOf(app) !== "this-computer") return { url: app, reach: reachOf(app) }
  const base = fromRequest ?? app
  if (lanIp) {
    const swapped = withHost(base, lanIp)
    return { url: swapped, reach: reachOf(swapped) }
  }
  return { url: base, reach: "this-computer" }
}

/**
 * A local Supabase (http://127.0.0.1:54321) is useless to a phone. When the phone reached this
 * server on a LAN address, give it Supabase on that same address and port instead.
 */
export function supabaseUrlForClient(supabaseUrl: string, requestHostname: string | null): string {
  const host = hostnameOf(supabaseUrl)
  if (!host || !isLoopbackHost(host) || !requestHostname) return supabaseUrl
  if (isLoopbackHost(requestHostname)) return supabaseUrl
  return withHost(supabaseUrl, requestHostname)
}

/**
 * Where cloudflared should dial for an address that only this machine can open.
 * A LAN IP is still this machine, so the tunnel targets loopback and keeps the port.
 * Public hosts return null — they are already reachable.
 */
export function loopbackTunnelTarget(url: string): string | null {
  if (reachOf(url) === "anywhere") return null
  const match = /^https?:\/\/(?:\[[^\]]+\]|[^/:?#]+)(?::(\d+))?/i.exec(url.trim())
  if (!match) return null
  return `http://127.0.0.1${match[1] ? `:${match[1]}` : ""}`
}
