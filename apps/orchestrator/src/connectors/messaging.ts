import { fetchWithRetry } from "./rate-limiter"

/**
 * Messaging connectors: Discord and Telegram bots and the WhatsApp Business Cloud API.
 * Reads go through fetchWithRetry; sends never retry, so a timeout can't post a message twice.
 * Every send is a dangerous tool and waits for a person's OK before it reaches here.
 */

export interface MessagingMessage {
  id: string
  author: string
  text: string
  sentAt: string
  chatId: string
  chatName?: string
}

const MAX_TEXT = 4000

function clip(text: string, max = MAX_TEXT) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

async function readJson<T>(res: Response, service: string): Promise<T> {
  const body = await res.text()
  let parsed: unknown
  try {
    parsed = body ? JSON.parse(body) : {}
  } catch {
    throw new Error(`${service} returned HTTP ${res.status} with a non-JSON body`)
  }
  if (!res.ok) {
    const detail =
      (parsed as { message?: string; description?: string; error?: { message?: string } })?.message ??
      (parsed as { description?: string })?.description ??
      (parsed as { error?: { message?: string } })?.error?.message ??
      `HTTP ${res.status}`
    throw new Error(`${service}: ${detail}`)
  }
  return parsed as T
}

// ── Discord ────────────────────────────────────────────────────────────────

export class DiscordConnector {
  private static readonly API = "https://discord.com/api/v10"

  constructor(private config: { botToken: string; fetchFn?: typeof fetch }) {}

  private headers(json = false): Record<string, string> {
    return {
      Authorization: `Bot ${this.config.botToken}`,
      "User-Agent": "Sayabot (https://sayabot.com, 1.0)",
      ...(json ? { "Content-Type": "application/json" } : {}),
    }
  }

  async whoami(): Promise<{ id: string; username: string }> {
    const res = await fetchWithRetry(`${DiscordConnector.API}/users/@me`, { headers: this.headers() }, { fetchFn: this.config.fetchFn })
    return readJson(res, "Discord")
  }

  async listGuilds(): Promise<{ id: string; name: string }[]> {
    const res = await fetchWithRetry(`${DiscordConnector.API}/users/@me/guilds`, { headers: this.headers() }, { fetchFn: this.config.fetchFn })
    const guilds = await readJson<{ id: string; name: string }[]>(res, "Discord")
    return guilds.map((g) => ({ id: g.id, name: g.name }))
  }

  /** Text channels (type 0) and announcement channels (type 5) in a server. */
  async listChannels(guildId: string): Promise<{ id: string; name: string; topic?: string }[]> {
    if (!/^\d{5,25}$/.test(guildId)) throw new Error("Discord server ID must be a number")
    const res = await fetchWithRetry(
      `${DiscordConnector.API}/guilds/${guildId}/channels`,
      { headers: this.headers() },
      { fetchFn: this.config.fetchFn },
    )
    const channels = await readJson<{ id: string; name: string; type: number; topic?: string | null }[]>(res, "Discord")
    return channels
      .filter((c) => c.type === 0 || c.type === 5)
      .map((c) => ({ id: c.id, name: c.name, ...(c.topic ? { topic: c.topic } : {}) }))
  }

  async readMessages(channelId: string, limit = 25): Promise<MessagingMessage[]> {
    if (!/^\d{5,25}$/.test(channelId)) throw new Error("Discord channel ID must be a number")
    const n = Math.min(100, Math.max(1, limit))
    const res = await fetchWithRetry(
      `${DiscordConnector.API}/channels/${channelId}/messages?limit=${n}`,
      { headers: this.headers() },
      { fetchFn: this.config.fetchFn },
    )
    const messages = await readJson<
      { id: string; content: string; timestamp: string; author?: { username?: string; global_name?: string | null } }[]
    >(res, "Discord")
    return messages.map((m) => ({
      id: m.id,
      author: m.author?.global_name || m.author?.username || "unknown",
      text: clip(m.content ?? ""),
      sentAt: m.timestamp,
      chatId: channelId,
    }))
  }

  async sendMessage(channelId: string, content: string): Promise<{ id: string; url: string }> {
    if (!/^\d{5,25}$/.test(channelId)) throw new Error("Discord channel ID must be a number")
    if (!content.trim()) throw new Error("Message is empty")
    const res = await fetchWithRetry(
      `${DiscordConnector.API}/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: this.headers(true),
        // No @everyone/@here/role pings from an agent.
        body: JSON.stringify({ content: clip(content, 2000), allowed_mentions: { parse: ["users"] } }),
      },
      { fetchFn: this.config.fetchFn, maxRetries: 0 },
    )
    const sent = await readJson<{ id: string; channel_id: string; guild_id?: string }>(res, "Discord")
    return {
      id: sent.id,
      url: `https://discord.com/channels/${sent.guild_id ?? "@me"}/${sent.channel_id}/${sent.id}`,
    }
  }
}

// ── Telegram ───────────────────────────────────────────────────────────────

