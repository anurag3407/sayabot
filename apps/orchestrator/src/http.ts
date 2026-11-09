import { redactSecrets } from "@sayabot/core"
import { agentRuns, agents, runSteps, runTranscripts, toolCalls } from "@sayabot/db"
import { generateText } from "ai"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { z } from "zod"
import { abortRun, activeRunIds } from "./active-runs"
import { canUserReadRoom } from "./authz"
import { resolveApprovalWaiter } from "./tools/approvals"
import { interruptRoom } from "./coordinator/interrupt"
import { botRoutes } from "./bot/routes"
import { mcpRoutes } from "./mcp/server"
import { internalRoutes } from "./internal/routes"
import { loadCanvas } from "./canvas/server"
import { restoreCanvasSnapshot } from "./canvas/tools"
import { getDb, notify } from "./db"
import { isInternalRequest } from "./internal-auth"
import { enqueueRoomMessage } from "./jobs"
import { loadMessage } from "./runner/context"
import { resolveAgentModel } from "./runner/llm"
import { applyTaskMutation } from "./collab/tasks-service"
import { executeWebSearch } from "./tools/builtins/web-search"
import { resolveToolCredential } from "./tools/secrets"
import { runRoutineNow } from "./scheduler/routines"

const roomMessageSchema = z.object({
  roomId: z.string().uuid(),
  messageId: z.string().uuid(),
})

