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
