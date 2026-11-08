import { describe, expect, it } from "vitest"
import { createApp } from "../../src/index"

const SECRET = "0123456789abcdef"
const fakeLifecycle = {
  ensure: async (agentId: string) => ({ status: "running", ip: "10.0.0.2" }),
  execAgentd: async (_agentId: string, payload: Record<string, unknown>) => {
    if ((payload as any).op === "exec") return [{ t: "out", d: "hi" }, { t: "exit", code: 0 }]
    return [{ path: "/home/bot/a", content: "x", encoding: "utf8", size: 1, bytesReturned: 1, hash: "h", truncated: false, hasMore: false }]
  },
  stop: async (_id: string) => {},
  remove: async (_id: string, _del: boolean) => {},
}

function app() {
  process.env.ORCHESTRATOR_INTERNAL_SECRET = SECRET
  return createApp(fakeLifecycle as never)
}

describe("computerd Hono app (in-process, fake lifecycle)", () => {
  it("GET /health is public", async () => {
    const res = await app().request("/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, service: "computerd" })
  })

  it("all other routes require the internal secret", async () => {
    const a = app()
    for (const [method, path] of [["POST", "/v1/computers/a1/ensure"], ["POST", "/v1/computers/a1/stop"], ["DELETE", "/v1/computers/a1"]] as const) {
      const res = await a.request(path, { method })
      expect(res.status, path).toBe(401)
    }
  })

  it("ensure + exec round-trip with the secret", async () => {
    const a = app()
    const headers = { "x-internal-secret": SECRET, "content-type": "application/json" }
    const ensured = await a.request("/v1/computers/a1/ensure", { method: "POST", headers, body: JSON.stringify({ orgId: "o1", profile: "standard" }) })
    expect(ensured.status).toBe(200)
    expect(await ensured.json()).toMatchObject({ status: "running" })
    const exec = await a.request("/v1/computers/a1/exec", { method: "POST", headers, body: JSON.stringify({ cmd: "echo hi" }) })
    expect(exec.status).toBe(200)
    const text = await exec.text()
    expect(exec.headers.get("content-type")).toContain("application/x-ndjson")
    expect(text).toContain('"t":"out"')
    expect(text).toContain('"t":"exit"')
  })

  it("file routes require an object body", async () => {
    const a = app()
    const headers = { "x-internal-secret": SECRET, "content-type": "application/json" }
    const res = await a.request("/v1/computers/a1/files/read", { method: "POST", headers, body: "[]" })
    expect(res.status).toBe(400)
  })

  it("file routes return the single agentd frame", async () => {
    const a = app()
    const headers = { "x-internal-secret": SECRET, "content-type": "application/json" }
    const res = await a.request("/v1/computers/a1/files/read", { method: "POST", headers, body: JSON.stringify({ path: "/home/bot/a" }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ content: "x" })
  })
})
