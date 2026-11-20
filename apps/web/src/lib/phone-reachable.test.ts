import { describe, expect, it } from "vitest"
import {
  isLoopbackHost,
  lanIPv4,
  phoneServerUrl,
  reachOf,
  supabaseUrlForClient,
} from "./phone-reachable"

describe("reachOf", () => {
  it("classifies addresses by how far a phone can reach them", () => {
    expect(reachOf("http://localhost:7431")).toBe("this-computer")
    expect(reachOf("http://127.0.0.1:7431")).toBe("this-computer")
    expect(reachOf("http://[::1]:7431")).toBe("this-computer")
    expect(reachOf("http://192.168.1.4:7431")).toBe("same-wifi")
    expect(reachOf("http://macbook.local:7431")).toBe("same-wifi")
    expect(reachOf("https://abc.trycloudflare.com")).toBe("anywhere")
    expect(reachOf("https://sayabot.example.com")).toBe("anywhere")
  })
  it("treats 0.0.0.0 as this machine", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(true)
  })
})

describe("phoneServerUrl", () => {
  it("prefers the address the browser is using when a phone can reach it", () => {
    expect(
      phoneServerUrl("http://localhost:7431", "https://abc.trycloudflare.com", "192.168.1.4"),
    ).toEqual({
      url: "https://abc.trycloudflare.com",
      reach: "anywhere",
    })
  })
  it("uses the configured domain when the browser is on localhost", () => {
    expect(
      phoneServerUrl("https://sayabot.acme.com", "http://localhost:7431", "192.168.1.4"),
    ).toEqual({
      url: "https://sayabot.acme.com",
      reach: "anywhere",
    })
  })
  it("swaps localhost for the Mac's Wi-Fi address, keeping the port", () => {
    expect(phoneServerUrl("http://localhost:7431", "http://localhost:3005", "192.168.1.4")).toEqual(
      {
        url: "http://192.168.1.4:3005",
        reach: "same-wifi",
      },
    )
  })
  it("says so when no address would work", () => {
    expect(phoneServerUrl("http://localhost:7431", null, null)).toEqual({
      url: "http://localhost:7431",
      reach: "this-computer",
    })
  })
})

describe("lanIPv4", () => {
  it("picks a private, non-internal IPv4, preferring 192.168", () => {
    const ifaces = {
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      utun3: [{ address: "10.8.0.2", family: "IPv4", internal: false }],
      en0: [
        { address: "fe80::1", family: "IPv6", internal: false },
        { address: "192.168.1.4", family: "IPv4", internal: false },
      ],
    } as unknown as Parameters<typeof lanIPv4>[0]
    expect(lanIPv4(ifaces)).toBe("192.168.1.4")
  })
  it("returns null without a network", () => {
    expect(lanIPv4({} as Parameters<typeof lanIPv4>[0])).toBeNull()
  })
})

describe("supabaseUrlForClient", () => {
  it("moves a local Supabase onto the LAN address the phone used", () => {
    expect(supabaseUrlForClient("http://127.0.0.1:54321", "192.168.1.4")).toBe(
      "http://192.168.1.4:54321",
    )
  })
  it("leaves hosted Supabase and local browsers alone", () => {
    expect(supabaseUrlForClient("https://x.supabase.co", "192.168.1.4")).toBe(
      "https://x.supabase.co",
    )
    expect(supabaseUrlForClient("http://127.0.0.1:54321", "localhost")).toBe(
      "http://127.0.0.1:54321",
    )
    expect(supabaseUrlForClient("http://127.0.0.1:54321", null)).toBe("http://127.0.0.1:54321")
  })
})
