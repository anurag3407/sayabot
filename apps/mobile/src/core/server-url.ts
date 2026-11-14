/**
 * Turns what someone typed ("sayabot.acme.com", "192.168.1.20:3000/") into a base URL.
 * No `URL` here on purpose: React Native's URL doesn't implement hostname/protocol.
 */
export function normalizeServerUrl(input: string): string | null {
  let value = (input || "").trim()
  if (!value || /\s/.test(value)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    if (!/^https?:\/\//i.test(value)) return null
  } else {
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^/]+\.local)/i.test(
      value,
    )
    value = `${local ? "http" : "https"}://${value}`
  }
  const match = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(value)
  if (!match?.[1] || !match[2]) return null
  const scheme = match[1].toLowerCase()
  const host = match[2].toLowerCase()
  const hostname = host.replace(/:\d+$/, "")
  if (!/^[a-z0-9.-]+$/.test(hostname) && !hostname.startsWith("[")) return null
  if (!hostname.includes(".") && hostname !== "localhost") return null
  return `${scheme}://${host}${(match[3] ?? "").replace(/\/+$/, "")}`
}

/** A Sayabot server as the phone remembers it (same shape as SavedServer in supabase.ts). */
export interface CheckedServer {
  webApiUrl: string
  name: string
  supabaseUrl: string
  supabaseAnonKey: string
}

export type ServerCheck = { ok: true; server: CheckedServer } | { ok: false; error: string }

export async function checkServer(input: string): Promise<ServerCheck> {
  const url = normalizeServerUrl(input)
  if (!url) return { ok: false, error: "That doesn't look like a web address." }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await fetch(`${url}/api/instance`, { signal: controller.signal })
    const data = res.ok
      ? ((await res.json().catch(() => null)) as Record<string, unknown> | null)
      : null
    if (!data || data.sayabot !== true) {
      return {
        ok: false,
        error: "That server answered, but it isn't running Sayabot (or it needs an update).",
      }
    }
    const sb = (data.supabase ?? {}) as { url?: unknown; anonKey?: unknown }
    if (typeof sb.url !== "string" || typeof sb.anonKey !== "string") {
      return { ok: false, error: "That server isn't set up for the phone app yet." }
    }
    return {
      ok: true,
      server: {
        webApiUrl: url,
        name:
          typeof data.name === "string" && data.name ? data.name : url.replace(/^https?:\/\//, ""),
        supabaseUrl: sb.url,
        supabaseAnonKey: sb.anonKey,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/abort/i.test(message))
      return { ok: false, error: "The server didn't answer in time. Is it running?" }
    return {
      ok: false,
      error: "Couldn't reach that server. Check the address and your connection.",
    }
  } finally {
    clearTimeout(timer)
  }
}