const taskMutateSchema = z.object({
  taskId: z.string().uuid(),
  actor: z.object({
    type: z.enum(["human", "agent", "system"]),
    id: z.string().uuid(),
  }),
  status: z.enum(["open", "in_progress", "stuck", "done"]).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  assigneeAgentId: z.string().uuid().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  unblockNeeds: z
    .enum([
      "human_answer",
      "another_agent",
      "credential",
      "external_access",
      "time",
      "other",
    ])
    .nullable()
    .optional(),
  unblockDetail: z.string().nullable().optional(),
  blockedBy: z.array(z.string().uuid()).nullable().optional(),
  outcome: z
    .object({
      kind: z.enum([
        "artifact",
        "submission",
        "external_change",
        "decision",
        "none",
        "legacy",
      ]),
      ref: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  reason: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const restoreSchema = z.object({
  userId: z.string().uuid(),
  snapshot: z.string().max(1_000_000),
})

const agentTestSchema = z.object({
  orgId: z.string().uuid(),
})

const testWebSearchSchema = z.object({
  orgId: z.string().uuid().optional(),
  provider: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  query: z.string().default("test query"),
})

export function createApp() {
  const app = new Hono()

  app.use("/v1/*", bodyLimit({ maxSize: 2_000_000 }))
  app.use("/internal/*", bodyLimit({ maxSize: 200_000 }))

  app.get("/health", (c) =>
    c.json({ ok: true, service: "sayabot-orchestrator", activeRuns: activeRunIds().length }),
  )

  app.use("/internal/*", async (c, next) => {
    if (!isInternalRequest(c.req.header("authorization"), c.req.header("x-internal-secret"))) {
      return c.json({ error: "unauthorized" }, 401)
    }
    await next()
  })

  app.post("/internal/room-message", async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = roomMessageSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid body" }, 400)
    const message = await loadMessage(parsed.data.messageId)
    if (
      !message ||
      message.roomId !== parsed.data.roomId ||
      message.senderType !== "human"
    ) {
      return c.json({ error: "message not found or not a human message" }, 404)
    }
    await interruptRoom(parsed.data.roomId)
    await enqueueRoomMessage(parsed.data.roomId, parsed.data.messageId)
    return c.json({ queued: true }, 202)
  })

  app.post("/internal/runs/:runId/stop", async (c) => {
    const runId = c.req.param("runId")
    const stopped = abortRun(runId)
    await notify("mesh_stop_run", { runId }).catch(() => {})
    return c.json({ stopped, notified: true })
  })

  app.post("/internal/routines/:id/run", async (c) => {
    if (!isInternalRequest(c.req.header("authorization"), c.req.header("x-internal-secret"))) {
      return c.json({ error: "forbidden" }, 403)
    }
    const routineId = c.req.param("id")
    const result = await runRoutineNow(routineId)
    if (!result.success) {
      return c.json({ error: result.error }, 400)
    }
    return c.json({ ok: true, runId: result.runId })
  })

  app.post("/internal/tasks/mutate", async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = taskMutateSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: "invalid body", details: parsed.error.issues }, 400)
    }
    try {
      const result = await applyTaskMutation(parsed.data)
      return c.json({ ok: true, task: result.task, event: result.event })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ error: message }, 400)
    }
  })

  app.post("/internal/agents/:agentId/test", async (c) => {
    const agentId = c.req.param("agentId")
    const body = await c.req.json().catch(() => null)
    const parsed = agentTestSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid body" }, 400)
    const [agent] = await getDb()
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.orgId, parsed.data.orgId)))
      .limit(1)
    if (!agent) return c.json({ error: "agent not found" }, 404)
    if (agent.kind === "external") return c.json({ error: "external agents have no model" }, 400)
    const started = Date.now()
    try {
      const resolved = await resolveAgentModel(agent)
      const result = await generateText({
        model: resolved.model,
        system: agent.systemPrompt || undefined,
        prompt: "Reply with the single word: ok",
        maxOutputTokens: 200,
        abortSignal: AbortSignal.timeout(25_000),
      })
      return c.json({
        text: redactSecrets(result.text).text.slice(0, 300),
        model: resolved.modelName,
        latencyMs: Date.now() - started,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ error: redactSecrets(message).text.slice(0, 500) }, 502)
    }
  })

  app.post("/internal/tools/test-web-search", async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = testWebSearchSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid body", details: parsed.error.issues }, 400)
    const started = Date.now()
    try {
      let { provider, apiKey, baseUrl } = parsed.data
      if (parsed.data.orgId && (!provider || (!apiKey && provider !== "duckduckgo" && provider !== "searxng"))) {
        const stored = await resolveToolCredential({ orgId: parsed.data.orgId, tool: "web_search" })
        if (stored) {
          provider = provider || stored.provider
          apiKey = apiKey || stored.apiKey
          baseUrl = baseUrl || stored.baseUrl
        }
      }
      const out = await executeWebSearch({
        query: parsed.data.query,
        count: 3,
        provider,
        apiKey,
        baseUrl,
      })
      return c.json({
        ok: true,
        provider: out.provider,
        query: out.query,
        count: out.results.length,
        results: out.results,
        answer: out.answer,
        latencyMs: Date.now() - started,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ ok: false, error: redactSecrets(message).text.slice(0, 500) }, 400)
    }
  })

  app.post("/internal/canvases/:canvasId/restore", async (c) => {
    const canvasId = c.req.param("canvasId")
    const canvas = await loadCanvas(canvasId)
    if (!canvas) return c.json({ error: "canvas not found" }, 404)
    const body = await c.req.json().catch(() => null)
    const parsed = restoreSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: "invalid body" }, 400)
    if (!(await canUserReadRoom(parsed.data.userId, canvas.roomId))) {
      return c.json({ error: "forbidden" }, 403)
    }
    const result = await restoreCanvasSnapshot({
      canvasId,
      roomId: canvas.roomId,
      userId: parsed.data.userId,
      snapshot: parsed.data.snapshot,
    })
    return c.json(result)
  })

  app.post("/v1/tools/:toolCallId/approve", async (c) => {
    if (!isInternalRequest(c.req.header("authorization"), c.req.header("x-internal-secret"))) {
      return c.json({ error: "unauthorized" }, 401)
    }
    const toolCallId = c.req.param("toolCallId")
    const body = await c.req.json().catch(() => ({}))
    const approved = Boolean(body.approved)
    const status = approved ? "approved" : "rejected"

    const [toolCall] = await getDb()
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, toolCallId))
      .limit(1)

    if (!toolCall) return c.json({ error: "tool call not found" }, 404)

    await getDb()
      .update(toolCalls)
      .set({
        status,
        resolvedAt: new Date(),
      })
      .where(and(eq(toolCalls.id, toolCallId), eq(toolCalls.status, "pending_approval")))

    await notify("tool_call_resolved", { toolCallId, status })
    resolveApprovalWaiter(toolCallId, status)

    return c.json({ ok: true, status })
  })

  app.get("/internal/runs/:runId/trace", async (c) => {
    if (!isInternalRequest(c.req.header("authorization"), c.req.header("x-internal-secret"))) {
      return c.json({ error: "unauthorized" }, 401)
    }
    const runId = c.req.param("runId")
    const db = getDb()
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
      .limit(1)

    if (!run) return c.json({ error: "run not found" }, 404)

    const steps = await db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId))
      .orderBy(runSteps.idx)

    const [transcript] = await db
      .select({ plan: runTranscripts.plan })
      .from(runTranscripts)
      .where(eq(runTranscripts.runId, runId))
      .limit(1)

    return c.json({
      ok: true,
      trace: {
        run,
        steps,
        plan: transcript?.plan ?? null,
      },
    })
  })

  app.route("/", botRoutes)
  app.route("/", mcpRoutes)
  app.route("/", internalRoutes)

  app.onError((error, c) => {
    console.error("[http] unhandled error", error)
    return c.json({ error: "internal error" }, 500)
  })

  return app
}

export function getDbForHealth() {
  return getDb()
}
