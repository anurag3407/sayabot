import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm"
import { redactSecrets } from "@sayabot/core"
import {
  memories,
  type MemoryLinkRow,
  type MemoryRow,
  type OpenLoopRow,
} from "@sayabot/db"
import { getDb } from "../db"
import type { AgentRow } from "../runner/context"
import { BeliefEngine } from "./modules/beliefs"
import { DreamEngine } from "./modules/dream"
import { MemoryGraphEngine } from "./modules/graph"
import { OpenLoopsManager } from "./modules/open-loops"
import { calculateRetention, compositeMemoryScore } from "./modules/salience"
import { buildScopeConditions } from "./modules/sources"
import type {
  CognitiveRecallInput,
  CognitiveWriteInput,
  EpistemicStatus,
  MemoryKind,
  MemoryLinkInput,
  MemoryLinkView,
  MemoryScope,
  MemorySource,
  OpenLoopStatus,
  ScoredMemoryItem,
} from "./types"

export type WriteMemoryInput = CognitiveWriteInput

export interface HybridRecallInput {
  orgId: string
  query: string
  scope?: MemoryScope
  agentId?: string | null
  roomId?: string | null
  limit?: number
  epistemicFilter?: EpistemicStatus[]
  minSalience?: number
  includeLinks?: boolean
}

export interface RecalledMemoryItem {
  id: string
  scope: string
  kind: string
  title: string
  body: string
  pinned: boolean
  confidence: number
  score: number
  retention?: number
  emotionalSalience?: number
  epistemicStatus?: EpistemicStatus
  perspective?: string
  links?: MemoryLinkView[]
}

/**
 * Cognitive Memory Service
 * Provides human-like memory capabilities for autonomous agents:
 * - Scoped multi-source isolation (agent private, room shared, org global)
 * - Epistemic belief tracking (verified, belief, hypothesis, superseded, withdrawn)
 * - Open loops engine (commitments, promises, tasks, follow-ups)
 * - Relational knowledge graph & concept wikilinks [[slug]]
 * - Spaced retention decay (Ebbinghaus curve) with emotional salience
 * - Autonomous dream consolidation cycle
 */
export class MemoryService {
  private getDb() {
    return getDb()
  }

  get beliefs(): BeliefEngine {
    return new BeliefEngine(this.getDb())
  }

  get openLoops(): OpenLoopsManager {
    return new OpenLoopsManager(this.getDb())
  }

  get graph(): MemoryGraphEngine {
    return new MemoryGraphEngine(this.getDb())
  }

  get dream(): DreamEngine {
    return new DreamEngine(this.getDb())
  }

  /**
   * Writes or updates a memory item with cognitive metadata and concept wikilink graph indexing.
   */
  async write(input: CognitiveWriteInput): Promise<MemoryRow> {
    const db = this.getDb()

    // Pass through secret scrubber/redaction
    const redactedTitle = redactSecrets(input.title.slice(0, 200)).text
    const redactedBody = redactSecrets(input.body.slice(0, 4096)).text

    // Check for existing memory with matching scope and title to deduplicate
    const scopeConditions = [
      eq(memories.orgId, input.orgId),
      eq(memories.scope, input.scope),
      eq(memories.title, redactedTitle),
    ]

    if (input.agentId) scopeConditions.push(eq(memories.agentId, input.agentId))
    if (input.roomId) scopeConditions.push(eq(memories.roomId, input.roomId))

    const [existing] = await db
      .select({ id: memories.id })
      .from(memories)
      .where(and(...scopeConditions))
      .limit(1)

    let savedRow: MemoryRow

    if (existing) {
      const updateData: Record<string, unknown> = {
        body: redactedBody,
        tags: input.tags ?? [],
        source: input.source ?? "agent",
        confidence: input.confidence ?? 1.0,
        pinned: input.pinned ?? false,
        updatedAt: new Date(),
      }

      if (input.emotionalSalience !== undefined) updateData.emotionalSalience = input.emotionalSalience
      if (input.epistemicStatus !== undefined) updateData.epistemicStatus = input.epistemicStatus
      if (input.perspective !== undefined) updateData.perspective = input.perspective
      if (input.evidenceRefs !== undefined) updateData.evidenceRefs = input.evidenceRefs
      if (input.decayHalfLifeDays !== undefined) updateData.decayHalfLifeDays = input.decayHalfLifeDays

      const [updated] = await db
        .update(memories)
        .set(updateData)
        .where(eq(memories.id, existing.id))
        .returning()
      if (!updated) {
        throw new Error("Failed to update existing memory")
      }
      savedRow = updated
    } else {
      const [inserted] = await db
        .insert(memories)
        .values({
          orgId: input.orgId,
          scope: input.scope,
          agentId: input.agentId ?? null,
          roomId: input.roomId ?? null,
          kind: input.kind,
          title: redactedTitle,
          body: redactedBody,
          tags: input.tags ?? [],
          source: input.source ?? "agent",
          sourceRef: input.sourceRef ?? null,
          confidence: input.confidence ?? 1.0,
          pinned: input.pinned ?? false,
          perspective: input.perspective ?? "first_person",
          emotionalSalience: input.emotionalSalience ?? 0.5,
          epistemicStatus: input.epistemicStatus ?? "belief",
          evidenceRefs: input.evidenceRefs ?? [],
          targetAgentId: input.targetAgentId ?? null,
          decayHalfLifeDays: input.decayHalfLifeDays ?? 30,
          createdByUserId: input.createdByUserId ?? null,
          createdByAgentId: input.createdByAgentId ?? null,
        })
        .returning()
      if (!inserted) {
        throw new Error("Failed to insert memory")
      }
      savedRow = inserted
    }

    // Index explicit links and [[slug]] wikilinks into memory_links
    try {
      await this.graph.syncLinks({
        orgId: input.orgId,
        sourceMemoryId: savedRow.id,
        bodyText: savedRow.body,
        explicitLinks: input.links,
      })
    } catch {}

    return savedRow
  }

