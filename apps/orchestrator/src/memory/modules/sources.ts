import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm"
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

/** Who is asking: the agent and the room its current turn runs in. */
export interface MemoryAccessContext {
  orgId: string
  agentId?: string | null
  roomId?: string | null
}

/**
 * Builds the SQL filter condition for memory queries given the caller's context.
 *
 * Visibility rules (mirrored by `canReadMemory`):
 * - `org`   memories are visible org-wide.
 * - `room`  memories are visible only inside that room (shared by every agent there).
 * - `agent` memories are private to one agent. A row with `room_id` set is bound to that
 *   room too (what the agent learned there), so it never surfaces in another room whose
 *   members may differ; a row with `room_id` null is agent-wide.
 *
 * An explicit scope without the matching id matches nothing rather than every room or
 * every agent in the org.
 */
export function buildScopeConditions(input: {
  orgId: string
  scope?: MemoryScope
  agentId?: string | null
  roomId?: string | null
}): SQL {
  const orgCond = eq(memories.orgId, input.orgId)
  const none = sql`false`

  const roomBranch = (roomId: string): SQL =>
    and(eq(memories.scope, "room"), eq(memories.roomId, roomId)) ?? none

  const agentBranch = (agentId: string, roomId?: string | null): SQL =>
    and(
      eq(memories.scope, "agent"),
      eq(memories.agentId, agentId),
      roomId ? or(isNull(memories.roomId), eq(memories.roomId, roomId)) : isNull(memories.roomId),
    ) ?? none

  if (input.scope === "org") {
    return and(orgCond, eq(memories.scope, "org")) ?? none
  }

  if (input.scope === "room") {
    return input.roomId ? (and(orgCond, roomBranch(input.roomId)) ?? none) : none
  }

  if (input.scope === "agent") {
    return input.agentId ? (and(orgCond, agentBranch(input.agentId, input.roomId)) ?? none) : none
  }

  // Broad recall across all visible scopes for this agent/room/org
  const scopeBranches: SQL[] = [eq(memories.scope, "org")]
  if (input.roomId) scopeBranches.push(roomBranch(input.roomId))
  if (input.agentId) scopeBranches.push(agentBranch(input.agentId, input.roomId))

  return and(orgCond, or(...scopeBranches)) ?? none
}

export interface MemoryAccessParams {
  memoryScope: MemoryScope
  memoryAgentId?: string | null
  memoryRoomId?: string | null
  memoryCreatedByAgentId?: string | null
  requestingAgentId?: string | null
  requestingRoomId?: string | null
}

/**
 * Validates whether an agent in a given room context has read permission for a memory item.
 */
export function canReadMemory(params: MemoryAccessParams): boolean {
  if (params.memoryScope === "org") return true
  if (params.memoryScope === "room") {
    return !!params.requestingRoomId && params.memoryRoomId === params.requestingRoomId
  }
  if (params.memoryScope === "agent") {
    if (!params.requestingAgentId || params.memoryAgentId !== params.requestingAgentId) return false
    return !params.memoryRoomId || params.memoryRoomId === params.requestingRoomId
  }
  return false
}

/**
 * Whether an agent may change (withdraw, supersede, delete) a memory. Private and room
 * memories follow read visibility; org-wide memories are writable only by the agent that
 * created them, so one bot cannot retract the workspace's shared knowledge.
 */
export function canWriteMemory(params: MemoryAccessParams): boolean {
  if (!canReadMemory(params)) return false
  if (params.memoryScope === "org") {
    return !!params.requestingAgentId && params.memoryCreatedByAgentId === params.requestingAgentId
  }
  return true
}
