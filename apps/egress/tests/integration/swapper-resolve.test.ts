import { afterAll, beforeAll, describe, expect, it } from "vitest"


// resolvePlaceholder talks to the orchestrator over fetch; stub it and verify
// the request shape + 30s cache behaviour.
const realFetch = globalThis.fetch
let calls = 0
let lastBody = ""

beforeAll(() => {
  process.env.ORCHESTRATOR_URL = "http://orchestrator:4000"
  process.env.ORCHESTRATOR_INTERNAL_SECRET = "s3cret"
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls++
    lastBody = String(init?.body ?? "")
    const headers = new Headers(init?.headers as HeadersInit)
    if (String(url).endsWith("/internal/egress/resolve") && headers.get("x-internal-secret") === "s3cret") {
      return Response.json({ grantId: "g1", secretPlaintext: "shh", hostAllowlist: ["api.github.com"], inject: { mode: "header" } })
    }
    return new Response("nope", { status: 401 })
  }) as typeof fetch
})

afterAll(() => { globalThis.fetch = realFetch })

let flushGrantCache: () => void
let resolvePlaceholder: (a: string, ph: string) => Promise<{ grantId: string }>

describe("resolvePlaceholder (orchestrator stubbed)", () => {
  beforeAll(async () => {
    ;({ flushGrantCache, resolvePlaceholder } = await import("../../src/swapper"))
  })
  it("fetches the grant and caches it for the same agent+placeholder", async () => {
    flushGrantCache()
    const a = await resolvePlaceholder("agent-1", "saaya_ph_abc")
    expect(a.grantId).toBe("g1")
    expect(JSON.parse(lastBody)).toEqual({ agentId: "agent-1", placeholder: "saaya_ph_abc" })
    const callsAfterFirst = calls
    const b = await resolvePlaceholder("agent-1", "saaya_ph_abc")
    expect(b).toBe(a) // cache hit: same object, no new fetch
    expect(calls).toBe(callsAfterFirst)
  })

  it("cache is keyed per agent: a different agent refetches", async () => {
    const before = calls
    await resolvePlaceholder("agent-2", "saaya_ph_abc")
    expect(calls).toBe(before + 1)
  })

  it("flushGrantCache forces a refetch", async () => {
    flushGrantCache()
    const before = calls
    await resolvePlaceholder("agent-1", "saaya_ph_abc")
    expect(calls).toBe(before + 1)
  })
})
