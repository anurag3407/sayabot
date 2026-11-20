import { agentGateways, workspaceConnectors } from "@sayabot/db"
import { decryptSecret, unwrapConnectorSecret } from "@sayabot/llm"
import { and, eq } from "drizzle-orm"
import WebSocket from "ws"
import { getDb } from "../db"
import { getEnv } from "../env"
import { acceptInbound } from "./inbound"
import { acceptGatewayInbound } from "../gateways/inbound"

/** GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT. Message content is a privileged Discord intent. */
const INTENTS = (1 << 9) | (1 << 12) | (1 << 15)

type Dispatch = (data: Record<string, unknown> | undefined) => void

const sockets = new Map<string, WebSocket>()
let started = false

const connectorKey = (id: string) => `connector:${id}`
const gatewayKey = (id: string) => `gateway:${id}`

/**
 * Discord does not POST ordinary messages to a URL, so every connected bot keeps a gateway socket
 * here. Two kinds of rows are served from one loop:
 *
 *  - `workspace_connectors` (legacy, workspace-wide): messages route to the connector's configured
 *    room/agent.
 *  - `agent_gateways` (per agent): messages route through the gateway's own mirror room, so each
 *    bot is its own identity with its own conversations.
 */
export function startDiscordGateway(): void {
  if (started) return
  started = true
  void tick()
}

async function tick(): Promise<void> {
  for (;;) {
    try {
      await sync()
    } catch (error) {
      console.warn("[discord] gateway sync failed", error instanceof Error ? error.message : error)
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000))
  }
}

async function sync(): Promise<void> {
  const db = getDb()
  const wanted = new Set<string>()

  const connectors = await db
    .select()
    .from(workspaceConnectors)
    .where(eq(workspaceConnectors.source, "discord"))
  for (const row of connectors) {
    const inbound = ((row.config ?? {}) as { inbound?: { enabled?: boolean } }).inbound
    if (row.status !== "active" || !inbound?.enabled) continue
    const key = connectorKey(row.id)
    wanted.add(key)
    if (sockets.has(key)) continue
    let token = ""
    try {
      token = unwrapConnectorSecret(
        decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag }, getEnv().MESH_KEK),
      ).token
    } catch {
      continue
    }
    void connect(key, token, (data) => void onConnectorMessage(row.id, data))
  }

  const gateways = await db
    .select()
    .from(agentGateways)
    .where(and(eq(agentGateways.source, "discord"), eq(agentGateways.status, "active")))
  for (const row of gateways) {
    const key = gatewayKey(row.id)
    wanted.add(key)
    if (sockets.has(key)) continue
    let token = ""
    try {
      token = unwrapConnectorSecret(
        decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag }, getEnv().MESH_KEK),
      ).token
    } catch {
      continue
    }
    void connect(key, token, (data) => void onGatewayMessage(row.id, data))
  }

  for (const [key, socket] of sockets) {
    if (!wanted.has(key)) {
      socket.close()
      sockets.delete(key)
    }
  }
}

async function connect(key: string, token: string, onDispatch: Dispatch): Promise<void> {
  const apiBase = (process.env.DISCORD_API_BASE ?? "https://discord.com/api/v10").replace(
    /\/+$/,
    "",
  )
  const gateway = await fetch(`${apiBase}/gateway/bot`, {
    headers: { Authorization: `Bot ${token}` },
  })
  if (!gateway.ok) {
    console.warn(`[discord] gateway lookup failed for ${key}: HTTP ${gateway.status}`)
    return
  }
  const body = (await gateway.json()) as { url?: string }
  if (!body.url) return
  const ws = new WebSocket(`${body.url}?v=10&encoding=json`)
  sockets.set(key, ws)
  let heartbeat: ReturnType<typeof setInterval> | undefined
  ws.on("message", (raw) => {
    let packet: {
      op?: number
      t?: string
      d?: Record<string, unknown> & { heartbeat_interval?: number }
    }
    try {
      packet = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (packet.op === 10 && packet.d?.heartbeat_interval) {
      heartbeat = setInterval(
        () => ws.send(JSON.stringify({ op: 1, d: null })),
        packet.d.heartbeat_interval,
      )
      ws.send(
        JSON.stringify({
          op: 2,
          d: {
            token,
            intents: INTENTS,
            properties: { os: "linux", browser: "sayabot", device: "sayabot" },
          },
        }),
      )
    }
    if (packet.op === 0 && packet.t === "MESSAGE_CREATE") onDispatch(packet.d)
  })
  const stop = () => {
    if (heartbeat) clearInterval(heartbeat)
    if (sockets.get(key) === ws) sockets.delete(key)
  }
  ws.on("close", stop)
  ws.on("error", stop)
}

async function onConnectorMessage(
  connectorId: string,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const event = readDiscordMessage(data)
  if (!event) return
  await acceptInbound({
    connectorId,
    platform: "discord",
    externalId: event.id,
    chatId: event.channelId,
    sender: event.sender,
    text: event.text,
    trusted: true,
  }).catch((error) =>
    console.warn("[discord] inbound failed", error instanceof Error ? error.message : error),
  )
}

async function onGatewayMessage(
  gatewayId: string,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const event = readDiscordMessage(data)
  if (!event) return
  await acceptGatewayInbound({
    gatewayId,
    platform: "discord",
    externalId: event.id,
    chatId: event.channelId,
    sender: event.sender,
    senderId: event.senderId,
    text: event.text,
    chatType: event.chatType,
    chatTitle: event.chatTitle,
    trusted: true,
  }).catch((error) =>
    console.warn("[discord] gateway inbound failed", error instanceof Error ? error.message : error),
  )
}

function readDiscordMessage(data: Record<string, unknown> | undefined): {
  id: string
  channelId: string
  sender: string
  senderId: string
  text: string
  chatType: "dm" | "group"
  chatTitle?: string
} | null {
  if (!data) return null
  const author = data.author as { id?: string; bot?: boolean; username?: string } | undefined
  if (author?.bot) return null
  const text = typeof data.content === "string" ? data.content.trim() : ""
  const channelId = typeof data.channel_id === "string" ? data.channel_id : ""
  const id = typeof data.id === "string" ? data.id : ""
  if (!text || !channelId || !id) return null
  // Discord sends `guild_id` for server channels and omits it in DMs.
  const chatType: "dm" | "group" = typeof data.guild_id === "string" ? "group" : "dm"
  return {
    id,
    channelId,
    sender: author?.username ? `@${author.username}` : "Someone",
    senderId: author?.id ?? "",
    text,
    chatType,
  }
}