export class TelegramConnector {
  constructor(private config: { botToken: string; fetchFn?: typeof fetch }) {
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(config.botToken)) {
      throw new Error("That doesn't look like a Telegram bot token (from @BotFather, like 123456:ABC…)")
    }
  }

  private url(method: string) {
    return `https://api.telegram.org/bot${this.config.botToken}/${method}`
  }

  private async call<T>(method: string, body?: Record<string, unknown>, retry = true): Promise<T> {
    try {
      return await this.request<T>(method, body, retry)
    } catch (error) {
      // The token is part of Telegram's URL; keep it out of tool results and logs.
      const message = (error instanceof Error ? error.message : String(error)).split(this.config.botToken).join("[token]")
      throw new Error(message)
    }
  }

  private async request<T>(method: string, body: Record<string, unknown> | undefined, retry: boolean): Promise<T> {
    const res = await fetchWithRetry(
      this.url(method),
      body
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : { method: "GET" },
      { fetchFn: this.config.fetchFn, ...(retry ? {} : { maxRetries: 0 }) },
    )
    const data = await readJson<{ ok: boolean; result?: T; description?: string }>(res, "Telegram")
    if (!data.ok || data.result === undefined) throw new Error(`Telegram: ${data.description ?? "request failed"}`)
    return data.result
  }

  whoami() {
    return this.call<{ id: number; username?: string; first_name: string }>("getMe")
  }

  /**
   * Messages people sent the bot recently. Telegram keeps these for 24 hours and only while
   * no webhook is set on the bot. Reading does not mark them read, so other readers still see them.
   */
  async recentMessages(limit = 25): Promise<MessagingMessage[]> {
    type Update = {
      update_id: number
      message?: {
        message_id: number
        date: number
        text?: string
        caption?: string
        chat: { id: number; title?: string; username?: string; first_name?: string }
        from?: { username?: string; first_name?: string }
      }
    }
    const updates = await this.call<Update[]>("getUpdates", { limit: 100, allowed_updates: ["message"] })
    return updates
      .flatMap((u) => (u.message ? [u.message] : []))
      .slice(-Math.min(100, Math.max(1, limit)))
      .map((m) => ({
        id: String(m.message_id),
        author: m.from?.username ? `@${m.from.username}` : (m.from?.first_name ?? "unknown"),
        text: clip(m.text ?? m.caption ?? "[non-text message]"),
        sentAt: new Date(m.date * 1000).toISOString(),
        chatId: String(m.chat.id),
        chatName: m.chat.title ?? m.chat.username ?? m.chat.first_name,
      }))
  }

  async sendMessage(chatId: string, text: string): Promise<{ id: string }> {
    if (!/^-?\d{1,20}$/.test(chatId) && !/^@[A-Za-z0-9_]{5,32}$/.test(chatId)) {
      throw new Error("Telegram chat ID must be a number (or @channelname)")
    }
    if (!text.trim()) throw new Error("Message is empty")
    const sent = await this.call<{ message_id: number }>(
      "sendMessage",
      { chat_id: chatId, text: clip(text, 4096) },
      false,
    )
    return { id: String(sent.message_id) }
  }
}

// ── WhatsApp (Business Cloud API) ──────────────────────────────────────────

export class WhatsAppConnector {
  private static readonly API = "https://graph.facebook.com/v21.0"

  constructor(private config: { accessToken: string; phoneNumberId: string; fetchFn?: typeof fetch }) {
    if (!/^\d{5,25}$/.test(config.phoneNumberId)) {
      throw new Error("WhatsApp phone number ID is missing. Add it in Settings → Connectors.")
    }
  }

  private headers(json = false): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      ...(json ? { "Content-Type": "application/json" } : {}),
    }
  }

  async whoami(): Promise<{ display_phone_number?: string; verified_name?: string }> {
    const res = await fetchWithRetry(
      `${WhatsAppConnector.API}/${this.config.phoneNumberId}?fields=display_phone_number,verified_name`,
      { headers: this.headers() },
      { fetchFn: this.config.fetchFn },
    )
    return readJson(res, "WhatsApp")
  }

  /**
   * Sends a text. WhatsApp only delivers free-form text inside 24 hours of the person's last
   * message to this number; outside that window it needs an approved template (sendTemplate).
   */
  async sendText(to: string, body: string): Promise<{ id: string }> {
    const number = normalizePhone(to)
    if (!body.trim()) throw new Error("Message is empty")
    const res = await fetchWithRetry(
      `${WhatsAppConnector.API}/${this.config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: number,
          type: "text",
          text: { body: clip(body, 4096), preview_url: false },
        }),
      },
      { fetchFn: this.config.fetchFn, maxRetries: 0 },
    )
    const sent = await readJson<{ messages?: { id: string }[] }>(res, "WhatsApp")
    return { id: sent.messages?.[0]?.id ?? "" }
  }

  async sendTemplate(to: string, template: string, language: string): Promise<{ id: string }> {
    const number = normalizePhone(to)
    if (!/^[a-z0-9_]{1,512}$/.test(template)) throw new Error("Template names are lowercase letters, digits and _")
    const res = await fetchWithRetry(
      `${WhatsAppConnector.API}/${this.config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: number,
          type: "template",
          template: { name: template, language: { code: language } },
        }),
      },
      { fetchFn: this.config.fetchFn, maxRetries: 0 },
    )
    const sent = await readJson<{ messages?: { id: string }[] }>(res, "WhatsApp")
    return { id: sent.messages?.[0]?.id ?? "" }
  }
}

/** Digits only, country code first (E.164 without the +). */
export function normalizePhone(value: string): string {
  const digits = value.replace(/[\s().-]/g, "").replace(/^\+/, "")
  if (!/^\d{7,15}$/.test(digits)) throw new Error("Phone numbers need the country code, like +14155550123")
  return digits
}
