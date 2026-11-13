import { describe, expect, it } from "vitest"
import { getPublicOrigin } from "../../src/lib/public-origin"

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
        "x-forwarded-host": "sayabot.sayalabs.in",
        "x-forwarded-proto": "https",
      },
    })
    expect(getPublicOrigin(req)).toBe("https://sayabot.sayalabs.in")
  })

  it("preserves development ports", () => {
    const req = new Request("http://localhost:3005/api/oauth", {
      headers: { host: "localhost:3005" },
    })
    expect(getPublicOrigin(req)).toBe("http://localhost:3005")
  })
})