  /**
   * Cognitive hybrid recall across scopes, ranked by text relevance, retention decay,
   * emotional salience, confidence, and epistemic status.
   */
  async recall(input: HybridRecallInput): Promise<RecalledMemoryItem[]> {
    const db = this.getDb()
    const limit = input.limit ?? 8

    const whereCond = buildScopeConditions({
      orgId: input.orgId,
      scope: input.scope,
      agentId: input.agentId,
      roomId: input.roomId,
    })

    const rows = await db
      .select({
        id: memories.id,
        scope: memories.scope,
        kind: memories.kind,
        title: memories.title,
        body: memories.body,
        pinned: memories.pinned,
        confidence: memories.confidence,
        emotionalSalience: memories.emotionalSalience,
        epistemicStatus: memories.epistemicStatus,
        perspective: memories.perspective,
        decayHalfLifeDays: memories.decayHalfLifeDays,
        lastUsedAt: memories.lastUsedAt,
        createdAt: memories.createdAt,
        useCount: memories.useCount,
      })
      .from(memories)
      .where(whereCond)
      .orderBy(desc(memories.pinned), desc(memories.lastUsedAt), desc(memories.createdAt))
      .limit(limit * 3)

    if (rows.length === 0) return []

    const queryTerms = input.query.toLowerCase().split(/\s+/).filter(Boolean)
    const now = new Date()

    const scoredItems: RecalledMemoryItem[] = []

    for (const r of rows) {
      // Filter out withdrawn memories unless explicitly specified
      if (
        r.epistemicStatus === "withdrawn" &&
        (!input.epistemicFilter || !input.epistemicFilter.includes("withdrawn"))
      ) {
        continue
      }

      // Filter by epistemic statuses if filter provided
      if (input.epistemicFilter && !input.epistemicFilter.includes(r.epistemicStatus as EpistemicStatus)) {
        continue
      }

      // Calculate Ebbinghaus retention
      const retention = calculateRetention({
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        useCount: r.useCount,
        decayHalfLifeDays: r.decayHalfLifeDays,
        now,
      })

      // Calculate keyword overlap
      const text = `${r.title} ${r.body}`.toLowerCase()
      let matches = 0
      for (const term of queryTerms) {
        if (text.includes(term)) matches++
      }
      const matchRatio = queryTerms.length > 0 ? matches / queryTerms.length : 0.5

      const score = compositeMemoryScore({
        keywordMatchRatio: matchRatio,
        pinned: r.pinned,
        confidence: r.confidence,
        emotionalSalience: r.emotionalSalience,
        retention,
        epistemicStatus: r.epistemicStatus as EpistemicStatus,
      })

      if (input.minSalience && r.emotionalSalience < input.minSalience) {
        continue
      }

      scoredItems.push({
        id: r.id,
        scope: r.scope,
        kind: r.kind,
        title: r.title,
        body: r.body,
        pinned: r.pinned,
        confidence: r.confidence,
        emotionalSalience: r.emotionalSalience,
        epistemicStatus: r.epistemicStatus as EpistemicStatus,
        perspective: r.perspective,
        retention,
        score,
      })
    }

    scoredItems.sort((a, b) => b.score - a.score)
    const top = scoredItems.slice(0, limit)

    // Optionally attach relational graph links
    if (input.includeLinks && top.length > 0) {
      try {
        const linkMap = await this.graph.getLinksForMemories(
          input.orgId,
          top.map((t) => t.id),
        )
        for (const item of top) {
          item.links = linkMap[item.id] ?? []
        }
      } catch {}
    }

    // Asynchronously update last_used_at and use_count for recalled items
    if (top.length > 0) {
      const ids = top.map((t) => t.id)
      try {
        await db
          .update(memories)
          .set({
            lastUsedAt: now,
            useCount: sql`use_count + 1`,
          })
          .where(inArray(memories.id, ids))
      } catch {}
    }

    return top
  }

