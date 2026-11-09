import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { timingSafeEqual } from "node:crypto"
import { pathToFileURL } from "node:url"
import { bodyLimit } from "hono/body-limit"
import { ComputerLifecycle } from "./lifecycle"

export function createApp(lifecycle: Pick<ComputerLifecycle, "ensure" | "execAgentd" | "stop" | "remove"> = new ComputerLifecycle()) {
const app = new Hono()
app.use("*", bodyLimit({ maxSize: 16 * 1024 * 1024 }))

const INTERNAL_SECRET = process.env.ORCHESTRATOR_INTERNAL_SECRET || ""

function checkAuth(c: any): boolean {
  if (!INTERNAL_SECRET) return true
  const secretHeader = c.req.header("x-internal-secret")
  const authHeader = c.req.header("authorization")
  const provided = secretHeader ?? (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined)
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(INTERNAL_SECRET)
  return a.length === b.length && timingSafeEqual(a, b)
}

app.use("*", async (c, next) => {
  if (c.req.path === "/health") return next()
  if (!checkAuth(c)) {
    return c.json({ error: "unauthorized" }, 401)
  }
  await next()
})

app.get("/health", (c) => {
  return c.json({ ok: true, service: "computerd", port: 4100 })
})

app.post("/v1/computers/:agentId/ensure", async (c) => {
  const agentId = c.req.param("agentId")
  const body = await c.req.json().catch(() => ({}))
  const orgId = body.orgId || "default"
  const profile = body.profile === "browser" ? "browser" : "standard"

  const result = await lifecycle.ensure(agentId, orgId, profile)
  return c.json(result)
})

app.post("/v1/computers/:agentId/exec", async (c) => {
  const agentId = c.req.param("agentId")
  const body = await c.req.json()

  const frames = await lifecycle.execAgentd(agentId, {
    op: "exec",
    cmd: body.cmd,
    cwd: body.cwd,
    timeoutMs: body.timeoutMs,
    env: body.env,
    stdin: body.stdin,
    background: body.background,
  })

  // Return NDJSON
  const ndjson = frames.map((f: any) => JSON.stringify(f)).join("\n") + "\n"
  return new Response(ndjson, {
    headers: { "content-type": "application/x-ndjson" },
  })
})

for (const [route, op] of [["files/read", "read"], ["files/write", "write"], ["files/edit", "edit"], ["files/patch", "patch"], ["files/list", "list"], ["code", "code"], ["browser", "browser"]] as const) {
  app.post(`/v1/computers/:agentId/${route}`, async (c) => {
    const body = await c.req.json()
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "Expected an object" }, 400)
    const frames = await lifecycle.execAgentd(c.req.param("agentId"), { ...body, op })
    if (!Array.isArray(frames) || frames.length !== 1 || !frames[0] || typeof frames[0] !== "object") return c.json({ error: "Missing or invalid agentd response" }, 502)
    if ("error" in frames[0]) return c.json(frames[0], 422)
    return c.json(frames[0])
  })
}

app.post("/v1/computers/:agentId/stop", async (c) => {
  const agentId = c.req.param("agentId")
  await lifecycle.stop(agentId)
  return c.json({ ok: true })
})

app.delete("/v1/computers/:agentId", async (c) => {
  const agentId = c.req.param("agentId")
  const body = await c.req.json().catch(() => ({}))
  await lifecycle.remove(agentId, body.deleteDisk === true)
  return c.json({ ok: true })
})

return app
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4100)
  console.log(`[computerd] starting on port ${port}...`)
  serve({ fetch: createApp().fetch, port })
}
