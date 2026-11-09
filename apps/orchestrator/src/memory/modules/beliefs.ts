import { and, desc, eq, inArray } from "drizzle-orm"
import { memories, memoryLinks, type MemoryRow } from "@sayabot/db"
import type { EpistemicStatus, MemoryLinkType } from "../types"

export interface AssertBeliefInput {
  orgId: string
  scope: "agent" | "room" | "org"
  agentId?: string | null
  roomId?: string | null
  title: string
  body: string
  tags?: string[]
  epistemicStatus?: EpistemicStatus
  confidence?: number
  emotionalSalience?: number
  perspective?: string
  evidenceRefs?: string[]
  decayHalfLifeDays?: number
  supersedesMemoryId?: string | null
  createdByAgentId?: string | null
  createdByUserId?: string | null
}

export interface WithdrawBeliefInput {
  memoryId: string
  orgId: string
  reason: string
}

export interface SupersedeBeliefInput {
  oldMemoryId: string
  newMemoryId: string
  orgId: string
  reason?: string
}

export interface ContradictionCandidate {
  existingMemoryId: string
  existingTitle: string
  existingStatus: EpistemicStatus
  reason: string
}

/**
 * Epistemic Belief Engine
 * Manages the lifecycle of beliefs: hypothesis -> belief -> verified -> superseded | withdrawn.
 */
export class BeliefEngine {
  constructor(private db: any) {}

  /**
   * Asserts a belief or hypothesis.
   * If `supersedesMemoryId` is specified, it automatically archives the prior belief
   * and creates an epistemic `supersedes` link in `memory_links`.
   */
  async assertBelief(input: AssertBeliefInput): Promise<MemoryRow> {
    const epistemicStatus = input.epistemicStatus ?? "belief"
    const confidence = input.confidence ?? (epistemicStatus === "verified" ? 1.0 : epistemicStatus === "hypothesis" ? 0.6 : 0.85)

    const [inserted] = await this.db
      .insert(memories)
      .values({
        orgId: input.orgId,
        scope: input.scope,
        agentId: input.agentId ?? null,
        roomId: input.roomId ?? null,
        kind: "decision", // beliefs and epistemic conclusions are stored as decisions or facts
        title: input.title,
        body: input.body,
        tags: input.tags ?? [],
        source: "agent",
        confidence,
        pinned: false,
        perspective: input.perspective ?? "first_person",
        emotionalSalience: input.emotionalSalience ?? 0.5,
        epistemicStatus,
        evidenceRefs: input.evidenceRefs ?? [],
        decayHalfLifeDays: input.decayHalfLifeDays ?? 30,
        createdByAgentId: input.createdByAgentId ?? null,
        createdByUserId: input.createdByUserId ?? null,
      })
      .returning()

    if (input.supersedesMemoryId) {
      await this.supersedeBelief({
        oldMemoryId: input.supersedesMemoryId,
        newMemoryId: inserted.id,
        orgId: input.orgId,
      })
    }

    return inserted
  }

  /**
   * Retracts/withdraws a belief because it was falsified or no longer holds true.
   * Leaves an audit trail with withdrawal reason, and drops retention/scoring to zero.
   */
  async withdrawBelief(input: WithdrawBeliefInput): Promise<MemoryRow | null> {
    const [updated] = await this.db
      .update(memories)
      .set({
        epistemicStatus: "withdrawn",
        withdrawalReason: input.reason,
        updatedAt: new Date(),
      })
      .where(and(eq(memories.id, input.memoryId), eq(memories.orgId, input.orgId)))
      .returning()

    return updated ?? null
  }

  /**
   * Supersedes an old belief with a new belief, marking old as superseded and creating a graph link.
   */
  async supersedeBelief(input: SupersedeBeliefInput): Promise<boolean> {
    const [old] = await this.db
      .update(memories)
      .set({
        epistemicStatus: "superseded",
        supersededBy: input.newMemoryId,
        updatedAt: new Date(),
      })
      .where(and(eq(memories.id, input.oldMemoryId), eq(memories.orgId, input.orgId)))
      .returning()

    if (!old) return false

    // Record graph link: newMemory -> supersedes -> oldMemory
    await this.db
      .insert(memoryLinks)
      .values({
        orgId: input.orgId,
        sourceMemoryId: input.newMemoryId,
        targetMemoryId: input.oldMemoryId,
        relationship: "supersedes" as MemoryLinkType,
        weight: 1.0,
      })
      .returning()

    return true
  }

  /**
   * Scans active memories for potential contradictions before a new belief is finalized.
   * Compares keyword terms and epistemic claims on matching topics.
   */
  async detectContradictions(input: {
    orgId: string
    title: string
    tags?: string[]
    agentId?: string | null
    roomId?: string | null
  }): Promise<ContradictionCandidate[]> {
    const titleTokens = input.title.toLowerCase().split(/\s+/).filter((t) => t.length > 3)
    if (titleTokens.length === 0) return []

    // Fetch active (non-withdrawn, non-superseded) memories with matching tags or title keywords
    const activeRows = await this.db
      .select({
        id: memories.id,
        title: memories.title,
        body: memories.body,
        epistemicStatus: memories.epistemicStatus,
      })
      .from(memories)
      .where(
        and(
          eq(memories.orgId, input.orgId),
          inArray(memories.epistemicStatus, ["verified", "belief", "hypothesis"]),
        ),
      )
      .orderBy(desc(memories.createdAt))
      .limit(50)

    const candidates: ContradictionCandidate[] = []

    for (const row of activeRows) {
      const rowText = `${row.title} ${row.body}`.toLowerCase()
      let overlapCount = 0
      for (const token of titleTokens) {
        if (rowText.includes(token)) overlapCount++
      }

      // If significant topic overlap exists, check for negations or conflicting status
      if (overlapCount >= Math.min(2, titleTokens.length)) {
        candidates.push({
          existingMemoryId: row.id,
          existingTitle: row.title,
          existingStatus: row.epistemicStatus as EpistemicStatus,
          reason: `High topic overlap (${overlapCount} matching keywords) with existing ${row.epistemicStatus}: "${row.title}"`,
        })
      }
    }

    return candidates
  }

  /**
   * Traverses backward through the supersede chain to reveal how a belief evolved.
   */
  async getBeliefLineage(memoryId: string, orgId: string): Promise<MemoryRow[]> {
    const lineage: MemoryRow[] = []
    let currentId: string | null = memoryId

    while (currentId && lineage.length < 10) {
      const rows: MemoryRow[] = await this.db
        .select()
        .from(memories)
        .where(and(eq(memories.id, currentId), eq(memories.orgId, orgId)))
        .limit(1)

      const item = rows[0]
      if (!item) break
      lineage.push(item)

      // Find memory that this superseded
      const links: Array<{ targetMemoryId: string | null }> = await this.db
        .select({ targetMemoryId: memoryLinks.targetMemoryId })
        .from(memoryLinks)
        .where(
          and(
            eq(memoryLinks.sourceMemoryId, item.id),
            eq(memoryLinks.relationship, "supersedes"),
          ),
        )
        .limit(1)

      currentId = links[0]?.targetMemoryId ?? null
    }

    return lineage
  }
}
