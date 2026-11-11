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

/** True when the server signs people in on a different Supabase project than this app build. */
export function supabaseMismatch(appSupabaseUrl: string, serverSupabaseUrl: string | null | undefined): boolean {
  if (!serverSupabaseUrl) return false
  try {
    return new URL(appSupabaseUrl).host !== new URL(serverSupabaseUrl).host
  } catch {
    return false
  }
}
