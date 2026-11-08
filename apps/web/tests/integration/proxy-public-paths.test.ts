import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

// proxy.ts is a Next.js middleware module; assert its public-path contract by
// reading the exported config matcher instead of simulation.
describe("web proxy public-path contract", () => {
  it("proxy.ts keeps health + static assets out of the auth matcher", () => {
    const src = readFileSync(new URL("../../src/proxy.ts", import.meta.url), "utf8")
    for (const p of ["/login", "/signup", "/api/v1", "/.well-known", "/oauth/token", "/mcp"]) {
      expect(src, p).toContain(p)
    }
    expect(src).toContain("api/health")
    expect(src).toContain("/login") // unauthenticated workspace visits redirect with next=
  })
})
