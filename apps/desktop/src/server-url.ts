/** Turns what someone typed ("sayabot.acme.com", "http://10.0.0.5:3000/") into a base URL. */
export function normalizeServerUrl(input: string): string | null {
  let value = (input || "").trim()
  if (!value || /\s/.test(value)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    // A scheme was typed: only web addresses make sense here.
    if (!/^https?:\/\//i.test(value)) return null
  } else {
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^/]+\.local)/i.test(
      value,
    )
    value = `${local ? "http" : "https"}://${value}`
  }
  try {
    const url = new URL(value)
    // A real host: a domain with a dot, localhost, or an IP address.
    if (!url.hostname.includes(".") && url.hostname !== "localhost" && !url.hostname.includes(":"))
      return null
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`
  } catch {
    return null
  }
}