  /**
   * Loads up to 20 pinned memories for the given scopes to be placed in System 2 cached prefix.
   */
  async getPinnedDigest(args: {
    orgId: string
    agentId?: string | null
    roomId?: string | null
  }): Promise<Array<{ id: string; title: string; body: string }>> {
    const db = this.getDb()
    const scopeCond = buildScopeConditions({
      orgId: args.orgId,
      agentId: args.agentId,
      roomId: args.roomId,
    })

    const rows = await db
      .select({
        id: memories.id,
        title: memories.title,
        body: memories.body,
      })
      .from(memories)
      .where(and(scopeCond, eq(memories.pinned, true)))
      .orderBy(memories.id)
      .limit(20)

    return rows
  }

  // ── Open Loops Methods ───────────────────────────────────────────────────

  async createOpenLoop(input: {
    orgId: string
    agentId: string
    roomId?: string | null
    description: string
    dueAt?: Date | null
    sourceRef?: string | null
  }): Promise<OpenLoopRow> {
    return this.openLoops.createOpenLoop(input)
  }

  async updateOpenLoop(input: {
    id: string
    orgId: string
    status?: OpenLoopStatus
    blockerReason?: string | null
    resolution?: string | null
    dueAt?: Date | null
  }): Promise<OpenLoopRow | null> {
    return this.openLoops.updateOpenLoop(input)
  }

  async resolveOpenLoop(id: string, orgId: string, resolution: string): Promise<OpenLoopRow | null> {
    return this.openLoops.resolveOpenLoop(id, orgId, resolution)
  }

  async getActiveLoops(args: {
    orgId: string
    agentId: string
    roomId?: string | null
    limit?: number
  }): Promise<OpenLoopRow[]> {
    return this.openLoops.getActiveLoops(args)
  }

  // ── Belief Engine Methods ─────────────────────────────────────────────────

  async assertBelief(args: {
    orgId: string
    scope: MemoryScope
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
    supersedesMemoryId?: string | null
    createdByAgentId?: string | null
  }): Promise<MemoryRow> {
    return this.beliefs.assertBelief(args)
  }

  async withdrawBelief(memoryId: string, orgId: string, reason: string): Promise<MemoryRow | null> {
    return this.beliefs.withdrawBelief({ memoryId, orgId, reason })
  }

  async supersedeBelief(oldMemoryId: string, newMemoryId: string, orgId: string): Promise<boolean> {
    return this.beliefs.supersedeBelief({ oldMemoryId, newMemoryId, orgId })
  }

  async detectContradictions(args: {
    orgId: string
    title: string
    tags?: string[]
    agentId?: string | null
    roomId?: string | null
  }) {
    return this.beliefs.detectContradictions(args)
  }

  async getBeliefLineage(memoryId: string, orgId: string): Promise<MemoryRow[]> {
    return this.beliefs.getBeliefLineage(memoryId, orgId)
  }

  // ── Knowledge Graph Methods ───────────────────────────────────────────────

  async graphWalk(args: {
    orgId: string
    startMemoryId: string
    maxDepth?: number
    limit?: number
  }) {
    return this.graph.graphWalk(args)
  }

  // ── Dream & Consolidation Methods ────────────────────────────────────────

