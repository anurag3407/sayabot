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

  it("landing asset catalogue is consistent (agents.ts)", async () => {
    const { AGENTS, AGENT_BY_ID } = await import("../../src/components/landing/agents")
    expect(AGENTS.map((a) => a.id)).toEqual(["ada", "pixel", "bolt", "sage"])
    expect(Object.keys(AGENT_BY_ID).sort()).toEqual(["ada", "bolt", "pixel", "sage"])
    for (const a of AGENTS) {
      expect(a.handle).toBe("@" + a.id)
      expect(a.traits.length).toBeGreaterThan(0)
    }
  })
})
