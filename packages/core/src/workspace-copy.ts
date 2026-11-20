/**
 * What the desktop sends the first time Cloud is ready, and what comes back when the plan ends.
 * Keys stay sealed. A row that already exists on the destination is left as it is.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PROVIDERS = new Set([
  "openai",
  "anthropic",
  "google",
  "groq",
  "cerebras",
  "openai-compatible",
])
const SENDERS = new Set(["human", "agent", "system"])

export interface BotCopy {
  id: string
  handle: string
  displayName: string
  kind: "llm" | "external"
  model: string | null
  systemPrompt: string
  params: Record<string, unknown>
  bio: string | null
  providerKeyId: string | null
}

export interface ChatMessageCopy {
  id: string
  senderType: "human" | "agent" | "system"
  content: string
  createdAt: string | null
}

export interface ChatCopy {
  id: string
  name: string
  kind: "public" | "private" | "dm"
  messages: ChatMessageCopy[]
}

export interface RoutineCopy {
  id: string
  name: string
  agentId: string
  roomId: string | null
  scheduleExpr: string
  prompt: string
  timezone: string
  enabled: boolean
}

export interface KeyCopy {
  id: string
  provider: string
  label: string
  ciphertext: string
  iv: string
  tag: string
  last4: string
  baseUrl: string | null
}

/** The app-level Boat key and VPS, sealed. A plaintext key is never accepted. */
export interface ComputerSettingsCopy {
  boatCiphertext: string | null
  boatIv: string | null
  boatTag: string | null
  boatLast4: string | null
  vpsSshAlias: string | null
  vpsStartAutomatically: boolean
}

export interface WorkspaceCopy {
  bots: BotCopy[]
  chats: ChatCopy[]
  routines: RoutineCopy[]
  keys: KeyCopy[]
  /** Absent when this Mac has no computer settings. */
  computers: ComputerSettingsCopy | null
}

