import type { PoolClient } from "pg"
import { type CollabAgent, getInbox } from "../collab"
import { getPool } from "../db"

const CHANNEL = "mesh_agent_inbox"
const MCP_MAX_WAITERS = 500

export interface ActivityNotification {
  agentId: string
  roomId: string
  kind: "mention" | "dm" | "task" | "decision_answered" | "vote"
}

interface ActivityEvent {
  kind: string
  roomId: string
  messageId?: string
  taskId?: string
  preview: string
}

interface ActivityResult {
  events: ActivityEvent[]
  nextHint: string
}

interface ActivityWaiter {
  agentId: string
  roomIds?: string[]
  resolve: (res: ActivityResult) => void
  cancel: () => void
}

const activeWaiters = new Map<string, ActivityWaiter>()
let listener: PoolClient | null = null

export async function startActivityListener(): Promise<void> {
  if (listener) return
  try {
    const client = await getPool().connect()
    listener = client

    client.on("notification", (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return
      try {
        const payload = JSON.parse(msg.payload) as ActivityNotification
        handleNotification(payload)
      } catch {
        // ignore malformed payloads
      }
    })

    client.on("error", (err) => {
      console.error("[activity-listener] client error", err)
      try {
        client.release()
      } catch {
        // ignore
      }
      listener = null
    })

    await client.query(`LISTEN ${CHANNEL}`)
  } catch (err) {
    console.error("[activity-listener] failed to start listener", err)
  }
}

function handleNotification(payload: ActivityNotification): void {
  const waiter = activeWaiters.get(payload.agentId)
  if (!waiter) return

  if (waiter.roomIds && waiter.roomIds.length > 0 && !waiter.roomIds.includes(payload.roomId)) {
    return
  }

  activeWaiters.delete(payload.agentId)
  waiter.resolve({
    events: [
      {
        kind: payload.kind,
        roomId: payload.roomId,
        preview: `New ${payload.kind} received in room.`,
      },
    ],
    nextHint: "Handle activity then call wait_for_activity again.",
  })
}

export async function waitForActivity(
  agent: CollabAgent,
  options?: { timeoutSeconds?: number; rooms?: string[] },
): Promise<ActivityResult> {
  // 1. Check inbox first
  const inbox = await getInbox(agent, { markAsRead: false })
  const immediateEvents: ActivityEvent[] = []

  for (const m of inbox.mentions) {
    immediateEvents.push({
      kind: "mention",
      roomId: m.room_id,
      messageId: m.id,
      preview: m.content.slice(0, 100),
    })
  }
  for (const t of inbox.tasks) {
    immediateEvents.push({
      kind: "task",
      roomId: t.room_id,
      taskId: t.id,
      preview: t.title,
    })
  }
  for (const a of inbox.answered_requests) {
    immediateEvents.push({
      kind: "decision_answered",
      roomId: a.room_id,
      preview: a.question,
    })
  }

  if (immediateEvents.length > 0) {
    return {
      events: immediateEvents,
      nextHint: "Events are waiting in your inbox. Process them and call wait_for_activity again.",
    }
  }

  // 2. Cancel any existing waiter for this agent
  const existing = activeWaiters.get(agent.agentId)
  if (existing) {
    activeWaiters.delete(agent.agentId)
    existing.cancel()
  }

  if (activeWaiters.size >= MCP_MAX_WAITERS) {
    return {
      events: [],
      nextHint: "Server waiter limit reached. Please poll periodically instead of long-polling.",
    }
  }

  await startActivityListener()

  const timeoutMs = Math.min(Math.max((options?.timeoutSeconds || 50) * 1000, 5000), 55000)

  return new Promise<ActivityResult>((resolve) => {
    let timer: NodeJS.Timeout | null = null
    let pollTimer: NodeJS.Timeout | null = null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (pollTimer) clearInterval(pollTimer)
      activeWaiters.delete(agent.agentId)
    }

    const waiter: ActivityWaiter = {
      agentId: agent.agentId,
      roomIds: options?.rooms,
      resolve: (res) => {
        cleanup()
        resolve(res)
      },
      cancel: () => {
        cleanup()
        resolve({
          events: [],
          nextHint: "Superseded by a newer wait_for_activity call.",
        })
      },
    }

    activeWaiters.set(agent.agentId, waiter)

    timer = setTimeout(() => {
      waiter.resolve({
        events: [],
        nextHint: "No activity during wait window. Call wait_for_activity again.",
      })
    }, timeoutMs)

    // Fallback poll every 5 seconds in case NOTIFY was missed
    pollTimer = setInterval(async () => {
      try {
        const check = await getInbox(agent, { markAsRead: false })
        if (
          check.mentions.length > 0 ||
          check.tasks.length > 0 ||
          check.answered_requests.length > 0
        ) {
          const polledEvents: ActivityEvent[] = []
          for (const m of check.mentions) {
            polledEvents.push({
              kind: "mention",
              roomId: m.room_id,
              messageId: m.id,
              preview: m.content.slice(0, 100),
            })
          }
          for (const t of check.tasks) {
            polledEvents.push({ kind: "task", roomId: t.room_id, taskId: t.id, preview: t.title })
          }
          for (const a of check.answered_requests) {
            polledEvents.push({ kind: "decision_answered", roomId: a.room_id, preview: a.question })
          }
          waiter.resolve({
            events: polledEvents,
            nextHint: "Activity detected. Handle events and call wait_for_activity again.",
          })
        }
      } catch {
        // ignore poll errors
      }
    }, 5000)
  })
}
