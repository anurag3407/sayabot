import { describe, expect, it } from "vitest"
import { parseCloudflareTunnelUrl, resolvePhoneServer } from "./phone-tunnel"

describe("parseCloudflareTunnelUrl", () => {
  it("reads the quick-tunnel hostname out of cloudflared's log", () => {
    const log = `
INF Requesting new quick Tunnel on trycloudflare.com...
INF |  https://random-name.trycloudflare.com                                                     |
`
    expect(parseCloudflareTunnelUrl(log)).toBe("https://random-name.trycloudflare.com")
  })
  it("returns null until the hostname appears", () => {
    expect(parseCloudflareTunnelUrl("still starting")).toBeNull()
  })
})

describe("resolvePhoneServer", () => {
  it("publishes a local server through the tunnel opener", async () => {
    const seen: string[] = []
    const result = await resolvePhoneServer({
      appUrl: "http://localhost:7431",
      requestOrigin: "http://localhost:7431",
      lanIp: "192.168.1.4",
      openTunnel: async (target) => {
        seen.push(target)
        return "https://desk.trycloudflare.com/"
      },
    })
    expect(seen).toEqual(["http://127.0.0.1:7431"])
    expect(result).toEqual({ url: "https://desk.trycloudflare.com", reach: "anywhere" })
  })

  it("keeps a public server and does not open a tunnel", async () => {
    let opened = false
    const result = await resolvePhoneServer({
      appUrl: "https://sayabot.example.com",
      requestOrigin: "http://127.0.0.1:7431",
      lanIp: "192.168.1.4",
      openTunnel: async () => {
        opened = true
        return "https://unused.trycloudflare.com"
      },
    })
    expect(opened).toBe(false)
    expect(result).toEqual({ url: "https://sayabot.example.com", reach: "anywhere" })
  })

  it("uses PHONE_PUBLIC_URL when that address is already public", async () => {
    let opened = false
    const result = await resolvePhoneServer({
      appUrl: "http://localhost:7431",
      requestOrigin: "http://localhost:7431",
      lanIp: null,
      presetPublicUrl: "https://home.example.com/",
      openTunnel: async () => {
        opened = true
        return "https://unused.trycloudflare.com"
      },
    })
    expect(opened).toBe(false)
    expect(result).toEqual({ url: "https://home.example.com", reach: "anywhere" })
  })
})
