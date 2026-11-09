import { promises as dns } from "node:dns"
import { isIP } from "node:net"

type Ipv6Words = [number, number, number, number, number, number, number, number]

function parseIpv6Words(ip: string): Ipv6Words | null {
  let clean = ip.replace(/^\[|\]$/g, "").toLowerCase()
  // Handle IPv4 embedded inside IPv6: e.g. ::ffff:192.168.1.1
  if (clean.includes(".")) {
    const lastColon = clean.lastIndexOf(":")
    if (lastColon === -1) return null
    const ipv4Part = clean.slice(lastColon + 1)
    const parts = ipv4Part.split(".").map(Number)
    if (parts.length !== 4) return null
    const p0 = parts[0]
    const p1 = parts[1]
    const p2 = parts[2]
    const p3 = parts[3]
    if (
      p0 === undefined ||
      p1 === undefined ||
      p2 === undefined ||
      p3 === undefined ||
      isNaN(p0) ||
      isNaN(p1) ||
      isNaN(p2) ||
      isNaN(p3) ||
      p0 < 0 ||
      p0 > 255 ||
      p1 < 0 ||
      p1 > 255 ||
      p2 < 0 ||
      p2 > 255 ||
      p3 < 0 ||
      p3 > 255
    ) {
      return null
    }
    const hex1 = (((p0 << 8) | p1) >>> 0).toString(16)
    const hex2 = (((p2 << 8) | p3) >>> 0).toString(16)
    clean = clean.slice(0, lastColon + 1) + hex1 + ":" + hex2
  }

  const doubleColon = clean.indexOf("::")
  let parts: string[] = []
  if (doubleColon !== -1) {
    const left = clean.slice(0, doubleColon).split(":").filter(Boolean)
    const right = clean.slice(doubleColon + 2).split(":").filter(Boolean)
    const missing = 8 - (left.length + right.length)
    if (missing < 0) return null
    parts = [...left, ...Array<string>(missing).fill("0"), ...right]
  } else {
    parts = clean.split(":").filter(Boolean)
  }

  if (parts.length !== 8) return null
  const parsed = parts.map((p) => parseInt(p, 16))
  if (parsed.some((n) => isNaN(n))) return null
  return parsed as Ipv6Words
}

export function isPrivateIp(rawIp: string): boolean {
  const ip = rawIp.replace(/^\[|\]$/g, "").trim().toLowerCase()
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost" || ip === "::") return true

  const ipVersion = isIP(ip)

  // IPv4 checks
  if (ipVersion === 4) {
    const parts = ip.split(".").map(Number)
    const a = parts[0]
    const b = parts[1]
    if (a === undefined) return true

    // Loopback 127.0.0.0/8
    if (a === 127) return true
    // RFC1918: 10.0.0.0/8
    if (a === 10) return true
    // RFC1918: 172.16.0.0/12
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
    // RFC1918: 192.168.0.0/16
    if (a === 192 && b === 168) return true
    // Link-local / Cloud metadata: 169.254.0.0/16
    if (a === 169 && b === 254) return true
    // CGNAT: 100.64.0.0/10
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true
    // 0.0.0.0/8
    if (a === 0) return true
    // RFC 2544: 198.18.0.0/15 benchmarking
    if (a === 198 && (b === 18 || b === 19)) return true
    // TEST-NET: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
    if (a === 192 && b === 0) return true
    if (a === 198 && b === 51) return true
    if (a === 203 && b === 0) return true
    // Multicast & Reserved (224.0.0.0/4 and 240.0.0.0/4)
    if (a >= 224) return true
    // Broadcast: 255.255.255.255
    if (ip === "255.255.255.255") return true
    return false
  }

  // IPv6 checks
  if (ipVersion === 6) {
    const words = parseIpv6Words(ip)
    if (!words) return true // Unparseable IPv6 treated as unsafe

    const [w0, w1, w2, w3, w4, w5, w6, w7] = words

    // Multicast: ff00::/8
    if ((w0 & 0xff00) === 0xff00) return true

    // Unspecified :: or Loopback ::1
    if (words.every((w, idx) => (idx === 7 ? w === 0 || w === 1 : w === 0))) return true

    // IPv4-mapped IPv6: ::ffff:a.b.c.d (or ::ffff:0:a.b.c.d)
    if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0xffff) {
      const embeddedIpv4 = `${w6 >> 8}.${w6 & 0xff}.${w7 >> 8}.${w7 & 0xff}`
      return isPrivateIp(embeddedIpv4)
    }

    // IPv4-compatible IPv6: ::a.b.c.d
    if (w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0 && (w6 !== 0 || w7 > 1)) {
      const embeddedIpv4 = `${w6 >> 8}.${w6 & 0xff}.${w7 >> 8}.${w7 & 0xff}`
      return isPrivateIp(embeddedIpv4)
    }

    // NAT64 prefix: 64:ff9b::/96
    if (w0 === 0x0064 && w1 === 0xff9b && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) {
      const embeddedIpv4 = `${w6 >> 8}.${w6 & 0xff}.${w7 >> 8}.${w7 & 0xff}`
      return isPrivateIp(embeddedIpv4)
    }

    // 6to4 prefix: 2002::/16
    if (w0 === 0x2002) {
      const embeddedIpv4 = `${w1 >> 8}.${w1 & 0xff}.${w2 >> 8}.${w2 & 0xff}`
      return isPrivateIp(embeddedIpv4)
    }

    // Link-local: fe80::/10 (fe80 - febf)
    if (w0 >= 0xfe80 && w0 <= 0xfebf) return true

    // Unique Local Address (ULA): fc00::/7 (fc00 - fdff)
    if (w0 >= 0xfc00 && w0 <= 0xfdff) return true

    // Discard prefix: 100::/64
    if (w0 === 0x0100 && w1 === 0 && w2 === 0 && w3 === 0) return true

    // Documentation: 2001:db8::/32
    if (w0 === 0x2001 && w1 === 0x0db8) return true

    return false
  }

  return true
}

export async function assertSafeEgressHost(hostname: string): Promise<string[]> {
  const cleanHost = hostname.replace(/^\[|\]$/g, "").trim().toLowerCase()
  if (!cleanHost) throw new Error("SSRF blocked: empty host")

  // Proactively block localhost and local/internal suffixes without waiting for DNS
  if (
    cleanHost === "localhost" ||
    cleanHost.endsWith(".localhost") ||
    cleanHost.endsWith(".local") ||
    cleanHost.endsWith(".internal") ||
    cleanHost.endsWith(".onion")
  ) {
    throw new Error(`SSRF blocked: Host ${hostname} is a local/internal domain`)
  }

  if (isIP(cleanHost)) {
    if (isPrivateIp(cleanHost)) {
      throw new Error(`SSRF blocked: IP ${hostname} is private or restricted`)
    }
    return [cleanHost]
  }

  const addresses = await dns.lookup(cleanHost, { all: true }).catch((err) => {
    throw new Error(`DNS resolution failed for ${hostname}: ${err.message}`)
  })

  if (!addresses || addresses.length === 0) {
    throw new Error(`DNS resolution returned no addresses for ${hostname}`)
  }

  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) {
      throw new Error(`SSRF blocked: ${hostname} resolved to restricted IP ${addr.address}`)
    }
  }

  return addresses.map((a) => a.address)
}
