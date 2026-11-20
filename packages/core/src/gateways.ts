/**
 * Agent gateways: one external bot account per agent (Telegram, Discord). A token is an identity,
 * so a gateway belongs to exactly one agent — sharing one bot between agents makes a DM
 * ambiguous. These helpers are shared by the orchestrator, the web settings UI and the tests.
 */

export const GATEWAY_SOURCES = ["telegram", "discord"] as const
export type GatewaySource = (typeof GATEWAY_SOURCES)[number]

export function isGatewaySource(value: unknown): value is GatewaySource {
  return value === "telegram" || value === "discord"
}

/**
 * Group chats should not receive "nothing to report" noise. A reply that is exactly one of these
 * tokens is suppressed instead of sent. Mirrors the convention Hermes uses.
 */
export const GATEWAY_SILENCE_TOKENS = new Set([
  "[silent]",
  "silent",
  "no_reply",
  "no reply",
  "[静默]",
  "静默",
  "[沉默]",
  "沉默",
])

export function isSilentGatewayReply(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return true
  return GATEWAY_SILENCE_TOKENS.has(normalized)
}

/** "Telegram" / "Discord" for UI copy. */
export function gatewayLabel(source: GatewaySource): string {
  return source === "telegram" ? "Telegram" : "Discord"
}

/** The room title for a mirrored external chat, kept short and stable. */
export function gatewayChatRoomName(source: GatewaySource, handle: string, chatTitle: string): string {
  const title = chatTitle.replace(/\s+/g, " ").trim().slice(0, 40) || "chat"
  return `${gatewayLabel(source)} · ${title}`
}

/** A Telegram bot token has a fixed shape; rejecting early gives a human error instead of a 404. */
export function looksLikeTelegramToken(token: string): boolean {
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(token.trim())
}
