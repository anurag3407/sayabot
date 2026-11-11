/**
 * Approval-gated agent invites ("Add an agent").
 *
 * The link a person pastes into their bot's chat holds no credential. The bot opens it,
 * asks to join (POST), and waits. The person approves in their Inbox. Only then does that
 * same bot, proven by the poll token it got when it asked, collect its connection key,
 * exactly once. A second app using the same link is turned away and the person is told.
 */

export const BOT_INVITE_TTL_DAYS = 7
export const BOT_INVITE_WAIT_MAX_SECONDS = 25

export type BotInviteState =
  | "waiting"
  | "pending"
  | "approved"
  | "joined"
  | "declined"
  | "revoked"
  | "expired"

export function botInviteState(
  row: { status: string; expiresAt: string | Date },
  now: Date = new Date(),
): BotInviteState {
  const status = row.status as BotInviteState
  if (status === "joined" || status === "declined" || status === "revoked") return status
  if (new Date(row.expiresAt).getTime() <= now.getTime()) return "expired"
  return status
}

/** The message the person pastes into their bot's own chat. No secrets in it. */
export function botInviteMessage(ctx: { roomName: string; ownerName?: string; url: string }): string {
  const room = ctx.roomName?.trim() || "my room"
  return [
    `Hi! I'd like you to join my room "${room}" on Sayabot, a private group chat for people and their AI bots. I set it up myself, and I'm the one sending you this.`,
    `Please open this link and ask to join. Nothing is shared with you until I approve you there:`,
    ctx.url,
  ].join("\n")
}

/** Turns "Hermes Agent" into "hermes-agent" for the @handle. */
export function handleFromName(name: string | null | undefined, fallback = "bot"): string {
  const slug = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "")
  return slug || fallback
}

/** What a bot reads when it opens the link. Plain text so every agent can follow it. */
export function botJoinInstructions(ctx: {
  roomName: string
  ownerName: string
  joinUrl: string
  statusUrl: string
  suggestedName?: string | null
  suggestedApp?: string | null
}): string {
  const name = ctx.suggestedName?.trim()
  const app = ctx.suggestedApp?.trim()
  return [
    `Sayabot: request to join "${ctx.roomName}"`,
    ``,
    `${ctx.ownerName} invited you to their private room on Sayabot, where people and their AI bots work together: they talk in a group chat, split up tasks and report back.`,
    `Nothing is shared with you yet. You ask to join, ${ctx.ownerName} approves you, and only then do you get your connection details. This link works for one bot in one app.`,
    ``,
    `STEP 1: ASK TO JOIN`,
    `Send an HTTP POST to:`,
    `  ${ctx.joinUrl}`,
    `with a JSON body:`,
    `  {`,
    `    "name": "${name || "<the name the owner calls you>"}",`,
    `    "app": "${app || "<your app: hermes | claude-code | codex | cursor | claude | chatgpt | antigravity | other>"}",`,
    `    "about": "<one line: what you are good at>"`,
    `  }`,
    `For example:`,
    `  curl -sS -X POST '${ctx.joinUrl}' -H 'content-type: application/json' \\`,
    `    -d '{"name":"${name || "hermes"}","app":"${app || "hermes"}","about":"research and drafting"}'`,
    `The reply has a poll_token. Keep it private: it proves you are the bot that asked.`,
    ``,
    `STEP 2: TELL ${ctx.ownerName.toUpperCase()}`,
    `Say in your chat with them: "I asked to join ${ctx.roomName}. Please approve me in your Sayabot Inbox."`,
    ``,
    `STEP 3: WAIT FOR APPROVAL`,
    `Call this with your poll token until the status changes (it waits up to ${BOT_INVITE_WAIT_MAX_SECONDS} seconds per call):`,
    `  curl -sS '${ctx.statusUrl}?wait=${BOT_INVITE_WAIT_MAX_SECONDS}' -H 'authorization: Bearer <poll_token>'`,
    `- "pending": not decided yet, call again.`,
    `- "approved": the reply contains your connection link and setup steps, shown ONCE. Save the link in your MCP settings straight away and follow the steps.`,
    `- "declined" or "expired": stop and tell ${ctx.ownerName}.`,
    ``,
    `If you cannot send HTTP requests yourself, tell ${ctx.ownerName} and ask them to use "Set up by hand" in Sayabot instead.`,
  ].join("\n")
}
