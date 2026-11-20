import { desktopHosts, providerKeys, roomAgents, type RoomModelOverride } from "@sayabot/db"
import { and, eq } from "drizzle-orm"
import { getDb } from "../db"
import type { AgentRow } from "./context"

/**
 * "Only this chat": a bot can answer in one chat with another model than its default. The
 * override was resolved and checked when it was saved; here it is applied to the bot for this
 * turn only, after checking again that what it points at still belongs to this bot's workspace
 * and owner (a key deleted or moved since, a computer revoked). Anything stale is ignored and
 * the bot answers with its default.
 */

export function parseRoomModelOverride(value: unknown): RoomModelOverride | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const str = (x: unknown) => (typeof x === "string" && x ? x : null)
  const runner =
    v.runner && typeof v.runner === "object" && !Array.isArray(v.runner)
      ? (v.runner as Record<string, unknown>)
      : null
  return {
    keyId: str(v.keyId),
    model: str(v.model),
    effort: str(v.effort),
    providerKeyId: str(v.providerKeyId),
    agentModel: str(v.agentModel),
    runner,
  }
}

/** The bot as it answers with the override: its key, model, runner and effort replaced. */
export function withModelOverride(agent: AgentRow, override: RoomModelOverride): AgentRow {
  const params = { ...((agent.params as Record<string, unknown> | null) ?? {}) }
  if (override.runner) params.runner = override.runner
  else delete params.runner
  if (override.effort) params.effort = override.effort
  else delete params.effort
  return { ...agent, providerKeyId: override.providerKeyId, model: override.agentModel, params }
}

async function stillValid(agent: AgentRow, override: RoomModelOverride): Promise<boolean> {
  const db = getDb()
  if (override.providerKeyId) {
    const [key] = await db
      .select({ orgId: providerKeys.orgId })
      .from(providerKeys)
      .where(eq(providerKeys.id, override.providerKeyId))
      .limit(1)
    if (!key || key.orgId !== agent.orgId) return false
  }
  const hostId = override.runner?.hostId
  if (typeof hostId === "string") {
    const [host] = await db
      .select({ userId: desktopHosts.userId, revokedAt: desktopHosts.revokedAt })
      .from(desktopHosts)
      .where(eq(desktopHosts.id, hostId))
      .limit(1)
    if (!host || host.revokedAt || host.userId !== agent.ownerUserId) return false
  }
  return true
}

export async function applyRoomModel(roomId: string, agent: AgentRow): Promise<AgentRow> {
  const [row] = await getDb()
    .select({ modelOverride: roomAgents.modelOverride })
    .from(roomAgents)
    .where(and(eq(roomAgents.roomId, roomId), eq(roomAgents.agentId, agent.id)))
    .limit(1)
  const override = parseRoomModelOverride(row?.modelOverride)
  if (!override) return agent
  if (!(await stillValid(agent, override))) {
    console.warn(`[room-model] ignoring a stale model for @${agent.handle} in room ${roomId}`)
    return agent
  }
  return withModelOverride(agent, override)
}
