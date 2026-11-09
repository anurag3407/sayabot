import { and, eq, or, type SQL } from "drizzle-orm"
import { memories, memorySources, type MemorySourceRow } from "@sayabot/db"
import type { MemoryScope } from "../types"

export interface ScopeIdentifier {
  scope: MemoryScope
  id: string
}

export function formatSourceId(scope: MemoryScope, id: string): string {
  return `${scope}:${id}`
}

export function parseSourceId(sourceId: string): ScopeIdentifier | null {
  const parts = sourceId.split(":")
  if (parts.length < 2) return null
  const [scope, ...rest] = parts
  const id = rest.join(":")
  if (scope !== "agent" && scope !== "room" && scope !== "org") return null
  return { scope, id }
}

/**
 * Returns or creates a registered memory source.
 */
export async function getOrCreateSource(
  db: any,
  input: {
    orgId: string
    scope: MemoryScope
    targetId: string
    name: string
    federated?: boolean
    config?: Record<string, unknown>
  },
): Promise<MemorySourceRow> {
  const sourceId = formatSourceId(input.scope, input.targetId)

  const [existing] = await db
    .select()
    .from(memorySources)
    .where(and(eq(memorySources.id, sourceId), eq(memorySources.orgId, input.orgId)))
    .limit(1)

  if (existing) {
    return existing
  }

  const [inserted] = await db
    .insert(memorySources)
    .values({
      id: sourceId,
      orgId: input.orgId,
      name: input.name,
      federated: input.federated ?? false,
      config: input.config ?? {},
    })
    .onConflictDoNothing()
    .returning()

  if (inserted) {
    return inserted
  }

  // If conflict happened concurrently, fetch existing
  const [found] = await db
    .select()
    .from(memorySources)
    .where(eq(memorySources.id, sourceId))
    .limit(1)

  return found
}

/**
 * Builds the SQL filter condition for memory queries given the caller's context.
 * Private agent memories are visible only to that agent.
 * Room memories are visible only in that room.
 * Org memories are visible org-wide.
 */
export function buildScopeConditions(input: {
  orgId: string
  scope?: MemoryScope
  agentId?: string | null
  roomId?: string | null
}): SQL {
  const orgCond = eq(memories.orgId, input.orgId)

  if (input.scope === "org") {
    return and(orgCond, eq(memories.scope, "org"))!
  }

  if (input.scope === "room") {
    if (!input.roomId) {
      return and(orgCond, eq(memories.scope, "room"))!
    }
    return and(orgCond, eq(memories.scope, "room"), eq(memories.roomId, input.roomId))!
  }

  if (input.scope === "agent") {
    if (!input.agentId) {
      return and(orgCond, eq(memories.scope, "agent"))!
    }
    return and(orgCond, eq(memories.scope, "agent"), eq(memories.agentId, input.agentId))!
  }

  // Broad recall across all visible scopes for this agent/room/org
  const scopeBranches = [eq(memories.scope, "org")]

  if (input.roomId) {
    scopeBranches.push(and(eq(memories.scope, "room"), eq(memories.roomId, input.roomId))!)
  }

  if (input.agentId) {
    scopeBranches.push(and(eq(memories.scope, "agent"), eq(memories.agentId, input.agentId))!)
  }

  return and(orgCond, or(...scopeBranches))!
}

/**
 * Validates whether an agent in a given room context has read permission for a memory item.
 */
export function canReadMemory(params: {
  memoryScope: MemoryScope
  memoryAgentId?: string | null
  memoryRoomId?: string | null
  requestingAgentId?: string | null
  requestingRoomId?: string | null
}): boolean {
  if (params.memoryScope === "org") return true
  if (params.memoryScope === "room") {
    return !!params.requestingRoomId && params.memoryRoomId === params.requestingRoomId
  }
  if (params.memoryScope === "agent") {
    return !!params.requestingAgentId && params.memoryAgentId === params.requestingAgentId
  }
  return false
}
