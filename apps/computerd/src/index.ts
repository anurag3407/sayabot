import { serve } from "@hono/node-server"
import { Hono, type Context } from "hono"
import { timingSafeEqual } from "node:crypto"
import { pathToFileURL } from "node:url"
import { bodyLimit } from "hono/body-limit"
import { selectBackend } from "./backends/select"
import { ProxyIdentity } from "./identity"
import { CapacityError, ComputerLifecycle, DockerUnavailableError, loadConfig } from "./lifecycle"
import type { AgentdFrame } from "./transport"

type Lifecycle = Pick<
  ComputerLifecycle,
  "ensure" | "execAgentd" | "streamAgentd" | "stop" | "remove" | "capacity"
>

export function createApp(lifecycle: Lifecycle) {
  const app = new Hono()
  app.use("*", bodyLimit({ maxSize: 16 * 1024 * 1024 }))

  const INTERNAL_SECRET = process.env.ORCHESTRATOR_INTERNAL_SECRET || ""

  function checkAuth(c: Context): boolean {
    if (!INTERNAL_SECRET) return true
    const secretHeader = c.req.header("x-internal-secret")
    const authHeader = c.req.header("authorization")
    const provided =
      secretHeader ?? (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined)
    if (!provided) return false
    const a = Buffer.from(provided)
    const b = Buffer.from(INTERNAL_SECRET)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next()
    if (!checkAuth(c)) return c.json({ error: "unauthorized" }, 401)
    await next()
  })

  app.onError((err, c) => {
    if (err instanceof CapacityError || err instanceof DockerUnavailableError) {
      return c.json({ error: err.message }, 503)
    }
    console.error("[computerd] request failed", err)
    return c.json({ error: err.message }, 500)
  })

  app.get("/health", (c) => c.json({ ok: true, service: "computerd", port: 4100 }))

  app.get("/v1/capacity", async (c) => c.json(await lifecycle.capacity()))

  app.post("/v1/computers/:agentId/ensure", async (c) => {
    const agentId = c.req.param("agentId")
    const body = await c.req.json().catch(() => ({}))
    const orgId = body.orgId || "default"
    const profile = body.profile === "browser" ? "browser" : "standard"
    return c.json(await lifecycle.ensure(agentId, orgId, profile))
  })

  app.post("/v1/computers/:agentId/exec", async (c) => {
    const agentId = c.req.param("agentId")
    const body = await c.req.json()
    const frames = lifecycle.streamAgentd(agentId, {
      op: "exec",
      cmd: body.cmd,
      cwd: body.cwd,
      timeoutMs: body.timeoutMs,
      env: body.env,
      stdin: body.stdin,
      background: body.background,
    })
    // Pull the first frame before answering so wake-up failures (capacity, Docker down)
    // still map to a proper HTTP status instead of a 200 with a broken stream.
    const first = await frames.next()
    const encoder = new TextEncoder()
    const line = (f: AgentdFrame) => encoder.encode(JSON.stringify(f) + "\n")
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (!first.done) controller.enqueue(line(first.value))
      },
      async pull(controller) {
        try {
          const next = await frames.next()
          if (next.done) controller.close()
          else controller.enqueue(line(next.value))
        } catch (e) {
          controller.enqueue(line({ error: e instanceof Error ? e.message : String(e) }))
          controller.close()
        }
      },
      async cancel() {
        await frames.return(undefined)
      },
    })
    return new Response(stream, { headers: { "content-type": "application/x-ndjson" } })
  })

  for (const [route, op] of [
    ["files/read", "read"],
    ["files/write", "write"],
    ["files/edit", "edit"],
    ["files/patch", "patch"],
    ["files/list", "list"],
    ["code", "code"],
    ["browser", "browser"],
  ] as const) {
    app.post(`/v1/computers/:agentId/${route}`, async (c) => {
      const body = await c.req.json()
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return c.json({ error: "Expected an object" }, 400)
      }
      const frames = await lifecycle.execAgentd(c.req.param("agentId"), { ...body, op })
      if (
        !Array.isArray(frames) ||
        frames.length !== 1 ||
        !frames[0] ||
        typeof frames[0] !== "object"
      ) {
        return c.json({ error: "Missing or invalid agentd response" }, 502)
      }
      if ("error" in frames[0]) return c.json(frames[0], 422)
      return c.json(frames[0])
    })
  }

  app.post("/v1/computers/:agentId/stop", async (c) => {
    await lifecycle.stop(c.req.param("agentId"))
    return c.json({ ok: true })
  })

  app.delete("/v1/computers/:agentId", async (c) => {
    const body = await c.req.json().catch(() => ({}))
    await lifecycle.remove(c.req.param("agentId"), body.deleteDisk === true)
    return c.json({ ok: true })
  })

  return app
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4100)
  if (process.env.NODE_ENV === "production" && !process.env.ORCHESTRATOR_INTERNAL_SECRET) {
    console.error("[computerd] ORCHESTRATOR_INTERNAL_SECRET is required in production")
    process.exit(1)
  }
  const config = loadConfig()
  const identity = new ProxyIdentity()
  const backend = await selectBackend(config, identity)
  const lifecycle = new ComputerLifecycle(backend, config, Date.now, identity)
  console.log(`[computerd] computer backend: ${backend.kind}`, backend.describe())
  console.log(`[computerd] starting on port ${port}...`)
  serve({ fetch: createApp(lifecycle).fetch, port })
  // Idle computers go to sleep (disk kept) and wake on their next call.
  setInterval(() => {
    lifecycle.sweepIdle().catch((e) => console.warn("[computerd] idle sweep failed", e))
  }, 30_000)
}
