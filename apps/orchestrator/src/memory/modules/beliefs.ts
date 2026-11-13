import { and, desc, eq, inArray } from "drizzle-orm"
import { redactSecrets } from "@sayabot/core"
import { memories, memoryLinks, type Db, type MemoryRow } from "@sayabot/db"
import type { EpistemicStatus, MemoryKind, MemoryLinkType } from "../types"
import { queryTerms } from "./retrieval"
import { buildScopeConditions, canReadMemory, type MemoryAccessContext } from "./sources"

export interface AssertBeliefInput {
  orgId: string
  scope: "agent" | "room" | "org"
  agentId?: string | null
  roomId?: string | null
  kind?: MemoryKind
  title: string
  body: string
  tags?: string[]
  source?: "agent" | "consolidation"
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
 *
 * Access control lives in MemoryService: these methods trust that the caller already
 * checked the memory ids it passes belong to what the agent may change.
 */
export class BeliefEngine {
  constructor(private db: Db) {}

  /**
   * Asserts a belief or hypothesis. Title and body are scrubbed of secrets before storage.
   * If `supersedesMemoryId` is specified, it archives the prior belief and records a
   * `supersedes` link in `memory_links`.
   */
  async assertBelief(input: AssertBeliefInput): Promise<MemoryRow> {
    const epistemicStatus = input.epistemicStatus ?? "belief"
    const confidence =
      input.confidence ??
      (epistemicStatus === "verified" ? 1.0 : epistemicStatus === "hypothesis" ? 0.6 : 0.85)

    const [inserted] = await this.db
      .insert(memories)
      .values({
        orgId: input.orgId,
        scope: input.scope,
        agentId: input.agentId ?? null,
        roomId: input.roomId ?? null,
        kind: input.kind ?? "decision",
        title: redactSecrets(input.title.slice(0, 200)).text,
        body: redactSecrets(input.body.slice(0, 4096)).text,
        tags: input.tags ?? [],
        source: input.source ?? "agent",
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
    if (!inserted) throw new Error("Failed to insert belief")

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
        withdrawalReason: redactSecrets(input.reason.slice(0, 500)).text,
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
    if (input.oldMemoryId === input.newMemoryId) return false
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
   * Scans the active memories the caller can see for potential contradictions with a
   * candidate belief, by topic overlap on title keywords.
   */
  async detectContradictions(input: {
    orgId: string
    title: string
    tags?: string[]
    agentId?: string | null
    roomId?: string | null
  }): Promise<ContradictionCandidate[]> {
    const titleTokens = queryTerms(input.title).filter((t) => t.length > 3)
    if (titleTokens.length === 0) return []

    const activeRows = await this.db
      .select({
        id: memories.id,
        title: memories.title,
        body: memories.body,
        tags: memories.tags,
        epistemicStatus: memories.epistemicStatus,
      })
      .from(memories)
      .where(
        and(
          buildScopeConditions({
            orgId: input.orgId,
            agentId: input.agentId,
            roomId: input.roomId,
          }),
          inArray(memories.epistemicStatus, ["verified", "belief", "hypothesis"]),
        ),
      )
      .orderBy(desc(memories.createdAt))
      .limit(100)

    const wantedTags = new Set((input.tags ?? []).map((t) => t.toLowerCase()))
    const candidates: ContradictionCandidate[] = []

    for (const row of activeRows) {
      const rowText = `${row.title} ${row.body}`.toLowerCase()
      let overlapCount = 0
      for (const token of titleTokens) {
        if (rowText.includes(token)) overlapCount++
      }
      const sharedTag = (row.tags ?? []).some((t) => wantedTags.has(t.toLowerCase()))

      if (overlapCount >= Math.min(2, titleTokens.length) || (sharedTag && overlapCount >= 1)) {
        candidates.push({
          existingMemoryId: row.id,
          existingTitle: row.title,
          existingStatus: row.epistemicStatus as EpistemicStatus,
          reason: `High topic overlap (${overlapCount} matching keywords${sharedTag ? ", shared tag" : ""}) with existing ${row.epistemicStatus}: "${row.title}"`,
        })
      }
    }

    return candidates.slice(0, 10)
  }

  /**
   * Traverses backward through the supersede chain to reveal how a belief evolved.
   * Stops at the first memory the caller cannot read.
   */
  async getBeliefLineage(
    memoryId: string,
    orgId: string,
    access: MemoryAccessContext,
  ): Promise<MemoryRow[]> {
    const lineage: MemoryRow[] = []
    const seen = new Set<string>()
    let currentId: string | null = memoryId

    while (currentId && lineage.length < 10 && !seen.has(currentId)) {
      seen.add(currentId)
      const rows: MemoryRow[] = await this.db
        .select()
        .from(memories)
        .where(and(eq(memories.id, currentId), eq(memories.orgId, orgId)))
        .limit(1)

      const item = rows[0]
      if (!item) break
      const readable = canReadMemory({
        memoryScope: item.scope,
        memoryAgentId: item.agentId,
        memoryRoomId: item.roomId,
        requestingAgentId: access.agentId,
        requestingRoomId: access.roomId,
      })
      if (!readable) break
      lineage.push(item)

      // Find memory that this superseded
      const links: Array<{ targetMemoryId: string | null }> = await this.db
        .select({ targetMemoryId: memoryLinks.targetMemoryId })
        .from(memoryLinks)
        .where(
          and(
            eq(memoryLinks.orgId, orgId),
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
