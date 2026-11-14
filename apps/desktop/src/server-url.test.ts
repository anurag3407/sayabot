import { describe, expect, it } from "vitest"
import { normalizeServerUrl } from "./server-url"

describe("normalizeServerUrl (what people type on the start screen)", () => {
  it("adds https:// to a bare domain", () => {
    expect(normalizeServerUrl("sayabot.acme.com")).toBe("https://sayabot.acme.com")
    expect(normalizeServerUrl("  Sayabot.Acme.com/  ")).toBe("https://sayabot.acme.com")
  })

  it("uses http:// for local and private-network addresses", () => {
    expect(normalizeServerUrl("localhost:3000")).toBe("http://localhost:3000")
    expect(normalizeServerUrl("192.168.1.20:3000")).toBe("http://192.168.1.20:3000")
    expect(normalizeServerUrl("10.0.0.5")).toBe("http://10.0.0.5")
    expect(normalizeServerUrl("mybox.local")).toBe("http://mybox.local")
  })

  it("keeps an explicit scheme and path, without trailing slashes", () => {
    expect(normalizeServerUrl("http://sayabot.acme.com/")).toBe("http://sayabot.acme.com")
    expect(normalizeServerUrl("https://acme.com/sayabot/")).toBe("https://acme.com/sayabot")
  })

  it("rejects things that aren't web addresses", () => {
    expect(normalizeServerUrl("")).toBeNull()
    expect(normalizeServerUrl("ftp://acme.com")).toBeNull()
    expect(normalizeServerUrl("not a url at all")).toBeNull()
  })
})
