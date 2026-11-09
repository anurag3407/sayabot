import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { isPrivateIp } from "@sayabot/core/server"

export { isPrivateIp } from "@sayabot/core/server"

/**
 * Blocks webhook targets that resolve to loopback, link-local or private
 * networks. DNS is re-checked on every delivery attempt.
 */
export async function assertSafeWebhookUrl(raw: string, allowPrivate: boolean): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("invalid webhook URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("webhook URL must use http or https")
  }
  if (url.username || url.password) throw new Error("webhook URL must not contain credentials")
  if (allowPrivate) return url
  const host = url.hostname.toLowerCase()
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("webhook URL resolves to a private host")
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("webhook URL points at a private address")
    return url
  }
  const addresses = await lookup(host, { all: true, verbatim: true })
  if (addresses.length === 0) throw new Error("webhook host did not resolve")
  for (const address of addresses) {
    if (isPrivateIp(address.address)) throw new Error("webhook host resolves to a private address")
  }
  return url
}
