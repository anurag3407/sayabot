import {
  agentGateways,
  agents,
  externalChats,
  gatewayInbound,
  messages,
  roomAgents,
  roomMembers,
  rooms,
} from "@sayabot/db"
import {
  gatewayChatRoomName,
  isGatewaySource,
  isSilentGatewayReply,
  type GatewaySource,
} from "@sayabot/core"
import { decryptSecret, unwrapConnectorSecret } from "@sayabot/llm"
import { and, eq } from "drizzle-orm"
import { DiscordConnector, TelegramConnector } from "../connectors/messaging"
import { getDb } from "../db"
import { getEnv } from "../env"
import { enqueueRoomMessage } from "../jobs"

/**
 * Per-agent gateways: one external bot account bound to one agent. Inbound messages are mirrored
 * into a real room (`external_chats` holds the mapping), so the chat list, realtime, memory,
 * approvals and canvas all keep working without a second message store.
 *
 * Every query is scoped through the gateway row's `orgId`/`agentId`; an id from another workspace
 * resolves to "gateway not found".
 */

export interface GatewayTarget {
  gatewayId: string
  platform: GatewaySource
  chatId: string
  externalId: string
  chatType: "dm" | "group" | null
}

export interface GatewayInboundEvent {
  externalId: string
  chatId: string
  sender: string
  text: string
  senderId?: string
  chatType?: "dm" | "group"
  chatTitle?: string
}

export function readGatewayInbound(metadata: unknown): GatewayTarget | null {
  if (!metadata || typeof metadata !== "object") return null
  const gateway = (metadata as { gateway?: unknown }).gateway
  if (!gateway || typeof gateway !== "object") return null
  const row = gateway as Record<string, unknown>
  if (!isGatewaySource(row.platform)) return null
  if (typeof row.gatewayId !== "string" || typeof row.chatId !== "string") return null
  return {
    gatewayId: row.gatewayId,
    platform: row.platform,
    chatId: row.chatId,
    externalId: typeof row.externalId === "string" ? row.externalId : "",
    chatType: row.chatType === "group" ? "group" : row.chatType === "dm" ? "dm" : null,
  }
}

interface GatewayConfig {
  allowedChats?: string[]
  allowedUserIds?: string[]
  silence?: boolean
}

type GatewayRow = typeof agentGateways.$inferSelect

function openGatewayToken(row: GatewayRow): { token: string; inboundSecret: string | null } {
  const plaintext = decryptSecret(
    { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag },
    getEnv().MESH_KEK,
  )
  return unwrapConnectorSecret(plaintext)
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function loadGateway(gatewayId: string): Promise<GatewayRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(gatewayId)) return null
  const [row] = await getDb()
    .select()
    .from(agentGateways)
    .where(eq(agentGateways.id, gatewayId))
    .limit(1)
  return row ?? null
}

/**
 * Stores one outside message and wakes the mirrored room. A repeated webhook for the same id does
 * nothing. `trusted` is the Discord socket, which already holds the bot token.
 */
export async function acceptGatewayInbound(
  args: {
    gatewayId: string
    platform: GatewaySource
    secret?: string | null
    trusted?: boolean
  } & GatewayInboundEvent,
): Promise<{ queued: boolean; reason?: string }> {
  const externalId = args.externalId.slice(0, 200)
  const chatId = args.chatId.slice(0, 120)
  if (!externalId || !chatId || !args.text.trim()) return { queued: false, reason: "empty" }

  const gateway = await loadGateway(args.gatewayId)
  if (!gateway || gateway.source !== args.platform) {
    return { queued: false, reason: "gateway not found" }
  }
  if (gateway.status !== "active") return { queued: false, reason: "gateway is not active" }

  let secret: string | null = null
  try {
    secret = openGatewayToken(gateway).inboundSecret
  } catch {
    return { queued: false, reason: "could not read the gateway" }
  }
  if (!args.trusted) {
    if (!secret || !args.secret || !safeEqual(secret, args.secret)) {
      return { queued: false, reason: "bad key" }
    }
  }

  const config = (gateway.config ?? {}) as GatewayConfig
  if (config.allowedChats?.length && !config.allowedChats.includes(chatId)) {
    return { queued: false, reason: "chat not allowed" }
  }
  if (
    config.allowedUserIds?.length &&
    args.senderId &&
    !config.allowedUserIds.includes(args.senderId)
  ) {
    return { queued: false, reason: "sender not allowed" }
  }

  const db = getDb()
  const [agent] = await db
    .select({ id: agents.id, handle: agents.handle })
    .from(agents)
    .where(and(eq(agents.id, gateway.agentId), eq(agents.orgId, gateway.orgId)))
    .limit(1)
  if (!agent) return { queued: false, reason: "agent not found" }

  const duplicate = await db
    .insert(gatewayInbound)
    .values({ gatewayId: gateway.id, externalId })
    .onConflictDoNothing()
    .returning({ externalId: gatewayInbound.externalId })
  if (duplicate.length === 0) return { queued: false, reason: "duplicate" }

  const chat = await ensureMirrorRoom(gateway, agent, {
    chatId,
    chatType: args.chatType ?? "dm",
    title: args.chatTitle,
    senderId: args.senderId,
  })
  if (!chat) return { queued: false, reason: "could not open the chat" }

  const content = `@${agent.handle} ${args.sender || "Someone"} says:\n${args.text.trim().slice(0, 8_000)}`
  const [message] = await db
    .insert(messages)
    .values({
      roomId: chat.roomId,
      senderType: "human",
      senderId: null,
      content,
      status: "complete",
      mentions: [agent.handle.toLowerCase()],
      metadata: {
        gateway: {
          gatewayId: gateway.id,
          platform: args.platform,
          chatId,
          externalId,
          chatType: chat.chatType,
          sender: args.sender.slice(0, 80),
        },
      },
    })
    .returning({ id: messages.id })
  if (!message) return { queued: false, reason: "could not save" }

  await db
    .update(gatewayInbound)
    .set({ messageId: message.id })
    .where(
      and(eq(gatewayInbound.gatewayId, gateway.id), eq(gatewayInbound.externalId, externalId)),
    )
  await db
    .update(externalChats)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(externalChats.id, chat.id))
  await db
    .update(agentGateways)
    .set({ lastSeenAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(agentGateways.id, gateway.id))

  await enqueueRoomMessage(chat.roomId, message.id)
  return { queued: true }
}

