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
  GATEWAY_REFUSAL,
  gatewayChatDecision,
  gatewayChatRoomName,
  isGatewaySource,
  isSilentGatewayReply,
  type GatewaySource,
} from "@sayabot/core"
import { decryptSecret, unwrapConnectorSecret } from "@sayabot/llm"
import { and, eq, isNull } from "drizzle-orm"
import { DiscordConnector, TelegramConnector } from "../connectors/messaging"
import { getDb } from "../db"
import { getEnv } from "../env"
import { enqueueRoomMessage } from "../jobs"

/**
 * Per-agent gateways: one bot account, one bound chat, one room. The app and Telegram or Discord
 * are two clients of that room. A message from any other chat gets one refusal and does not open
 * another room.
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

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value)
}

async function loadGateway(gatewayId: string): Promise<GatewayRow | null> {
  if (!isUuid(gatewayId)) return null
  const [row] = await getDb()
    .select()
    .from(agentGateways)
    .where(eq(agentGateways.id, gatewayId))
    .limit(1)
  return row ?? null
}

async function loadGatewayByRoom(roomId: string): Promise<GatewayRow | null> {
  if (!isUuid(roomId)) return null
  const [row] = await getDb()
    .select()
    .from(agentGateways)
    .where(eq(agentGateways.roomId, roomId))
    .limit(1)
  return row ?? null
}

async function claimInbound(gatewayId: string, externalId: string): Promise<boolean> {
  const inserted = await getDb()
    .insert(gatewayInbound)
    .values({ gatewayId, externalId })
    .onConflictDoNothing()
    .returning({ externalId: gatewayInbound.externalId })
  return inserted.length > 0
}

/** First writer wins. A retry of the winning chat still counts as bound. */
async function claimBoundChat(gatewayId: string, chatId: string): Promise<boolean> {
  const db = getDb()
  const updated = await db
    .update(agentGateways)
    .set({ boundChatId: chatId, updatedAt: new Date() })
    .where(and(eq(agentGateways.id, gatewayId), isNull(agentGateways.boundChatId)))
    .returning({ id: agentGateways.id })
  if (updated.length > 0) return true
  const [fresh] = await db
    .select({ boundChatId: agentGateways.boundChatId })
    .from(agentGateways)
    .where(eq(agentGateways.id, gatewayId))
    .limit(1)
  return fresh?.boundChatId === chatId
}

async function sendGatewayText(gateway: GatewayRow, chatId: string, text: string): Promise<void> {
  const { token } = openGatewayToken(gateway)
  if (gateway.source === "telegram") {
    await new TelegramConnector({ botToken: token }).sendMessage(chatId, text.slice(0, 4_000))
    return
  }
  if (gateway.source === "discord") {
    await new DiscordConnector({ botToken: token }).sendMessage(chatId, text.slice(0, 2_000))
  }
}

async function chatTypeFor(
  gatewayId: string,
  chatId: string,
  hinted: "dm" | "group" | null,
): Promise<"dm" | "group"> {
  if (hinted) return hinted
  const [row] = await getDb()
    .select({ chatType: externalChats.chatType })
    .from(externalChats)
    .where(and(eq(externalChats.gatewayId, gatewayId), eq(externalChats.externalChatId, chatId)))
    .limit(1)
  return row?.chatType === "group" ? "group" : "dm"
}

/**
 * The room created at connect, or one created here if a gateway from before this column has none.
 * Two arrivals racing to create it leave a single room.
 */
async function ensureGatewayRoom(opts: {
  gateway: GatewayRow
  agent: { id: string; handle: string }
  chat: { chatId: string; chatType: "dm" | "group"; title?: string }
  binding: boolean
}): Promise<{ roomId: string; chatType: "dm" | "group" } | null> {
  const db = getDb()
  const { gateway, agent, chat } = opts
  const label = chat.title?.slice(0, 80)
  let roomId = gateway.roomId

  if (roomId) {
    const [existing] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(and(eq(rooms.id, roomId), eq(rooms.orgId, gateway.orgId)))
      .limit(1)
    if (!existing) roomId = null
  }

  if (!roomId) {
    const [created] = await db
      .insert(rooms)
      .values({
        orgId: gateway.orgId,
        name: gatewayChatRoomName(
          gateway.source as GatewaySource,
          agent.handle,
          label || (chat.chatType === "dm" ? "Direct message" : "Group"),
        ),
        kind: "private",
        turnMode: "mentions",
        timezone: "UTC",
        createdBy: gateway.createdBy,
      })
      .returning({ id: rooms.id })
    if (!created) return null
    const claimed = await db
      .update(agentGateways)
      .set({ roomId: created.id, updatedAt: new Date() })
      .where(and(eq(agentGateways.id, gateway.id), isNull(agentGateways.roomId)))
      .returning({ id: agentGateways.id })
    if (claimed.length === 0) {
      await db.delete(rooms).where(eq(rooms.id, created.id))
      const [fresh] = await db
        .select({ roomId: agentGateways.roomId })
        .from(agentGateways)
        .where(eq(agentGateways.id, gateway.id))
        .limit(1)
      roomId = fresh?.roomId ?? null
      if (!roomId) return null
    } else {
      roomId = created.id
    }
  } else if (opts.binding && label) {
    await db
      .update(rooms)
      .set({
        name: gatewayChatRoomName(gateway.source as GatewaySource, agent.handle, label),
        updatedAt: new Date(),
      })
      .where(eq(rooms.id, roomId))
  }

  await db
    .insert(roomAgents)
    .values({ roomId, agentId: agent.id, position: 0 })
    .onConflictDoNothing()
  if (gateway.createdBy) {
    await db
      .insert(roomMembers)
      .values({ roomId, userId: gateway.createdBy, role: "admin" })
      .onConflictDoNothing()
  }

  await db
    .insert(externalChats)
    .values({
      orgId: gateway.orgId,
      gatewayId: gateway.id,
      externalChatId: chat.chatId,
      chatType: chat.chatType,
      roomId,
      title: label ?? null,
      lastMessageAt: new Date(),
    })
    .onConflictDoNothing()

  return { roomId, chatType: chat.chatType }
}