export interface ExistingWorkspace {
  botIds: string[]
  handles: string[]
  chatIds: string[]
  routineIds: string[]
  keyIds: string[]
  /** The destination already has a Boat key or a VPS name. Those win. */
  computerSettings?: boolean
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Drops anything that is not a bot, chat, routine, or sealed key. */
export function parseWorkspaceCopy(value: unknown): WorkspaceCopy {
  const raw = record(value) ?? {}
  const list = (key: string) => (Array.isArray(raw[key]) ? raw[key] : []).slice(0, 200)
  const bots: BotCopy[] = []
  for (const item of list("bots")) {
    const row = record(item)
    const id = uuid(row?.id)
    const handle = text(row?.handle, 40).toLowerCase()
    const displayName = text(row?.displayName, 80)
    if (!row || !id || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(handle) || !displayName) continue
    bots.push({
      id,
      handle,
      displayName,
      kind: row.kind === "external" ? "external" : "llm",
      model: text(row.model, 200) || null,
      systemPrompt: text(row.systemPrompt, 20_000),
      params: record(row.params) ?? {},
      bio: text(row.bio, 500) || null,
      providerKeyId: uuid(row.providerKeyId),
    })
  }
  const chats: ChatCopy[] = []
  for (const item of list("chats")) {
    const row = record(item)
    const id = uuid(row?.id)
    const name = text(row?.name, 80)
    if (!row || !id || !name) continue
    const messages: ChatMessageCopy[] = []
    const rawMessages = Array.isArray(row.messages) ? row.messages.slice(0, 30) : []
    for (const message of rawMessages) {
      const entry = record(message)
      const messageId = uuid(entry?.id)
      const senderType = entry?.senderType
      if (!entry || !messageId || typeof senderType !== "string" || !SENDERS.has(senderType))
        continue
      messages.push({
        id: messageId,
        senderType: senderType as ChatMessageCopy["senderType"],
        content: text(entry.content, 20_000),
        createdAt: text(entry.createdAt, 40) || null,
      })
    }
    chats.push({
      id,
      name,
      kind: row.kind === "public" || row.kind === "dm" ? row.kind : "private",
      messages,
    })
  }
  const routines: RoutineCopy[] = []
  for (const item of list("routines")) {
    const row = record(item)
    const id = uuid(row?.id)
    const agentId = uuid(row?.agentId)
    const name = text(row?.name, 80)
    const scheduleExpr = text(row?.scheduleExpr, 120)
    const prompt = text(row?.prompt, 20_000)
    if (!id || !agentId || !name || !scheduleExpr || !prompt) continue
    routines.push({
      id,
      name,
      agentId,
      roomId: uuid(row?.roomId),
      scheduleExpr,
      prompt,
      timezone: text(row?.timezone, 64) || "UTC",
      enabled: row?.enabled !== false,
    })
  }
  const keys: KeyCopy[] = []
  for (const item of list("keys")) {
    const row = record(item)
    const id = uuid(row?.id)
    const provider = text(row?.provider, 40)
    const label = text(row?.label, 80)
    const ciphertext = text(row?.ciphertext, 8_000)
    const iv = text(row?.iv, 80)
    const tag = text(row?.tag, 80)
    const last4 = text(row?.last4, 8)
    if (!id || !PROVIDERS.has(provider) || !label || !ciphertext || !iv || !tag || !last4) continue
    keys.push({
      id,
      provider,
      label,
      ciphertext,
      iv,
      tag,
      last4,
      baseUrl: text(row?.baseUrl, 200) || null,
    })
  }
  const computersRaw = record(raw.computers)
  let computers: ComputerSettingsCopy | null = null
  if (computersRaw && !("boatToken" in computersRaw) && !("token" in computersRaw)) {
    const ciphertext = text(computersRaw.boatCiphertext, 8_000)
    const iv = text(computersRaw.boatIv, 80)
    const tag = text(computersRaw.boatTag, 80)
    const last4 = text(computersRaw.boatLast4, 8)
    const alias = text(computersRaw.vpsSshAlias, 80)
    const sealed = Boolean(ciphertext && iv && tag && last4)
    const safeAlias = alias && /^[A-Za-z0-9_.:@-]+$/.test(alias) ? alias : null
    if (sealed || safeAlias) {
      computers = {
        boatCiphertext: sealed ? ciphertext : null,
        boatIv: sealed ? iv : null,
        boatTag: sealed ? tag : null,
        boatLast4: sealed ? last4 : null,
        vpsSshAlias: safeAlias,
        vpsStartAutomatically: computersRaw.vpsStartAutomatically === true,
      }
    }
  }
  return { bots, chats, routines, keys, computers }
}

/**
 * Rows to insert. An id or a bot handle that the destination already has is skipped,
 * so Cloud keeps its own copy of that bot.
 */
export function materializeCopy(
  existing: ExistingWorkspace,
  incoming: WorkspaceCopy,
): WorkspaceCopy {
  const botIds = new Set(existing.botIds)
  const handles = new Set(existing.handles)
  const chatIds = new Set(existing.chatIds)
  const routineIds = new Set(existing.routineIds)
  const keyIds = new Set(existing.keyIds)
  const bots = incoming.bots.filter((bot) => {
    if (botIds.has(bot.id) || handles.has(bot.handle)) return false
    botIds.add(bot.id)
    handles.add(bot.handle)
    return true
  })
  const knownBots = botIds
  const keys = incoming.keys.filter((key) => {
    if (keyIds.has(key.id)) return false
    keyIds.add(key.id)
    return true
  })
  const knownKeys = keyIds
  const chats = incoming.chats.filter((chat) => {
    if (chatIds.has(chat.id)) return false
    chatIds.add(chat.id)
    return true
  })
  const knownChats = chatIds
  return {
    bots: bots.map((bot) => ({
      ...bot,
      providerKeyId:
        bot.providerKeyId && knownKeys.has(bot.providerKeyId) ? bot.providerKeyId : null,
    })),
    chats,
    routines: incoming.routines.filter(
      (routine) =>
        !routineIds.has(routine.id) &&
        knownBots.has(routine.agentId) &&
        (routine.roomId === null || knownChats.has(routine.roomId)),
    ),
    keys,
    computers: existing.computerSettings ? null : incoming.computers,
  }
}
