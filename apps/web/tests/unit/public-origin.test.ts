import { afterEach, describe, expect, it, vi } from "vitest"
import { getPublicOrigin, needsServerAddress } from "../../src/lib/public-origin"

describe("getPublicOrigin", () => {
  it("replaces 0.0.0.0 with localhost when present in Host header", () => {
    const req = new Request("http://0.0.0.0:3000/api/oauth", {
      headers: { host: "0.0.0.0:3000" },
    })
    expect(getPublicOrigin(req)).toBe("http://localhost:3000")
  })

  it("replaces 0.0.0.0 with localhost when present in request.url without headers", () => {
    const req = new Request("http://0.0.0.0:3005/api/oauth")
    expect(getPublicOrigin(req)).toBe("http://localhost:3005")
  })

  it("prioritizes x-forwarded-host and x-forwarded-proto in production", () => {
    const req = new Request("http://0.0.0.0:3000/api/oauth", {
      headers: {
        host: "0.0.0.0:3000",
        "x-forwarded-host": "sayabot.example.com",
        "x-forwarded-proto": "https",
      },
    })
    expect(getPublicOrigin(req)).toBe("https://sayabot.example.com")
  })

  it("preserves development ports", () => {
    const req = new Request("http://localhost:3005/api/oauth", {
      headers: { host: "localhost:3005" },
    })
    expect(getPublicOrigin(req)).toBe("http://localhost:3005")
  })
})

describe("needsServerAddress", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("is true for self-hosted servers when no default host is configured", () => {
    expect(needsServerAddress("https://sayabot.acme.com")).toBe(true)
    expect(needsServerAddress("http://localhost:3000")).toBe(true)
  })

  it("is false when origin matches configured DEFAULT_APP_SERVER_HOST", () => {
    vi.stubEnv("DEFAULT_APP_SERVER_HOST", "sayabot.example.com")
    expect(needsServerAddress("https://sayabot.example.com")).toBe(false)
  })
})
