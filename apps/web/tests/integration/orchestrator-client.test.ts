import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const SECRET = "0123456789abcdef"
const calls: { url: string; init: RequestInit }[] = []
const realFetch = globalThis.fetch

vi.mock("../../src/lib/env", () => ({
  getOrchestratorUrl: () => "http://orchestrator:4000",
  getInternalSecret: () => SECRET,
}))

import { queueRoomMessage, stopRunInOrchestrator, testAgentInOrchestrator } from "../../src/lib/orchestrator"

beforeEach(() => {
  calls.length = 0
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const u = String(url)
    if (u.includes("/test")) return Response.json({ text: "ok", model: "m", latencyMs: 5 })
    return new Response(JSON.stringify({}), { status: 200 })
  }) as typeof fetch
})

afterAll(() => { globalThis.fetch = realFetch })

describe("web -> orchestrator internal client", () => {
  it("queueRoomMessage POSTs the internal secret to /internal/room-message", async () => {
    await expect(queueRoomMessage("r1", "m1")).resolves.toMatchObject({ ok: true, status: 200 })
    expect(calls[0]!.url).toBe("http://orchestrator:4000/internal/room-message")
    const headers = new Headers(calls[0]!.init.headers as HeadersInit)
    expect(headers.get("x-internal-secret")).toBe(SECRET)
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ roomId: "r1", messageId: "m1" })
  })

  it("stopRunInOrchestrator URL-encodes the run id", async () => {
    await stopRunInOrchestrator("run/with/slashes")
    expect(calls[0]!.url).toBe("http://orchestrator:4000/internal/runs/run%2Fwith%2Fslashes/stop")
  })

  it("testAgentInOrchestrator maps the success payload", async () => {
    await expect(testAgentInOrchestrator("a1", "o1")).resolves.toEqual({ ok: true, text: "ok", model: "m", latencyMs: 5 })
  })

  it("network failures become { ok: false } instead of throwing", async () => {
    globalThis.fetch = (async () => { throw new Error("ECONNREFUSED") }) as typeof fetch
    await expect(queueRoomMessage("r1", "m1")).resolves.toMatchObject({ ok: false, status: 0 })
    const tested = await testAgentInOrchestrator("a1", "o1")
    expect(tested.ok).toBe(false)
    if (!tested.ok) expect(tested.error).toContain("ECONNREFUSED")
  })
})
