import { agents, messages, messagingInbound, roomAgents, rooms, workspaceConnectors } from "@sayabot/db"
import { decryptSecret, unwrapConnectorSecret } from "@sayabot/llm"
import { and, eq } from "drizzle-orm"
import { getDb } from "../db"
import { getEnv } from "../env"
import { enqueueRoomMessage } from "../jobs"
import { DiscordConnector, TelegramConnector, WhatsAppConnector } from "./messaging"

export type InboundPlatform = "telegram" | "discord" | "whatsapp"

export interface InboundTarget {
  platform: InboundPlatform
  connectorId: string
  chatId: string
  externalId: string
}

export interface InboundEvent {
  externalId: string
  chatId: string
  sender: string
  text: string
}

export function readInbound(metadata: unknown): InboundTarget | null {
  if (!metadata || typeof metadata !== "object") return null
  const inbound = (metadata as { inbound?: unknown }).inbound
  if (!inbound || typeof inbound !== "object") return null
  const row = inbound as Record<string, unknown>
  if (row.platform !== "telegram" && row.platform !== "discord" && row.platform !== "whatsapp") return null
  if (typeof row.connectorId !== "string" || typeof row.chatId !== "string") return null
  return {
    platform: row.platform,
    connectorId: row.connectorId,
    chatId: row.chatId,
    externalId: typeof row.externalId === "string" ? row.externalId : "",
  }
}

/** Text that wakes the chosen agent. The leading @handle is what mention-mode rooms route on. */
export function inboundRoomText(handle: string, sender: string, text: string): string {
  const who = sender.replace(/[\r\n]/g, " ").trim().slice(0, 80) || "Someone"
  const body = text.trim().slice(0, 8_000)
  return `@${handle} ${who} says:\n${body}`
}

export function eventsFromPayload(platform: InboundPlatform, raw: string): InboundEvent[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (platform === "telegram") {
    const message = (parsed as { message?: Record<string, unknown> }).message
    if (!message || (message.from as { is_bot?: boolean } | undefined)?.is_bot) return []
    const text = typeof message.text === "string" ? message.text : ""
    if (!text.trim()) return []
    const chat = message.chat as { id?: number } | undefined
    const from = message.from as { username?: string; first_name?: string } | undefined
    if (chat?.id === undefined || message.message_id === undefined) return []
    return [{
      externalId: String(message.message_id),
      chatId: String(chat.id),
      sender: from?.username ? `@${from.username}` : (from?.first_name ?? "Someone"),
      text,
    }]
  }
  if (platform === "whatsapp") {
    const entries = (parsed as { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<Record<string, unknown>> } }> }> }).entry ?? []
    const out: InboundEvent[] = []
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          if (message.type !== "text") continue
          const body = (message.text as { body?: string } | undefined)?.body ?? ""
          if (!body.trim() || typeof message.from !== "string" || typeof message.id !== "string") continue
          out.push({ externalId: message.id, chatId: message.from, sender: `+${message.from}`, text: body })
        }
      }
    }
    return out
  }
  return []
}

interface InboundConfig {
  enabled?: boolean
  roomId?: string
  agentId?: string
  allowedChats?: string[]
}

/**
 * Stores one outside message and wakes the room. A repeated webhook for the same id does nothing.
 * `trusted` is the Discord gateway, which already holds the bot token. HTTP callers must pass the
 * secret from the webhook URL.
 */