/**
 * Stores one outside message and wakes the gateway's room. A repeated webhook for the same id
 * does nothing. `trusted` is the Discord socket, which already holds the bot token.
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
  const decision = gatewayChatDecision(gateway.boundChatId, chatId)
  // The allowlist chooses which chat may bind. Once bound, that chat stays even if the list moves.
  if (
    decision !== "accept" &&
    config.allowedChats?.length &&
    !config.allowedChats.includes(chatId)
  ) {
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

  if (!(await claimInbound(gateway.id, externalId))) {
    return { queued: false, reason: "duplicate" }
  }

  if (decision === "refuse") {
    await sendGatewayText(gateway, chatId, GATEWAY_REFUSAL).catch((error) => {
      console.error(
        "[gateway] refusal failed",
        error instanceof Error ? error.message : "send failed",
      )
    })
    return { queued: false, reason: "bound to another chat" }
  }

  if (decision === "bind") {
    const won = await claimBoundChat(gateway.id, chatId)
    if (!won) {
      await sendGatewayText(gateway, chatId, GATEWAY_REFUSAL).catch((error) => {
        console.error(
          "[gateway] refusal failed",
          error instanceof Error ? error.message : "send failed",
        )
      })
      return { queued: false, reason: "bound to another chat" }
    }
  }

  const chat = await ensureGatewayRoom({
    gateway,
    agent,
    chat: { chatId, chatType: args.chatType ?? "dm", title: args.chatTitle },
    binding: decision === "bind",
  })
  if (!chat) return { queued: false, reason: "could not open the chat" }

  const said = args.text.trim().slice(0, 8_000)
  const content = `@${agent.handle} ${args.sender || "Someone"} says:\n${said}`
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
    .where(and(eq(gatewayInbound.gatewayId, gateway.id), eq(gatewayInbound.externalId, externalId)))
  await db
    .update(externalChats)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(and(eq(externalChats.gatewayId, gateway.id), eq(externalChats.externalChatId, chatId)))
  await db
    .update(agentGateways)
    .set({ lastSeenAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(agentGateways.id, gateway.id))

  await enqueueRoomMessage(chat.roomId, message.id)
  return { queued: true }
}

/**
 * Sends the agent's reply to the gateway's bound chat. A reply typed in the app has no gateway
 * metadata, so the room id is the lookup. Returns `false` when this room is not a gateway (the
 * connector path can run) and `true` when the gateway handled it, including a silence token and a
 * room whose chat is not bound yet.
 */
export async function deliverGatewayReply(
  metadata: unknown,
  text: string,
  roomId?: string | null,
): Promise<boolean> {
  const target = readGatewayInbound(metadata)
  const gateway = target
    ? await loadGateway(target.gatewayId)
    : roomId
      ? await loadGatewayByRoom(roomId)
      : null
  if (!gateway || gateway.status !== "active" || (target && gateway.source !== target.platform)) {
    return Boolean(target)
  }

  const chatId = gateway.boundChatId ?? target?.chatId ?? null
  if (!chatId) return true

  const body = text.trim()
  if (!body || isSilentGatewayReply(body)) return true

  const hinted =
    target && (!gateway.boundChatId || target.chatId === gateway.boundChatId)
      ? target.chatType
      : null
  const chatType = await chatTypeFor(gateway.id, chatId, hinted)
  const config = (gateway.config ?? {}) as GatewayConfig
  if (config.silence && chatType === "group") return true

  await sendGatewayText(gateway, chatId, body)
  return true
}
