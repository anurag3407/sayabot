import { describe, expect, it, vi } from "vitest"
import { isHostAllowed } from "../../src/swapper"

describe("isHostAllowed", () => {
  it("exact match only", () => {
    expect(isHostAllowed("api.github.com", ["api.github.com"])).toBe(true)
    expect(isHostAllowed("evilapi.github.com", ["api.github.com"])).toBe(false)
    expect(isHostAllowed("api.github.com.evil.com", ["api.github.com"])).toBe(false)
  })

  it("wildcard matches subdomains, apex, but not lookalikes", () => {
    expect(isHostAllowed("a.b.github.com", ["*.github.com"])).toBe(true)
    expect(isHostAllowed("github.com", ["*.github.com"])).toBe(true) // apex matches *.root by design
    expect(isHostAllowed("notgithub.com", ["*.github.com"])).toBe(false)
    expect(isHostAllowed("github.com.evil.com", ["*.github.com"])).toBe(false)
  })

  it("empty allowlist denies everything; any-match wins", () => {
    expect(isHostAllowed("api.github.com", [])).toBe(false)
    expect(isHostAllowed("api.stripe.com", ["api.github.com", "*.stripe.com"])).toBe(true)
  })
})

describe("forgetIdentity", () => {
  it("drops a cached IP so a reused IP is re-resolved to its new owner", async () => {
    const { forgetIdentity, resolveAgentIdentity } = await import("../../src/swapper")
    let owner = "agent-a"
    vi.stubGlobal("fetch", async () => Response.json({ agentId: owner, orgId: "o1" }))
    try {
      await expect(resolveAgentIdentity("10.9.0.7")).resolves.toMatchObject({ agentId: "agent-a" })
      owner = "agent-b" // computer A slept, computer B woke up on the same IP
      await expect(resolveAgentIdentity("10.9.0.7")).resolves.toMatchObject({ agentId: "agent-a" }) // cached
      expect(forgetIdentity("10.9.0.7")).toBe(true)
      await expect(resolveAgentIdentity("10.9.0.7")).resolves.toMatchObject({ agentId: "agent-b" })
      expect(forgetIdentity("10.9.0.99")).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe("proxy credential identity (microVM computers)", () => {
  it("parses Basic credentials and ignores anything else", async () => {
    const { proxySecretFrom } = await import("../../src/swapper")
    const basic = (s: string) => `Basic ${Buffer.from(s).toString("base64")}`
    expect(proxySecretFrom(basic("saaya:abc123"))).toBe("abc123")
    expect(proxySecretFrom(basic("saaya:"))).toBeNull()
    expect(proxySecretFrom("Bearer abc")).toBeNull()
    expect(proxySecretFrom(undefined)).toBeNull()
  })

  it("resolves the agent from the orchestrator by proxySecret and caches it", async () => {
    const { resolveAgentIdentityBySecret } = await import("../../src/swapper")
    const bodies: unknown[] = []
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ agentId: "agent-vm", orgId: "o1" })
    })
    try {
      await expect(resolveAgentIdentityBySecret("s3cret")).resolves.toMatchObject({ agentId: "agent-vm" })
      await resolveAgentIdentityBySecret("s3cret")
      expect(bodies).toEqual([{ proxySecret: "s3cret" }])
      vi.stubGlobal("fetch", async () => new Response("no", { status: 401 }))
      await expect(resolveAgentIdentityBySecret("wrong")).resolves.toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
