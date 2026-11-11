import "server-only"
import { botInviteState, generateSetupInstructions, normalizeClient, type BotInviteState } from "@sayabot/core"
import { generateAgentApiKey, hashAgentApiKey } from "@sayabot/core/server"
import { audit } from "@/lib/actions/shared"
import { getAppUrl } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

/** Scopes an approved room bot gets: the same set as a hand-made room key. */
export const ROOM_BOT_SCOPES = [
  "room:read",
  "room:write",
  "tasks:read",
  "tasks:write",
  "canvas:read",
  "canvas:write",
  "secrets:use",
]

export interface BotInviteRow {
  id: string
  org_id: string
  room_id: string
  code: string
  name: string | null
  app: string | null
  status: string
  request_name: string | null
  request_app: string | null
  request_about: string | null
  request_user_agent: string | null
  requested_at: string | null
  poll_token_hash: string | null
  agent_id: string | null
  created_by: string | null
  decided_at: string | null
  joined_at: string | null
  rejected_attempts: Array<{ at: string; app?: string; userAgent?: string }>
  expires_at: string
  created_at: string
}

export function appBaseUrl(): string {
  return getAppUrl().replace(/\/+$/, "")
}

export function botInviteUrl(code: string): string {
  return `${appBaseUrl()}/bot/${code}`
}

export async function loadBotInviteByCode(code: string): Promise<BotInviteRow | null> {
  if (!/^bi_[A-Za-z0-9_-]{10,64}$/.test(code)) return null
  const { data } = await createAdminClient().from("bot_invites").select("*").eq("code", code).maybeSingle()
  return (data as BotInviteRow | null) ?? null
}

export function inviteState(row: Pick<BotInviteRow, "status" | "expires_at">): BotInviteState {
  return botInviteState({ status: row.status, expiresAt: row.expires_at })
}

export async function roomContext(roomId: string): Promise<{ roomName: string; ownerName: string; timezone: string }> {
  const admin = createAdminClient()
  const { data: room } = await admin
    .from("rooms")
    .select("name, timezone, created_by")
    .eq("id", roomId)
    .maybeSingle()
  let ownerName = "the room owner"
  if (room?.created_by) {
    const { data: owner } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", room.created_by)
      .maybeSingle()
    if (owner?.display_name) ownerName = owner.display_name
  }
  return { roomName: room?.name ?? "the room", ownerName, timezone: room?.timezone ?? "UTC" }
}

/** Constant-time compare of the bearer poll token against the stored hash. */
export function pollTokenMatches(row: Pick<BotInviteRow, "poll_token_hash">, authorization: string | null): boolean {
  if (!row.poll_token_hash || !authorization?.startsWith("Bearer ")) return false
  const hash = hashAgentApiKey(authorization.slice(7).trim())
  const stored = row.poll_token_hash
  if (hash.length !== stored.length) return false
  let diff = 0
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ stored.charCodeAt(i)
  return diff === 0
}

/**
 * Flips an approved invite to joined and mints the bot's key. The status guard in the
 * update makes this single-use even if two polls race: only one update matches.
 */
export async function collectBotKey(row: BotInviteRow): Promise<
  | { ok: true; connectionUrl: string; instructions: string; handle: string }
  | { ok: false; reason: string }
> {
  if (!row.agent_id) return { ok: false, reason: "no agent on this invite" }
  const admin = createAdminClient()
  const { data: claimed } = await admin
    .from("bot_invites")
    .update({ status: "joined", joined_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "approved")
    .select("id")
    .maybeSingle()
  if (!claimed) return { ok: false, reason: "already collected" }

  const { data: agent } = await admin
    .from("agents")
    .select("id, handle, display_name")
    .eq("id", row.agent_id)
    .maybeSingle()
  if (!agent) return { ok: false, reason: "the agent was removed" }

  const ctx = await roomContext(row.room_id)
  const key = generateAgentApiKey()
  const client = normalizeClient(row.request_app || row.app || "generic")
  const { error } = await admin.from("agent_api_keys").insert({
    agent_id: agent.id,
    prefix: key.prefix,
    key_hash: key.hash,
    room_ids: [row.room_id],
    scopes: ROOM_BOT_SCOPES,
    label: `${client.label} via invite link for #${ctx.roomName}`,
  })
  if (error) {
    // Put the invite back so the bot can try again on its next poll.
    await admin.from("bot_invites").update({ status: "approved", joined_at: null }).eq("id", row.id)
    return { ok: false, reason: "could not create the connection key, try again" }
  }

  const connectionUrl = `${appBaseUrl()}/mcp/${key.token}`
  const instructions = generateSetupInstructions({
    handle: agent.handle,
    displayName: agent.display_name,
    roomName: ctx.roomName,
    roomId: row.room_id,
    roomOwnerName: ctx.ownerName,
    timezone: ctx.timezone,
    token: key.token,
    connectionUrl,
    client: client.id,
  })

  await admin.from("messages").insert({
    room_id: row.room_id,
    sender_type: "system",
    content: `@${agent.handle} joined the room from ${client.label}.`,
    status: "complete",
    metadata: { botJoined: true, agentId: agent.id, inviteId: row.id },
  })
  await audit({
    orgId: row.org_id,
    actorType: "agent",
    actorId: agent.id,
    action: "bot_invite.joined",
    target: agent.id,
    metadata: { inviteId: row.id, roomId: row.room_id, app: client.id },
  })
  return { ok: true, connectionUrl, instructions, handle: agent.handle }
}