export async function acceptInbound(args: {
  connectorId: string
  platform: InboundPlatform
  externalId: string
  chatId: string
  sender: string
  text: string
  key?: string | null
  trusted?: boolean
}): Promise<{ queued: boolean; reason?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(args.connectorId)) return { queued: false, reason: "bad connector" }
  const externalId = args.externalId.slice(0, 200)
  const chatId = args.chatId.slice(0, 80)
  if (!externalId || !chatId || !args.text.trim()) return { queued: false, reason: "empty" }

  const db = getDb()
  const [connector] = await db.select().from(workspaceConnectors).where(eq(workspaceConnectors.id, args.connectorId)).limit(1)
  if (!connector || connector.source !== args.platform || connector.status !== "active") {
    return { queued: false, reason: "connector not active" }
  }
  const config = (connector.config ?? {}) as { inbound?: InboundConfig }
  const inbound = config.inbound
  if (!inbound?.enabled || !inbound.roomId || !inbound.agentId) {
    return { queued: false, reason: "chat is not turned on" }
  }
  let inboundSecret: string | null = null
  try {
    inboundSecret = unwrapConnectorSecret(
      decryptSecret({ ciphertext: connector.ciphertext, iv: connector.iv, tag: connector.tag }, getEnv().MESH_KEK),
    ).inboundSecret
  } catch {
    return { queued: false, reason: "could not read the connector" }
  }
  if (!inboundSecret) return { queued: false, reason: "chat is not turned on" }
  if (!args.trusted && args.key !== inboundSecret) return { queued: false, reason: "bad key" }
  if (inbound.allowedChats?.length && !inbound.allowedChats.includes(chatId)) {
    return { queued: false, reason: "chat not allowed" }
  }

  const [agent] = await db
    .select({ id: agents.id, handle: agents.handle })
    .from(agents)
    .innerJoin(roomAgents, and(eq(roomAgents.agentId, agents.id), eq(roomAgents.roomId, inbound.roomId)))
    .where(and(eq(agents.id, inbound.agentId), eq(agents.orgId, connector.orgId)))
    .limit(1)
  if (!agent) return { queued: false, reason: "agent is not in that room" }

  const [room] = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.id, inbound.roomId), eq(rooms.orgId, connector.orgId))).limit(1)
  if (!room) return { queued: false, reason: "room not found" }

  const claimed = await db
    .insert(messagingInbound)
    .values({ connectorId: connector.id, externalId })
    .onConflictDoNothing()
    .returning({ externalId: messagingInbound.externalId })
  if (claimed.length === 0) return { queued: false, reason: "duplicate" }

  const content = inboundRoomText(agent.handle, args.sender, args.text)
  const [message] = await db
    .insert(messages)
    .values({
      roomId: room.id,
      senderType: "human",
      senderId: null,
      content,
      status: "complete",
      mentions: [agent.handle.toLowerCase()],
      metadata: {
        inbound: { platform: args.platform, connectorId: connector.id, chatId, externalId, sender: args.sender.slice(0, 80) },
      },
    })
    .returning({ id: messages.id })
  if (!message) return { queued: false, reason: "could not save" }
  await db.update(messagingInbound).set({ messageId: message.id }).where(and(eq(messagingInbound.connectorId, connector.id), eq(messagingInbound.externalId, externalId)))
  await enqueueRoomMessage(room.id, message.id)
  return { queued: true }
}

/** Sends the agent's room reply back to the chat it came from. Failures are logged by the caller. */
export async function deliverInboundReply(metadata: unknown, text: string): Promise<void> {
  const target = readInbound(metadata)
  const body = text.trim().slice(0, 4_000)
  if (!target || !body) return
  const db = getDb()
  const [connector] = await db.select().from(workspaceConnectors).where(eq(workspaceConnectors.id, target.connectorId)).limit(1)
  if (!connector || connector.status !== "active") return
  const token = unwrapConnectorSecret(
    decryptSecret({ ciphertext: connector.ciphertext, iv: connector.iv, tag: connector.tag }, getEnv().MESH_KEK),
  ).token
  if (target.platform === "telegram") {
    await new TelegramConnector({ botToken: token }).sendMessage(target.chatId, body)
  } else if (target.platform === "discord") {
    await new DiscordConnector({ botToken: token }).sendMessage(target.chatId, body)
  } else {
    const phoneNumberId = ((connector.config ?? {}) as { phoneNumberId?: string }).phoneNumberId ?? ""
    await new WhatsAppConnector({ accessToken: token, phoneNumberId }).sendText(target.chatId, body)
  }
}
