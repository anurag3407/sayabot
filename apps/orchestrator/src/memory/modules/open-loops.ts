import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { redactSecrets } from "@sayabot/core"
import { openLoops, type Db, type OpenLoopRow } from "@sayabot/db"
import type { OpenLoopStatus } from "../types"

export interface CreateOpenLoopInput {
  orgId: string
  agentId: string
  roomId?: string | null
  description: string
  dueAt?: Date | null
  sourceRef?: string | null
}

export interface UpdateOpenLoopInput {
  id: string
  orgId: string
  /** Loops belong to one agent; only that agent may change them. */
  agentId: string
  status?: OpenLoopStatus
  blockerReason?: string | null
  resolution?: string | null
  dueAt?: Date | null
}

/**
 * Open Loops Manager
 * Tracks cognitive commitments, promises, and blockers across interaction turns.
 */
export class OpenLoopsManager {
  constructor(private db: Db) {}

  /**
   * Registers a new open loop for an agent.
   */
  async createOpenLoop(input: CreateOpenLoopInput): Promise<OpenLoopRow> {
    const [inserted] = await this.db
      .insert(openLoops)
      .values({
        orgId: input.orgId,
        agentId: input.agentId,
        roomId: input.roomId ?? null,
        description: redactSecrets(input.description.slice(0, 2048)).text,
        status: "open",
        dueAt: input.dueAt ?? null,
        sourceRef: input.sourceRef ?? null,
      })
      .returning()

    if (!inserted) throw new Error("Failed to create open loop")
    return inserted
  }

  /**
   * Updates an open loop's state (e.g., mark in_progress, blocked, resolved).
   */
  async updateOpenLoop(input: UpdateOpenLoopInput): Promise<OpenLoopRow | null> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    }

    if (input.status !== undefined) updateData.status = input.status
    if (input.blockerReason !== undefined) {
      updateData.blockerReason = input.blockerReason
        ? redactSecrets(input.blockerReason).text
        : null
    }
    if (input.resolution !== undefined) {
      updateData.resolution = input.resolution ? redactSecrets(input.resolution).text : null
    }
    if (input.dueAt !== undefined) updateData.dueAt = input.dueAt

    const [updated] = await this.db
      .update(openLoops)
      .set(updateData)
      .where(
        and(
          eq(openLoops.id, input.id),
          eq(openLoops.orgId, input.orgId),
          eq(openLoops.agentId, input.agentId),
        ),
      )
      .returning()

    return updated ?? null
  }

  /**
   * Marks an open loop as resolved with explanation.
   */
  async resolveOpenLoop(
    id: string,
    orgId: string,
    agentId: string,
    resolution: string,
  ): Promise<OpenLoopRow | null> {
    return this.updateOpenLoop({
      id,
      orgId,
      agentId,
      status: "resolved",
      resolution,
    })
  }

  /**
   * Fetches active (non-resolved, non-cancelled) open loops for an agent.
   */
  async getActiveLoops(input: {
    orgId: string
    agentId: string
    roomId?: string | null
    /** Only loops not tied to any room (safe to show outside a room). */
    roomless?: boolean
    limit?: number
  }): Promise<OpenLoopRow[]> {
    const conditions = [
      eq(openLoops.orgId, input.orgId),
      eq(openLoops.agentId, input.agentId),
      inArray(openLoops.status, ["open", "in_progress", "blocked"]),
    ]

    if (input.roomless) {
      conditions.push(isNull(openLoops.roomId))
    } else if (input.roomId) {
      conditions.push(eq(openLoops.roomId, input.roomId))
    }

    return this.db
      .select()
      .from(openLoops)
      .where(and(...conditions))
      .orderBy(desc(openLoops.createdAt))
      .limit(input.limit ?? 20)
  }

  /**
   * Formats active open loops into structured markdown for agent runtime prompt or container files.
   */
  formatOpenLoopsMarkdown(loops: OpenLoopRow[]): string {
    if (loops.length === 0) {
      return "# Active Open Loops\n\nNo pending commitments or unresolved loops."
    }

    const lines = [
      "# Active Open Loops",
      "",
      "The following commitments, tasks, and follow-ups are currently pending resolution:",
      "",
    ]

    for (const loop of loops) {
      const dueStr = loop.dueAt ? ` (Due: ${loop.dueAt.toISOString().split("T")[0]})` : ""
      const blockerStr = loop.blockerReason ? `\n  - **Blocker**: ${loop.blockerReason}` : ""
      lines.push(`- **[${loop.status.toUpperCase()}]** ${loop.description}${dueStr}${blockerStr}`)
    }

    return lines.join("\n")
  }
}