/**
 * Find-or-create the room behind an external chat. The room is a real room: the gateway's agent is
 * a member, and the person who connected the gateway is a member so the chat appears for them.
 */
async function ensureMirrorRoom(
  gateway: GatewayRow,
  agent: { id: string; handle: string },
  chat: { chatId: string; chatType: "dm" | "group"; title?: string; senderId?: string },
): Promise<{ id: string; roomId: string; chatType: "dm" | "group" } | null> {
  const db = getDb()
  const [existing] = await db
    .select({ id: externalChats.id, roomId: externalChats.roomId, chatType: externalChats.chatType })
    .from(externalChats)
    .where(
      and(eq(externalChats.gatewayId, gateway.id), eq(externalChats.externalChatId, chat.chatId)),
    )
    .limit(1)
  if (existing) {
    await db
      .insert(roomAgents)
      .values({ roomId: existing.roomId, agentId: agent.id, position: 0 })
      .onConflictDoNothing()
    return { id: existing.id, roomId: existing.roomId, chatType: existing.chatType as "dm" | "group" }
  }

  const title = chat.title?.slice(0, 80) ?? (chat.chatType === "dm" ? "Direct message" : "Group")
  const [room] = await db
    .insert(rooms)
    .values({
      orgId: gateway.orgId,
      name: gatewayChatRoomName(gateway.source as GatewaySource, agent.handle, title),
      // Mirror rooms are plain private rooms, never `dm`: `dm` carries a unique (user, agent)
      // marker pair, and one bot talks to many outside people at once.
      kind: "private",
      turnMode: "mentions",
      timezone: "UTC",
      createdBy: gateway.createdBy,
    })
    .returning({ id: rooms.id })
  if (!room) return null

  await db
    .insert(roomAgents)
    .values({ roomId: room.id, agentId: agent.id, position: 0 })
    .onConflictDoNothing()
  if (gateway.createdBy) {
    await db
      .insert(roomMembers)
      .values({ roomId: room.id, userId: gateway.createdBy, role: "admin" })
      .onConflictDoNothing()
  }

  const [created] = await db
    .insert(externalChats)
    .values({
      orgId: gateway.orgId,
      gatewayId: gateway.id,
      externalChatId: chat.chatId,
      chatType: chat.chatType,
      roomId: room.id,
      title,
    })
    .onConflictDoNothing()
    .returning({ id: externalChats.id, roomId: externalChats.roomId })
  if (!created) {
    // A concurrent webhook won the race: reuse its row and drop the room we just made.
    const [winner] = await db
      .select({ id: externalChats.id, roomId: externalChats.roomId })
      .from(externalChats)
      .where(
        and(eq(externalChats.gatewayId, gateway.id), eq(externalChats.externalChatId, chat.chatId)),
      )
      .limit(1)
    if (winner) {
      await db.delete(rooms).where(eq(rooms.id, room.id))
      return { id: winner.id, roomId: winner.roomId, chatType: chat.chatType }
    }
    return null
  }
  return { id: created.id, roomId: created.roomId, chatType: chat.chatType }
}

/**
 * Sends the agent's reply back through its own gateway. Returns `false` when the message did not
 * come from a gateway (so the connector path can run), `true` when it was handled — including a
 * deliberate silence token, which is not an error.
 */
export async function deliverGatewayReply(metadata: unknown, text: string): Promise<boolean> {
  const target = readGatewayInbound(metadata)
  if (!target) return false
  const body = text.trim()
  if (!body || isSilentGatewayReply(body)) return true

  const gateway = await loadGateway(target.gatewayId)
  if (!gateway || gateway.status !== "active" || gateway.source !== target.platform) return true

  const config = (gateway.config ?? {}) as GatewayConfig
  // `silence` keeps a bot quiet in group chats it was added to; DMs always answer.
  if (config.silence && target.chatType === "group") return true

  const { token } = openGatewayToken(gateway)
  if (target.platform === "telegram") {
    await new TelegramConnector({ botToken: token }).sendMessage(target.chatId, body.slice(0, 4_000))
  } else {
    await new DiscordConnector({ botToken: token }).sendMessage(target.chatId, body.slice(0, 2_000))
  }
  return true
}
