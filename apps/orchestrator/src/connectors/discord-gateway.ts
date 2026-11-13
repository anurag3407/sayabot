import { workspaceConnectors } from "@sayabot/db"
import { decryptSecret, unwrapConnectorSecret } from "@sayabot/llm"
import { eq } from "drizzle-orm"
import WebSocket from "ws"
import { getDb } from "../db"
import { getEnv } from "../env"
import { acceptInbound } from "./inbound"

/** GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT. Message content is a privileged Discord intent. */
const INTENTS = (1 << 9) | (1 << 12) | (1 << 15)

const sockets = new Map<string, WebSocket>()
let started = false

/**
 * Discord does not POST ordinary messages to a URL, so each connected bot keeps a gateway
 * socket here. A person's message becomes a room turn; the reply goes back when the turn ends.
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
  const rows = await getDb().select().from(workspaceConnectors).where(eq(workspaceConnectors.source, "discord"))
  const wanted = new Set<string>()
  for (const row of rows) {
    const inbound = ((row.config ?? {}) as { inbound?: { enabled?: boolean } }).inbound
    if (row.status !== "active" || !inbound?.enabled) continue
    wanted.add(row.id)
    if (sockets.has(row.id)) continue
    let token = ""
    try {
      token = unwrapConnectorSecret(
        decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag }, getEnv().MESH_KEK),
      ).token
    } catch {
      continue
    }
    void connect(row.id, token)
  }
  for (const [id, socket] of sockets) {
    if (!wanted.has(id)) {
      socket.close()
      sockets.delete(id)
    }
  }
}

async function connect(connectorId: string, token: string): Promise<void> {
  const gateway = await fetch("https://discord.com/api/v10/gateway/bot", {
    headers: { Authorization: `Bot ${token}` },
  })
  if (!gateway.ok) {
    console.warn(`[discord] gateway lookup failed for ${connectorId}: HTTP ${gateway.status}`)
    return
  }
  const body = (await gateway.json()) as { url?: string }
  if (!body.url) return
  const ws = new WebSocket(`${body.url}?v=10&encoding=json`)
  sockets.set(connectorId, ws)
  let heartbeat: ReturnType<typeof setInterval> | undefined
  ws.on("message", (raw) => {
    let packet: { op?: number; t?: string; d?: Record<string, unknown> & { heartbeat_interval?: number } }
    try {
      packet = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (packet.op === 10 && packet.d?.heartbeat_interval) {
      heartbeat = setInterval(() => ws.send(JSON.stringify({ op: 1, d: null })), packet.d.heartbeat_interval)
      ws.send(JSON.stringify({
        op: 2,
        d: { token, intents: INTENTS, properties: { os: "linux", browser: "sayabot", device: "sayabot" } },
      }))
    }
    if (packet.op === 0 && packet.t === "MESSAGE_CREATE") void onMessage(connectorId, packet.d)
  })
  const stop = () => {
    if (heartbeat) clearInterval(heartbeat)
    if (sockets.get(connectorId) === ws) sockets.delete(connectorId)
  }
  ws.on("close", stop)
  ws.on("error", stop)
}

async function onMessage(connectorId: string, data: Record<string, unknown> | undefined): Promise<void> {
  if (!data) return
  const author = data.author as { bot?: boolean; username?: string } | undefined
  if (author?.bot) return
  const text = typeof data.content === "string" ? data.content.trim() : ""
  const channelId = typeof data.channel_id === "string" ? data.channel_id : ""
  const id = typeof data.id === "string" ? data.id : ""
  if (!text || !channelId || !id) return
  await acceptInbound({
    connectorId,
    platform: "discord",
    externalId: id,
    chatId: channelId,
    sender: author?.username ? `@${author.username}` : "Someone",
    text,
    trusted: true,
  }).catch((error) => console.warn("[discord] inbound failed", error instanceof Error ? error.message : error))
}
