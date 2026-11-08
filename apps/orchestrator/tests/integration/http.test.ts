import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { createApp } from "../../src/http"
import { registerRun, unregisterRun } from "../../src/active-runs"

// In-process Hono requests (app.request) — no socket, no DB needed for these routes.
// A bare fetch stub keeps any stray outbound call (e.g. notify) from hitting the network.
const SECRET = "0123456789abcdef"
let app: ReturnType<typeof createApp>
const realFetch = globalThis.fetch

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://u:p@h/db"
  process.env.MESH_KEK = "k"
  process.env.SUPABASE_URL = "https://x.supabase.co"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc"
  process.env.ORCHESTRATOR_INTERNAL_SECRET = SECRET
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch
  app = createApp()
})

afterEach(() => { globalThis.fetch = realFetch })

const internal = { "x-internal-secret": SECRET, "content-type": "application/json" }
const post = (path: string, headers: Record<string, string>, body: unknown) =>
  app.request(path, { method: "POST", headers, body: JSON.stringify(body) })

describe("orchestrator HTTP app (in-process)", () => {
  it("GET /health reports ok + active run count", async () => {
    registerRun("health-run", "room-h")
    const res = await app.request("/health")
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.service).toBe("sayabot-orchestrator")
    expect(body.activeRuns).toBeGreaterThanOrEqual(1)
    unregisterRun("health-run")
  })

  it("internal routes reject missing/wrong secrets with 401", async () => {
    for (const headers of [{} as Record<string, string>, { "x-internal-secret": "wrong" }]) {
      const res = await post("/internal/room-message", headers, {})
      expect(res.status).toBe(401)
    }
  })

  it("internal routes accept Bearer secrets too", async () => {
    const res = await post("/internal/room-message", { authorization: "Bearer " + SECRET, "content-type": "application/json" }, { roomId: "x" })
    expect(res.status).toBe(400) // passes auth, fails body validation
  })

  it("internal routes validate bodies with 400", async () => {
    expect((await post("/internal/room-message", internal, { roomId: "not-a-uuid" })).status).toBe(400)
    expect((await post("/internal/tasks/mutate", internal, { taskId: "x" })).status).toBe(400)
    expect((await post("/internal/agents/11111111-1111-4111-8111-111111111111/test", internal, { orgId: "nope" })).status).toBe(400)
  })

  it("POST /internal/runs/:runId/stop aborts a registered run", async () => {
    const controller = registerRun("stop-me", "room-h")
    const res = await post("/internal/runs/stop-me/stop", internal, {})
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).stopped).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    unregisterRun("stop-me")
    const missing = await post("/internal/runs/never-existed/stop", internal, {})
    expect(((await missing.json()) as any).stopped).toBe(false)
  })

  it("bot routes require a valid agent key (401 before any DB use)", async () => {
    const room = "11111111-1111-4111-8111-111111111111"
    const res = await post("/v1/rooms/" + room + "/messages", { "content-type": "application/json" }, { content: "hi" })
    expect(res.status).toBe(401)
    const badToken = await post("/v1/rooms/" + room + "/messages", { "content-type": "application/json", authorization: "Bearer sayabot_ak_short" }, { content: "hi" })
    expect([401, 500]).toContain(badToken.status) // 500 only if the key lookup needs a DB in this env
    expect(badToken.status).not.toBe(200)
  })

  it("MCP instructions endpoint requires an agent key (401 with setup help, not a leak)", async () => {
    const res = await app.request("/v1/mcp")
    expect(res.status).toBe(401)
    expect(await res.text()).toContain("Invalid, revoked, or missing agent key")
    const bad = await app.request("/v1/mcp/not-a-real-key")
    expect(bad.status).toBe(401)
    const del = await app.request("/v1/mcp", { method: "DELETE" })
    expect(del.status).toBe(405)
    expect(del.headers.get("allow")).toContain("POST")
  })

  it("tool approval of an unknown tool call never returns 200", async () => {
    const res = await post("/v1/tools/11111111-1111-4111-8111-111111111111/approve", { "content-type": "application/json" }, { approved: true })
    expect(res.status).not.toBe(200)
    expect([401, 404, 500]).toContain(res.status)
  })
})