  /**
   * Automatically extracts durable beliefs and open commitments from a completed run transcript.
   */
  async extractMemoriesFromTranscript(args: {
    orgId: string
    roomId?: string | null
    agentId?: string | null
    transcriptText: string
    agent: AgentRow
  }): Promise<number> {
    if (!args.transcriptText || args.transcriptText.length < 50) return 0
    try {
      const insights = await this.dream.extractCognitiveInsights({
        orgId: args.orgId,
        transcriptText: args.transcriptText,
        agent: args.agent,
        roomId: args.roomId,
      })

      if (insights.beliefs.length === 0 && insights.openLoops.length === 0) {
        return 0
      }

      const result = await this.dream.applyInsights({
        orgId: args.orgId,
        agentId: args.agentId ?? args.agent.id,
        roomId: args.roomId,
        insights,
      })

      return result.beliefsSaved + result.loopsSaved
    } catch {
      return 0
    }
  }

  /**
   * Writes a daily episode memory for an agent in a room ("what I did today").
   */
  async writeDailyEpisode(args: {
    orgId: string
    agentId: string
    roomId: string
    summary: string
  }) {
    const today = new Date().toISOString().split("T")[0]
    return this.write({
      orgId: args.orgId,
      scope: "room",
      agentId: args.agentId,
      roomId: args.roomId,
      kind: "episode",
      title: `Daily Episode: ${today}`,
      body: args.summary,
      tags: ["episode", today!],
      source: "consolidation",
      pinned: false,
      decayHalfLifeDays: 14,
    })
  }

  /**
   * Runs the autonomous dream consolidation cycle across decaying episodes,
   * overdue open loops, and expired withdrawn records.
   */
  async consolidate(orgId: string): Promise<{ expiredEpisodes: number; loopsUpdated?: number }> {
    const result = await this.dream.dreamConsolidate(orgId)
    return {
      expiredEpisodes: result.prunedEpisodes,
      loopsUpdated: result.staleLoopsFlagged,
    }
  }

  /**
   * Generates markdown files for mirroring into /home/bot/.saaya/memory/ (MEMORY.md, OPEN_LOOPS.md, topics).
   */
  async generateMemoryMirror(args: {
    orgId: string
    agentId?: string | null
    roomId?: string | null
  }): Promise<{ memoryMd: string; openLoopsMd: string; topics: Record<string, string> }> {
    const db = this.getDb()
    const scopeCond = buildScopeConditions({
      orgId: args.orgId,
      agentId: args.agentId,
      roomId: args.roomId,
    })

    const rows = await db
      .select()
      .from(memories)
      .where(scopeCond)
      .orderBy(desc(memories.pinned), desc(memories.lastUsedAt))

    const pinned = rows.filter((r) => r.pinned)
    const memoryMdLines = [
      "# Team & Agent Memory",
      "",
      "This file is automatically generated by Sayabot Cognitive Memory Layer. It reflects verified beliefs, active mental models, and workspace decisions.",
      "",
      "## Pinned Core Knowledge",
      "",
      ...pinned.map((m) => `- **${m.title}** [${m.epistemicStatus}]: ${m.body}`),
      "",
      "## Working Beliefs & Decisions",
      "",
      ...rows
        .filter((r) => !r.pinned && r.epistemicStatus !== "withdrawn")
        .slice(0, 30)
        .map(
          (m) =>
            `- **${m.title}** (${m.kind}, status: ${m.epistemicStatus}): ${m.body}`,
        ),
    ]

    const topics: Record<string, string> = {}
    for (const row of rows) {
      for (const tag of row.tags ?? []) {
        if (!topics[tag]) {
          topics[tag] = `# Topic: ${tag}\n\n`
        }
        topics[tag] += `- **${row.title}**: ${row.body}\n`
      }
    }

    let openLoopsMd = "# Active Open Loops\n\nNo pending commitments."
    if (args.agentId) {
      try {
        const activeLoops = await this.getActiveLoops({
          orgId: args.orgId,
          agentId: args.agentId,
          roomId: args.roomId,
        })
        openLoopsMd = this.openLoops.formatOpenLoopsMarkdown(activeLoops)
      } catch {}
    }

    return {
      memoryMd: memoryMdLines.join("\n"),
      openLoopsMd,
      topics,
    }
  }

  /**
   * Deletes a memory item.
   */
  async forget(id: string, orgId: string): Promise<boolean> {
    const db = this.getDb()
    const result = await db
      .delete(memories)
      .where(and(eq(memories.id, id), eq(memories.orgId, orgId)))
      .returning()
    return result.length > 0
  }
}

let serviceInstance: MemoryService | null = null

export function getMemoryService(): MemoryService {
  if (!serviceInstance) {
    serviceInstance = new MemoryService()
  }
  return serviceInstance
}
