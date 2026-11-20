import { messages } from "@sayabot/db"
import { and, asc, eq, gte, isNull } from "drizzle-orm"
import type { PoolClient } from "pg"
import { getDb, getPool, notify } from "./db"

const CHANNEL = "mesh_bot_reply"

export interface BotReplyPayload {
  roomId: string
  agentId: string
  threadRootId: string | null
  messageId: string
}

interface Waiter {
  roomId: string
  agentId: string
  threadRootId: string | null
  startedAt: Date
  resolve: (result: { messageId: string } | null) => void
}

const waiters = new Set<Waiter>()
let listener: PoolClient | null = null

function matches(waiter: Waiter, payload: BotReplyPayload): boolean {
  return (
    waiter.roomId === payload.roomId &&
    waiter.agentId === payload.agentId &&
    waiter.threadRootId === payload.threadRootId
  )
}

function resolveMatching(payload: BotReplyPayload): void {
  for (const waiter of [...waiters]) {
    if (!matches(waiter, payload)) continue
    waiters.delete(waiter)
    waiter.resolve({ messageId: payload.messageId })
  }
}

export async function startBotReplyListener(): Promise<void> {
  if (listener) return
  const client = await getPool().connect()
  listener = client
  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return
    try {
      resolveMatching(JSON.parse(msg.payload) as BotReplyPayload)
    } catch {
      // ignore malformed notifications
    }
  })
  client.on("error", (error) => {
    console.error("[bot-reply] listener connection error", error)
    client.release()
    listener = null
  })
  await client.query(`LISTEN ${CHANNEL}`)
}

export async function notifyBotReply(payload: BotReplyPayload): Promise<void> {
  resolveMatching(payload)
  await notify(CHANNEL, payload)
}

/**
 * Resolves on the next reply from this agent in this thread. Polling covers a
 * cross-instance notification arriving after the local waiter was registered.
 */
export function waitForBotReply(
  args: { roomId: string; agentId: string; threadRootId: string | null },
  timeoutMs = 60_000,
): Promise<{ messageId: string } | null> {
  const startedAt = new Date()
  return new Promise((resolve) => {
    let settled = false
    const handles: {
      timer?: ReturnType<typeof setTimeout>
      poll?: ReturnType<typeof setInterval>
    } = {}
    const waiter: Waiter = {
      ...args,
      startedAt,
      resolve: (result) => {
        if (settled) return
        settled = true
        if (handles.timer) clearTimeout(handles.timer)
        if (handles.poll) clearInterval(handles.poll)
        waiters.delete(waiter)
        resolve(result)
      },
    }
    waiters.add(waiter)
    handles.timer = setTimeout(() => waiter.resolve(null), timeoutMs)
    handles.poll = setInterval(() => {
      void getDb()
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.roomId, args.roomId),
            eq(messages.senderType, "agent"),
            eq(messages.senderId, args.agentId),
            args.threadRootId
              ? eq(messages.threadRootId, args.threadRootId)
              : isNull(messages.threadRootId),
            gte(messages.createdAt, startedAt),
          ),
        )
        .orderBy(asc(messages.createdAt))
        .limit(1)
        .then((rows) => {
          const row = rows[0]
          if (row) waiter.resolve({ messageId: row.id })
        })
        .catch(() => {})
    }, 2_000)
    handles.poll.unref?.()
  })
}
