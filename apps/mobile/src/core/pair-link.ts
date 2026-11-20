/** Pure helpers for phone pairing (kept free of React Native imports so they unit-test in node). */

export interface PairLink {
  code: string
  server: string | null
}

/** Reads sayabot://pair?code=…&server=… (from a scanned QR or a tapped link). */
export function parsePairLink(url: string | null | undefined): PairLink | null {
  if (!url || !/^sayabot:\/\/pair\b/i.test(url)) return null
  const query = url.split("?")[1] ?? ""
  const params = new URLSearchParams(query)
  const code = (params.get("code") ?? "").trim()
  if (!code) return null
  const server = (params.get("server") ?? "").trim()
  return { code, server: /^https?:\/\//i.test(server) ? server.replace(/\/+$/, "") : null }
}

export function cleanPairCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, "")
}

/**
 * Extracts a server address from any scanned QR text:
 * - sayabot://pair?code=...&server=...
 * - sayabot://connect?server=...
 * - direct http(s) URL
 */
export function extractServerFromScan(data: string | null | undefined): string | null {
  const text = (data ?? "").trim()
  if (!text) return null

  const pair = parsePairLink(text)
  if (pair?.server) return pair.server

  if (/^sayabot:\/\/connect\b/i.test(text)) {
    const query = text.split("?")[1] ?? ""
    const params = new URLSearchParams(query)
    const server = (params.get("server") ?? "").trim()
    if (/^https?:\/\//i.test(server)) return server.replace(/\/+$/, "")
  }

  if (/^https?:\/\/[^\s]+$/i.test(text)) {
    return text.replace(/\/+$/, "")
  }

  return null
}

/**
 * What a scanned QR should sign in with. A Sayabot pair link carries the code and the server.
 * A bare 8-character code still works when the phone is already on the right server.
 */
export function codeFromScan(data: string | null | undefined): PairLink | null {
  const text = (data ?? "").trim()
  if (!text) return null
  const link = parsePairLink(text)
  if (link) return link
  const code = cleanPairCode(text)
  if (code.length !== 8) return null
  return { code, server: null }
}

/** True when the server signs people in on a different Supabase project than this app build. */
export function supabaseMismatch(
  appSupabaseUrl: string,
  serverSupabaseUrl: string | null | undefined,
): boolean {
  if (!serverSupabaseUrl) return false
  // No `URL`: React Native's doesn't implement host.
  const host = (url: string) =>
    /^https?:\/\/([^/?#]+)/i.exec(url.trim())?.[1]?.toLowerCase() ?? null
  const app = host(appSupabaseUrl)
  const server = host(serverSupabaseUrl)
  return Boolean(app && server && app !== server)
}
