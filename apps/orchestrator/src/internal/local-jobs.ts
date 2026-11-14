import { Hono } from "hono"
import { z } from "zod"
import {
  LocalJobError,
  recordMacToolEvents,
  requestMacApproval,
  type MacToolEvent,
} from "../runner/local-events"

/**
 * Sayabot for Mac → web (host token checked there) → here: tool activity and approval requests
 * for an agent running on that Mac. Behind the /internal/* secret check in http.ts.
 */
export const localJobRoutes = new Hono()

const args = z.record(z.string(), z.unknown()).default({})
const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started"), key: z.string(), toolName: z.string(), args }),
  z.object({
    type: z.literal("finished"),
    key: z.string(),
    ok: z.boolean(),
    result: z.string().max(20_000).optional(),
  }),
])
const eventsBody = z.object({ hostId: z.string().uuid(), events: z.array(eventSchema).max(50) })
const approvalBody = z.object({
  hostId: z.string().uuid(),
  key: z.string(),
  toolName: z.string(),
  args,
})

function failure(error: unknown) {
  if (error instanceof LocalJobError)
    return { body: { error: error.message }, status: error.status }
  console.error("[local-jobs]", error)
  return { body: { error: "internal error" }, status: 500 }
}

localJobRoutes.post("/internal/local-jobs/:jobId/events", async (c) => {
  const parsed = eventsBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: "invalid body" }, 400)
  try {
    const ids = await recordMacToolEvents(
      c.req.param("jobId"),
      parsed.data.hostId,
      parsed.data.events as MacToolEvent[],
    )
    return c.json({ ids })
  } catch (error) {
    const { body, status } = failure(error)
    return c.json(body, status as 400)
  }
})

localJobRoutes.post("/internal/local-jobs/:jobId/approval", async (c) => {
  const parsed = approvalBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: "invalid body" }, 400)
  try {
    const result = await requestMacApproval(c.req.param("jobId"), parsed.data.hostId, parsed.data)
    return c.json(result)
  } catch (error) {
    const { body, status } = failure(error)
    return c.json(body, status as 400)
  }
})
