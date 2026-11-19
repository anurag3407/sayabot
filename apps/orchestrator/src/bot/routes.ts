import { botMessageBodySchema, redactSecrets } from "@sayabot/core"
import { messages } from "@sayabot/db"
import { eq } from "drizzle-orm"
import type { Context } from "hono"
import { Hono } from "hono"
import { isAgentInRoom } from "../authz"
import { notifyBotReply } from "../bot-reply"
import { getDb } from "../db"
import { broadcast } from "../realtime"
import { loadMessage } from "../runner/context"
import { CollabError, postAgentMessage } from "../collab"
import { authenticateAgentKey, type BotIdentity } from "./auth"
import { BotStreamParser } from "./stream-parser"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function authenticate(c: Context) {
  const identity = await authenticateAgentKey(c.req.header("authorization"))
  if (!identity) return { error: c.json({ error: "invalid or revoked agent API key" }, 401) }
  return identity
}

async function authorizeRoom(c: Context, identity: BotIdentity) {
  const roomId = c.req.param("roomId") ?? ""
  if (!UUID_RE.test(roomId)) return { error: c.json({ error: "room not found" }, 404) }
  if (!(await isAgentInRoom(identity.agentId, roomId))) {
    return { error: c.json({ error: "agent is not a member of this room" }, 403) }
  }
  return { roomId }
}

async function resolveThread(
  roomId: string,
  threadId: string | null,
  replyTo: string | null,
): Promise<{ ok: true; threadRootId: string | null } | { ok: false; error: string }> {
  let root = threadId || null
  if (root) {
    if (!UUID_RE.test(root)) return { ok: false, error: "invalid thread_id" }
    const message = await loadMessage(root)
    if (!message || message.roomId !== roomId) return { ok: false, error: "thread not found in room" }
    if (message.threadRootId) root = message.threadRootId
  }
  if (replyTo) {
    if (!UUID_RE.test(replyTo)) return { ok: false, error: "invalid reply_to" }
    const target = await loadMessage(replyTo)
    if (!target || target.roomId !== roomId) return { ok: false, error: "reply_to not found in room" }
    root = target.threadRootId ?? target.id
  }
  return { ok: true, threadRootId: root }
}

function parseBody(body: unknown) {
  const parsed = botMessageBodySchema.safeParse(body)
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    }
  }
  if (parsed.data.thread_id && !UUID_RE.test(parsed.data.thread_id)) {
    return { ok: false as const, error: "invalid thread_id" }
  }
  if (parsed.data.reply_to && !UUID_RE.test(parsed.data.reply_to)) {
    return { ok: false as const, error: "invalid reply_to" }
  }
  return { ok: true as const, value: parsed.data }
}

export const botRoutes = new Hono()

botRoutes.post("/v1/rooms/:roomId/messages", async (c) => {
  const identity = await authenticate(c)
  if ("error" in identity) return identity.error
  const room = await authorizeRoom(c, identity)
  if ("error" in room) return room.error

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: "invalid JSON body" }, 400)
  }
  const parsed = parseBody(body)
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)

  const thread = await resolveThread(
    room.roomId,
    parsed.value.thread_id ?? null,
    parsed.value.reply_to ?? null,
  )
  if (!thread.ok) return c.json({ error: thread.error }, 400)

  try {
    const posted = await postAgentMessage(
      { agentId: identity.agentId, orgId: identity.orgId, handle: identity.agent.handle },
      { roomId: room.roomId, content: parsed.value.content, threadRootId: thread.threadRootId },
    )
    return c.json(posted, 201)
  } catch (error) {
    if (error instanceof CollabError) return c.json({ error: error.message }, 400)
    throw error
  }
})

botRoutes.post("/v1/rooms/:roomId/messages/stream", async (c) => {
  const identity = await authenticate(c)
  if ("error" in identity) return identity.error
  const room = await authorizeRoom(c, identity)
  if ("error" in room) return room.error

  const thread = await resolveThread(
    room.roomId,
    c.req.query("thread_id") ?? c.req.header("x-sayabot-thread-id") ?? c.req.header("x-mesh-thread-id") ?? null,
    c.req.query("reply_to") ?? c.req.header("x-sayabot-reply-to") ?? c.req.header("x-mesh-reply-to") ?? null,
  )
  if (!thread.ok) return c.json({ error: thread.error }, 400)

  const contentType = c.req.header("content-type") ?? ""
  if (!/ndjson|event-stream/i.test(contentType)) {
    return c.json({ error: "use application/x-ndjson or text/event-stream" }, 415)
  }
  const body = c.req.raw.body
  if (!body) return c.json({ error: "missing streaming body" }, 400)

  const [row] = await getDb()
    .insert(messages)
    .values({
      roomId: room.roomId,
      threadRootId: thread.threadRootId,
      senderType: "agent",
      senderId: identity.agentId,
      content: "",
      status: "streaming",
      mentions: [],
      metadata: { external: true, agentHandle: identity.agent.handle },
    })
    .returning({ id: messages.id })
  if (!row) return c.json({ error: "failed to store message" }, 500)

  const parser = new BotStreamParser(contentType)
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let rawContent = ""
  let buffer = ""
  let seq = 0
  let lastPersist = 0
  let chain = Promise.resolve()

  const flush = () => {
    if (!buffer) return
    const { text } = redactSecrets(buffer)
    buffer = ""
    if (text) {
      const current = seq++
      chain = chain
        .then(() =>
          broadcast(room.roomId, {
            type: "message.delta",
            messageId: row.id,
            seq: current,
            delta: text,
          }),
        )
        .catch(() => {})
    }
  }

  const MAX_STREAM_CHARS = 100_000
  let failure: string | null = null
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const parsed = parser.push(decoder.decode(value, { stream: true }))
      for (const delta of parsed.deltas) {
        rawContent += delta
        buffer += delta
      }
      if (rawContent.length > MAX_STREAM_CHARS) {
        failure = `message exceeded maximum stream length (${MAX_STREAM_CHARS} characters)`
        await reader.cancel().catch(() => {})
        break
      }
      if (parsed.deltas.length) flush()
      const now = Date.now()
      if (now - lastPersist >= 1_000) {
        lastPersist = now
        await getDb()
          .update(messages)
          .set({ content: redactSecrets(rawContent).text })
          .where(eq(messages.id, row.id))
      }
      if (parsed.done) {
        await reader.cancel().catch(() => {})
        break
      }
    }
    const tail = parser.finish()
    for (const delta of tail.deltas) {
      if (rawContent.length + delta.length <= MAX_STREAM_CHARS) {
        rawContent += delta
        buffer += delta
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }

  flush()
  const status = failure ? "error" : rawContent ? "complete" : "error"
  const safeFailure = failure ? redactSecrets(failure).text : null
  const finalError = safeFailure ?? (rawContent ? undefined : "bot stream produced no content")
  await getDb()
    .update(messages)
    .set({
      content: redactSecrets(rawContent).text,
      status,
      metadata: { external: true, ...(finalError ? { error: finalError } : {}) },
    })
    .where(eq(messages.id, row.id))
  chain = chain
    .then(() =>
      broadcast(room.roomId, { type: "message.done", messageId: row.id, status }),
    )
    .catch(() => {})
  await chain
  await notifyBotReply({
    roomId: room.roomId,
    agentId: identity.agentId,
    threadRootId: thread.threadRootId,
    messageId: row.id,
  }).catch(() => {})

  if (finalError) return c.json({ error: finalError, message_id: row.id }, 400)
  return c.json({ message_id: row.id, characters: rawContent.length })
})
