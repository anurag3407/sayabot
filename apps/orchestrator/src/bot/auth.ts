import { agentKeyPrefix, hashAgentApiKey } from "@sayabot/core/server"
import { agentApiKeys, agents, oauthTokens } from "@sayabot/db"
import { and, eq, gt, isNull, lt, or } from "drizzle-orm"
import { getDb } from "../db"

export interface BotIdentity {
  keyId: string
  agentId: string
  orgId: string
  agent: typeof agents.$inferSelect
  scopes: string[]
  roomIds: string[] | null
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** How often an agent's "last seen" stamp is written; calls in between skip the write. */
const SEEN_EVERY_MS = 30_000

/**
 * Stamps when an invited agent's own app last called in, so a room can tell whether the app is
 * open. Fire-and-forget and throttled: one conditional UPDATE, a no-op within 30 seconds.
 */
export function markAgentSeen(agentId: string, now = new Date()): void {
  void getDb()
    .update(agents)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(agents.id, agentId),
        or(isNull(agents.lastSeenAt), lt(agents.lastSeenAt, new Date(now.getTime() - SEEN_EVERY_MS))),
      ),
    )
    .catch(() => {})
}

export async function authenticateAgentKey(
  authorization: string | undefined,
): Promise<BotIdentity | null> {
  if (!authorization?.startsWith("Bearer ")) return null
  const token = authorization.slice(7).trim()

  // 1. OAuth Access Token path (mesh_at_... or sayabot_at_...)
  if (token.startsWith("mesh_at_") || token.startsWith("sayabot_at_")) {
    const tokenHash = hashAgentApiKey(token)
    const now = new Date()
    const [row] = await getDb()
      .select({ token: oauthTokens, agent: agents })
      .from(oauthTokens)
      .innerJoin(agents, eq(agents.id, oauthTokens.agentId))
      .where(
        and(
          eq(oauthTokens.tokenHash, tokenHash),
          eq(oauthTokens.kind, "access"),
          isNull(oauthTokens.revokedAt),
          gt(oauthTokens.expiresAt, now),
        ),
      )
      .limit(1)

    if (!row) return null
    markAgentSeen(row.agent.id, now)

    return {
      keyId: row.token.id,
      agentId: row.agent.id,
      orgId: row.agent.orgId,
      agent: row.agent,
      scopes: row.token.scopes,
      roomIds: row.token.roomIds ?? null,
    }
  }

  // 2. Direct API Key path (mesh_ak_... or saaya_ak_... or sayabot_ak_...)
  if (!token.startsWith("mesh_ak_") && !token.startsWith("saaya_ak_") && !token.startsWith("sayabot_ak_")) return null
  const prefix = agentKeyPrefix(token)
  const now = new Date()

  const [row] = await getDb()
    .select({ key: agentApiKeys, agent: agents })
    .from(agentApiKeys)
    .innerJoin(agents, eq(agents.id, agentApiKeys.agentId))
    .where(and(eq(agentApiKeys.prefix, prefix), isNull(agentApiKeys.revokedAt)))
    .limit(1)

  if (!row) return null
  if (row.key.expiresAt && row.key.expiresAt <= now) return null
  if (!safeEqualHex(hashAgentApiKey(token), row.key.keyHash)) return null

  void getDb()
    .update(agentApiKeys)
    .set({ lastUsedAt: now })
    .where(eq(agentApiKeys.id, row.key.id))
    .catch(() => {})
  markAgentSeen(row.agent.id, now)

  return {
    keyId: row.key.id,
    agentId: row.agent.id,
    orgId: row.agent.orgId,
    agent: row.agent,
    scopes: row.key.scopes,
    roomIds: row.key.roomIds ?? null,
  }
}
