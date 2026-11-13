import { and, desc, eq, gt, gte, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm"
import { factsVisibleInRoom, redactSecrets } from "@sayabot/core"
import {
  memories,
  ownerFacts,
  vectorProviders,
  type Db,
  type MemoryRow,
  type OpenLoopRow,
  type VectorProviderRow,
} from "@sayabot/db"
import { getDb } from "../db"
import type { AgentRow } from "../runner/context"
import { runInBackground } from "./modules/background"
import { BeliefEngine } from "./modules/beliefs"
import { DreamEngine, type DreamInsight } from "./modules/dream"
import {
  embeddingText,
  getOrgEmbedder,
  hasPgvector,
  markPgvectorUnavailable,
  toVectorLiteral,
} from "./modules/embeddings"
import { MemoryGraphEngine } from "./modules/graph"
import { OpenLoopsManager } from "./modules/open-loops"
import {
  blendRelevance,
  buildOrTsQuery,
  cosineSimilarity,
  ftsRelevance,
  isNearDuplicate,
  jaccard,
  keywordRelevance,
  queryTerms,
  vectorRelevance,
} from "./modules/retrieval"
import { calculateRetention, compositeMemoryScore } from "./modules/salience"
import {
  buildScopeConditions,
  canReadMemory,
  canWriteMemory,
  type MemoryAccessContext,
} from "./modules/sources"
import type {
  CognitiveWriteInput,
  EpistemicStatus,
  MemoryLinkView,
  MemoryScope,
  OpenLoopStatus,
} from "./types"

export type WriteMemoryInput = CognitiveWriteInput
export type { MemoryAccessContext } from "./modules/sources"

/** Statuses recall returns unless the caller asks for others. */
const ACTIVE_STATUSES: EpistemicStatus[] = ["verified", "belief", "hypothesis"]

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
  /** Drop candidates whose query relevance is below this (0..1). Default 0. */
  minRelevance?: number
  /** Skip pinned memories (they are already in the cached system prefix). */
  excludePinned?: boolean
  /**
   * Count this recall as a use (bumps last_used_at / use_count, slowing decay). Only an
   * explicit recall by the agent should; automatic pre-turn recall must not, or the same
   * memories reinforce themselves every turn.
   */
  reinforce?: boolean
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
  relevance: number
  retention?: number
  emotionalSalience?: number
  epistemicStatus?: EpistemicStatus
  perspective?: string
  links?: MemoryLinkView[]
}

export interface OwnerFactView {
  key: string
  label: string
  value: string
  scope: "this_room" | "workspace"
}

const RECALL_COLUMNS = {
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
}

interface Candidate {
  id: string
  scope: MemoryScope
  kind: string
  title: string
  body: string
  pinned: boolean
  confidence: number
  emotionalSalience: number
  epistemicStatus: string
  perspective: string
  decayHalfLifeDays: number
  lastUsedAt: Date | null
  createdAt: Date
  useCount: number
  rank?: number
  similarity?: number
}

function accessParams(
  row: Pick<MemoryRow, "scope" | "agentId" | "roomId" | "createdByAgentId">,
  access: MemoryAccessContext,
) {
  return {
    memoryScope: row.scope,
    memoryAgentId: row.agentId,
    memoryRoomId: row.roomId,
    memoryCreatedByAgentId: row.createdByAgentId,
    requestingAgentId: access.agentId,
    requestingRoomId: access.roomId,
  }
}

function nullableEq<T extends typeof memories.agentId | typeof memories.roomId>(
  column: T,
  value: string | null | undefined,
): SQL {
  return value ? eq(column, value) : isNull(column)
}

/**
 * Cognitive Memory Service
 * Provides human-like memory capabilities for autonomous agents:
 * - Scoped isolation: agent-private (agent-wide or bound to one room), room-shared, org-wide
 * - Epistemic belief tracking (verified, belief, hypothesis, superseded, withdrawn)
 * - Open loops engine (commitments, promises, tasks, follow-ups)
 * - Relational knowledge graph & concept wikilinks [[slug]]
 * - Hybrid recall: Postgres full-text + optional embeddings + keyword overlap, weighted by
 *   retention decay (Ebbinghaus), emotional salience, confidence and epistemic status
 * - Post-turn extraction with deduplication, and a scheduled consolidation cycle
 *
 * Every operation that takes a memory or loop id checks it against the calling agent's
 * access context; ids the agent cannot see behave as "not found".
 */
export class MemoryService {
  private getDb(): Db {
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

  // ── Access control ────────────────────────────────────────────────────────

  /** Loads a memory only if the caller may read (or, for "write", change) it. */
  async loadAccessible(
    id: string,
    access: MemoryAccessContext,
    mode: "read" | "write",
  ): Promise<MemoryRow | null> {
    const [row] = await this.getDb()
      .select()
      .from(memories)
      .where(and(eq(memories.id, id), eq(memories.orgId, access.orgId)))
      .limit(1)
    if (!row) return null
    const params = accessParams(row, access)
    return (mode === "write" ? canWriteMemory(params) : canReadMemory(params)) ? row : null
  }

  // ── Write path ────────────────────────────────────────────────────────────

  /**
   * Writes or updates a memory item. Title and body are scrubbed of secrets. A memory with
   * the same title (case-insensitive) in the same scope bucket is updated in place; only
   * the fields the caller provides change, so re-remembering never silently unpins or
   * clears tags.
   */
  async write(input: CognitiveWriteInput): Promise<MemoryRow> {
    const db = this.getDb()
    const title = redactSecrets(input.title.slice(0, 200)).text
    const body = redactSecrets(input.body.slice(0, 4096)).text
    const agentId = input.scope === "agent" ? (input.agentId ?? null) : null
    const roomId = input.scope === "org" ? null : (input.roomId ?? null)
    if (input.scope === "agent" && !agentId)
      throw new Error("agent-scoped memory requires an agentId")
    if (input.scope === "room" && !roomId) throw new Error("room-scoped memory requires a roomId")

    const bucket: SQL[] = [
      eq(memories.orgId, input.orgId),
      eq(memories.scope, input.scope),
      sql`lower(${memories.title}) = lower(${title})`,
    ]
    if (input.scope === "agent") bucket.push(nullableEq(memories.agentId, agentId))
    if (input.scope !== "org") bucket.push(nullableEq(memories.roomId, roomId))

    const [existing] = await db
      .select({
        id: memories.id,
        scope: memories.scope,
        agentId: memories.agentId,
        roomId: memories.roomId,
        body: memories.body,
        createdByAgentId: memories.createdByAgentId,
        source: memories.source,
        epistemicStatus: memories.epistemicStatus,
      })
      .from(memories)
      .where(and(...bucket))
      .limit(1)

    // An org-wide memory belongs to whoever wrote it (a person, or another agent): a
    // different agent adds its own entry instead of overwriting it.
    const canUpdate =
      !!existing &&
      (input.scope !== "org" ||
        (existing.source !== "human" &&
          !!input.createdByAgentId &&
          existing.createdByAgentId === input.createdByAgentId))

    let savedRow: MemoryRow
    if (existing && canUpdate) {
      const updateData: Partial<typeof memories.$inferInsert> = {
        body,
        updatedAt: new Date(),
      }
      if (input.tags !== undefined) updateData.tags = input.tags
      if (input.source !== undefined) updateData.source = input.source
      if (input.kind !== undefined) updateData.kind = input.kind
      if (input.confidence !== undefined) updateData.confidence = input.confidence
      if (input.pinned !== undefined) updateData.pinned = input.pinned
      if (input.emotionalSalience !== undefined)
        updateData.emotionalSalience = input.emotionalSalience
      if (input.perspective !== undefined) updateData.perspective = input.perspective
      if (input.evidenceRefs !== undefined) updateData.evidenceRefs = input.evidenceRefs
      if (input.decayHalfLifeDays !== undefined)
        updateData.decayHalfLifeDays = input.decayHalfLifeDays
      if (input.epistemicStatus !== undefined) updateData.epistemicStatus = input.epistemicStatus
      // Re-asserting a withdrawn or superseded memory brings it back.
      if (existing.epistemicStatus === "withdrawn" || existing.epistemicStatus === "superseded") {
        updateData.epistemicStatus = input.epistemicStatus ?? "belief"
        updateData.withdrawalReason = null
        updateData.supersededBy = null
      }
      if (existing.body !== body) {
        updateData.embedding = null
        updateData.embeddingModel = null
        updateData.embeddedAt = null
      }

      const [updated] = await db
        .update(memories)
        .set(updateData)
        .where(eq(memories.id, existing.id))
        .returning()
      if (!updated) throw new Error("Failed to update existing memory")
      savedRow = updated
    } else {
      const [inserted] = await db
        .insert(memories)
        .values({
          orgId: input.orgId,
          scope: input.scope,
          agentId,
          roomId,
          kind: input.kind,
          title,
          body,
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
      if (!inserted) throw new Error("Failed to insert memory")
      savedRow = inserted
    }

    try {
      await this.graph.syncLinks({
        orgId: input.orgId,
        sourceMemoryId: savedRow.id,
        bodyText: savedRow.body,
        explicitLinks: input.links,
      })
    } catch {}

    if (!savedRow.embedding) this.scheduleEmbedding(input.orgId, [savedRow.id])
    return savedRow
  }

  // ── Recall ────────────────────────────────────────────────────────────────

  /**
   * Hybrid recall across the scopes the caller can see.
   *
   * Candidates come from three sources, merged by id:
   *  1. Postgres full-text search on the generated `tsv` column (OR of query terms, ts_rank)
   *  2. nearest neighbours by embedding, when the org has an embedding provider (pgvector
   *     in SQL when installed, otherwise cosine over the other candidates in-process)
   *  3. the most recently updated memories, so non-English text and fresh notes still match
   *     by keyword
   * Each candidate gets a blended relevance, then the composite cognitive score.
   */
  async recall(input: HybridRecallInput): Promise<RecalledMemoryItem[]> {
    const db = this.getDb()
    const limit = input.limit ?? 8
    const access: MemoryAccessContext = {
      orgId: input.orgId,
      agentId: input.agentId,
      roomId: input.roomId,
    }
    const now = new Date()

    const filters: SQL[] = [
      buildScopeConditions({
        orgId: input.orgId,
        scope: input.scope,
        agentId: input.agentId,
        roomId: input.roomId,
      }),
      inArray(
        memories.epistemicStatus,
        input.epistemicFilter?.length ? input.epistemicFilter : ACTIVE_STATUSES,
      ),
      or(isNull(memories.expiresAt), gt(memories.expiresAt, now)) ?? sql`true`,
    ]
    if (input.excludePinned) filters.push(eq(memories.pinned, false))
    if (input.minSalience) filters.push(gte(memories.emotionalSalience, input.minSalience))
    const base = and(...filters) ?? sql`false`

    const terms = queryTerms(input.query)
    const tsQuerySource = buildOrTsQuery(terms)
    const candidateLimit = Math.max(30, limit * 4)
    const candidates = new Map<string, Candidate>()
    const merge = (row: Candidate) => {
      const prev = candidates.get(row.id)
      candidates.set(row.id, {
        ...(prev ?? row),
        rank: row.rank ?? prev?.rank,
        similarity: row.similarity ?? prev?.similarity,
      })
    }

    // 1. Full-text candidates
    if (tsQuerySource) {
      try {
        const tsQuery = sql`to_tsquery('english', ${tsQuerySource})`
        const rank = sql<number>`ts_rank(tsv, ${tsQuery}, 32)`
        const rows = await db
          .select({ ...RECALL_COLUMNS, rank })
          .from(memories)
          .where(and(base, sql`tsv @@ ${tsQuery}`))
          .orderBy(desc(rank))
          .limit(candidateLimit)
        for (const r of rows) merge({ ...r, rank: Number(r.rank) })
      } catch (error) {
        console.warn("[memory] full-text recall failed:", redactSecrets(String(error)).text)
      }
    }

    // 2. Vector candidates
    const embedder = input.query.trim() ? await getOrgEmbedder(db, input.orgId) : null
    let queryVector: number[] | null = null
    if (embedder) {
      try {
        queryVector = (await embedder.embed([input.query.slice(0, 2000)], "query"))[0] ?? null
      } catch (error) {
        console.warn("[memory] query embedding failed:", redactSecrets(String(error)).text)
      }
    }
    let cosineInProcess = false
    if (embedder && queryVector) {
      if (await hasPgvector(db)) {
        try {
          const literal = toVectorLiteral(queryVector)
          const distance = sql`(${memories.embedding}::vector <=> ${literal}::vector)`
          const rows = await db
            .select({ ...RECALL_COLUMNS, similarity: sql<number>`1 - ${distance}` })
            .from(memories)
            .where(
              and(
                base,
                eq(memories.embeddingModel, embedder.modelKey),
                sql`array_length(${memories.embedding}, 1) = ${queryVector.length}`,
              ),
            )
            .orderBy(distance)
            .limit(candidateLimit)
          for (const r of rows) merge({ ...r, similarity: Number(r.similarity) })
        } catch (error) {
          console.warn(
            "[memory] pgvector recall failed, using in-process cosine:",
            redactSecrets(String(error)).text,
          )
          markPgvectorUnavailable()
          cosineInProcess = true
        }
      } else {
        cosineInProcess = true
      }
    }

    // 3. Recent candidates (bigger pool when cosine runs in-process)
    const recentLimit = cosineInProcess ? 100 : tsQuerySource ? 15 : candidateLimit
    const recent = await db
      .select(RECALL_COLUMNS)
      .from(memories)
      .where(base)
      .orderBy(desc(memories.updatedAt))
      .limit(recentLimit)
    for (const r of recent) merge(r)

    if (candidates.size === 0) return []

    if (cosineInProcess && embedder && queryVector) {
      const needing = [...candidates.values()]
        .filter((c) => c.similarity === undefined)
        .map((c) => c.id)
      if (needing.length > 0) {
        try {
          const vectors = await db
            .select({ id: memories.id, embedding: memories.embedding })
            .from(memories)
            .where(
              and(inArray(memories.id, needing), eq(memories.embeddingModel, embedder.modelKey)),
            )
          for (const v of vectors) {
            const c = candidates.get(v.id)
            if (c && v.embedding) c.similarity = cosineSimilarity(queryVector, v.embedding)
          }
        } catch {}
      }
    }

    const maxRank = Math.max(0, ...[...candidates.values()].map((c) => c.rank ?? 0))
    const hasQuery = terms.length > 0 || !!queryVector
    const minRelevance = input.minRelevance ?? 0
    const scored: RecalledMemoryItem[] = []

    for (const c of candidates.values()) {
      const relevance = hasQuery
        ? blendRelevance({
            fts: ftsRelevance(c.rank ?? 0, maxRank),
            vector:
              c.similarity !== undefined && embedder
                ? vectorRelevance(c.similarity, embedder.simFloor)
                : undefined,
            keyword: keywordRelevance({ title: c.title, body: c.body, terms }),
          })
        : 0.5
      if (hasQuery && relevance < minRelevance) continue

      const retention = calculateRetention({
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
        useCount: c.useCount,
        decayHalfLifeDays: c.decayHalfLifeDays,
        now,
      })
      const score = compositeMemoryScore({
        relevance,
        pinned: c.pinned,
        confidence: c.confidence,
        emotionalSalience: c.emotionalSalience,
        retention,
        epistemicStatus: c.epistemicStatus as EpistemicStatus,
      })

      scored.push({
        id: c.id,
        scope: c.scope,
        kind: c.kind,
        title: c.title,
        body: c.body,
        pinned: c.pinned,
        confidence: c.confidence,
        emotionalSalience: c.emotionalSalience,
        epistemicStatus: c.epistemicStatus as EpistemicStatus,
        perspective: c.perspective,
        retention,
        relevance: Number(relevance.toFixed(4)),
        score,
      })
    }

    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, limit)

    if (input.includeLinks && top.length > 0) {
      try {
        const linkMap = await this.graph.getLinksForMemories(
          input.orgId,
          top.map((t) => t.id),
          access,
        )
        for (const item of top) item.links = linkMap[item.id] ?? []
      } catch {}
    }

    if (input.reinforce && top.length > 0) {
      await this.reinforce(
        input.orgId,
        top.map((t) => t.id),
      )
    }

    return top
  }

  /** Counts memories as used: refreshes last_used_at and bumps use_count. */
  async reinforce(orgId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    try {
      await this.getDb()
        .update(memories)
        .set({ lastUsedAt: new Date(), useCount: sql`${memories.useCount} + 1` })
        .where(and(eq(memories.orgId, orgId), inArray(memories.id, ids)))
    } catch {}
  }

  /**
   * Loads up to 20 pinned memories for the given scopes to be placed in System 2 cached prefix.
   */
  async getPinnedDigest(args: {
    orgId: string
    agentId?: string | null
    roomId?: string | null
  }): Promise<Array<{ id: string; title: string; body: string }>> {
    return this.getDb()
      .select({ id: memories.id, title: memories.title, body: memories.body })
      .from(memories)
      .where(
        and(
          buildScopeConditions({ orgId: args.orgId, agentId: args.agentId, roomId: args.roomId }),
          eq(memories.pinned, true),
          inArray(memories.epistemicStatus, ACTIVE_STATUSES),
        ),
      )
      .orderBy(memories.id)
      .limit(20)
  }

  /**
   * Owner facts (what people already answered, see collab/facts) visible in a room,
   * ranked by overlap with the query. With an empty query, returns the first `limit`.
   */
  async relevantOwnerFacts(args: {
    orgId: string
    roomId: string
    query: string
    limit?: number
    /** Return every visible fact (ignoring query and limit) when there are at most this many. */
    showAllUpTo?: number
  }): Promise<{ facts: OwnerFactView[]; total: number }> {
    const rows = await this.getDb()
      .select({
        key: ownerFacts.key,
        label: ownerFacts.label,
        value: ownerFacts.value,
        roomId: ownerFacts.roomId,
        source: ownerFacts.source,
        updatedAt: ownerFacts.updatedAt,
      })
      .from(ownerFacts)
      .where(
        and(
          eq(ownerFacts.orgId, args.orgId),
          or(isNull(ownerFacts.roomId), eq(ownerFacts.roomId, args.roomId)),
        ),
      )
      .limit(500)
    const visible = factsVisibleInRoom(
      rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
      args.roomId,
    )
    const showAll = args.showAllUpTo !== undefined && visible.length <= args.showAllUpTo
    const limit = showAll ? visible.length : (args.limit ?? 8)
    const terms = queryTerms(args.query)
    const ranked =
      showAll || terms.length === 0
        ? visible
        : visible
            .map((f) => ({
              f,
              r: keywordRelevance({
                title: `${f.label} ${f.key.replace(/_/g, " ")}`,
                body: f.value,
                terms,
              }),
            }))
            .filter((x) => x.r > 0)
            .sort((a, b) => b.r - a.r)
            .map((x) => x.f)
    return {
      total: visible.length,
      facts: ranked.slice(0, limit).map((f) => ({
        key: f.key,
        label: f.label,
        value: f.value,
        scope: f.roomId ? "this_room" : "workspace",
      })),
    }
  }

  /**
   * Retrieves the currently active vector database and embedding model for the organization.
   */
  async getActiveVectorConfig(orgId: string): Promise<{
    vectorDb: VectorProviderRow | null
    embedding: VectorProviderRow | null
  }> {
    const activeProviders = await this.getDb()
      .select()
      .from(vectorProviders)
      .where(and(eq(vectorProviders.orgId, orgId), eq(vectorProviders.isActive, true)))

    const vectorDb = activeProviders.find((p) => p.kind === "vector_db") ?? null
    const embedding = activeProviders.find((p) => p.kind === "embedding") ?? null
    return { vectorDb, embedding }
  }

  // ── Embeddings ────────────────────────────────────────────────────────────

  scheduleEmbedding(orgId: string, ids: string[]): void {
    if (ids.length === 0) return
    runInBackground("memory.embed", () => this.embedMemories(orgId, { ids }))
  }

  /**
   * Embeds the given memories, or (without ids) up to `limit` memories that have no
   * embedding for the org's current model. Returns how many rows were embedded.
   */
  async embedMemories(
    orgId: string,
    opts: { ids?: string[]; limit?: number } = {},
  ): Promise<number> {
    const db = this.getDb()
    const embedder = await getOrgEmbedder(db, orgId)
    if (!embedder) return 0

    const where = opts.ids
      ? and(eq(memories.orgId, orgId), inArray(memories.id, opts.ids))
      : and(
          eq(memories.orgId, orgId),
          ne(memories.epistemicStatus, "withdrawn"),
          or(isNull(memories.embeddingModel), ne(memories.embeddingModel, embedder.modelKey)),
        )
    const rows = await db
      .select({ id: memories.id, title: memories.title, body: memories.body })
      .from(memories)
      .where(where)
      .limit(opts.ids ? opts.ids.length : (opts.limit ?? 100))
    if (rows.length === 0) return 0

    const vectors = await embedder.embed(
      rows.map((r) => embeddingText(r.title, r.body)),
      "document",
    )
    const embeddedAt = new Date()
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const vector = vectors[i]
      if (!row || !vector) continue
      await db
        .update(memories)
        .set({ embedding: vector, embeddingModel: embedder.modelKey, embeddedAt })
        .where(eq(memories.id, row.id))
    }
    return rows.length
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
    agentId: string
    status?: OpenLoopStatus
    blockerReason?: string | null
    resolution?: string | null
    dueAt?: Date | null
  }): Promise<OpenLoopRow | null> {
    return this.openLoops.updateOpenLoop(input)
  }

  async resolveOpenLoop(
    id: string,
    orgId: string,
    agentId: string,
    resolution: string,
  ): Promise<OpenLoopRow | null> {
    return this.openLoops.resolveOpenLoop(id, orgId, agentId, resolution)
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
    const row = await this.beliefs.assertBelief(args)
    this.scheduleEmbedding(args.orgId, [row.id])
    return row
  }

  async withdrawBelief(
    memoryId: string,
    access: MemoryAccessContext,
    reason: string,
  ): Promise<MemoryRow | null> {
    const row = await this.loadAccessible(memoryId, access, "write")
    if (!row) return null
    return this.beliefs.withdrawBelief({ memoryId, orgId: access.orgId, reason })
  }

  /** The caller must be able to change the old belief and read the new one. */
  async supersedeBelief(
    oldMemoryId: string,
    newMemoryId: string,
    access: MemoryAccessContext,
  ): Promise<boolean> {
    const [oldRow, newRow] = await Promise.all([
      this.loadAccessible(oldMemoryId, access, "write"),
      this.loadAccessible(newMemoryId, access, "read"),
    ])
    if (!oldRow || !newRow) return false
    return this.beliefs.supersedeBelief({ oldMemoryId, newMemoryId, orgId: access.orgId })
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

  async getBeliefLineage(memoryId: string, access: MemoryAccessContext): Promise<MemoryRow[]> {
    return this.beliefs.getBeliefLineage(memoryId, access.orgId, access)
  }

  // ── Knowledge Graph Methods ───────────────────────────────────────────────

  async graphWalk(args: {
    startMemoryId: string
    access: MemoryAccessContext
    maxDepth?: number
    limit?: number
  }) {
    return this.graph.graphWalk({ ...args, orgId: args.access.orgId })
  }

  // ── Dream & Consolidation Methods ────────────────────────────────────────

  /**
   * Extracts durable beliefs, new commitments and resolved commitments from a finished turn
   * and merges them into memory. Runs off the turn's critical path (see engine/run.ts).
   * `transcriptText` should already be redacted; it is redacted again here because it is
   * sent to a model provider.
   */
  async extractMemoriesFromTranscript(args: {
    orgId: string
    roomId?: string | null
    agentId?: string | null
    transcriptText: string
    agent: AgentRow
  }): Promise<number> {
    const transcriptText = redactSecrets(args.transcriptText).text
    if (transcriptText.length < 50) return 0
    const agentId = args.agentId ?? args.agent.id
    try {
      const activeLoops = await this.getActiveLoops({
        orgId: args.orgId,
        agentId,
        roomId: args.roomId,
        limit: 10,
      })
      const insights = await this.dream.extractCognitiveInsights({
        orgId: args.orgId,
        transcriptText,
        agent: args.agent,
        roomId: args.roomId,
        activeLoops: activeLoops.map((l) => ({ id: l.id, description: l.description })),
      })
      const result = await this.applyInsights({
        orgId: args.orgId,
        agentId,
        roomId: args.roomId ?? null,
        insights,
        activeLoops,
      })
      return result.beliefsSaved + result.loopsSaved + result.loopsResolved
    } catch {
      return 0
    }
  }

  /**
   * Merges extracted insights into memory:
   * - beliefs go to the agent's private memory for this room, or to the room when the
   *   extractor marked them shared; restatements update the existing memory instead of
   *   inserting a duplicate
   * - new loops are skipped when an active loop already says the same thing
   * - loops the turn completed are resolved
   * - the episode line is appended to today's diary entry
   */
  async applyInsights(args: {
    orgId: string
    agentId: string
    roomId: string | null
    insights: DreamInsight
    activeLoops: OpenLoopRow[]
  }): Promise<{
    beliefsSaved: number
    beliefsMerged: number
    loopsSaved: number
    loopsResolved: number
  }> {
    let beliefsSaved = 0
    let beliefsMerged = 0
    let loopsSaved = 0
    let loopsResolved = 0

    for (const b of args.insights.beliefs) {
      const scope: MemoryScope = b.shared && args.roomId ? "room" : "agent"
      const title = redactSecrets(b.title).text
      const body = redactSecrets(b.body).text
      const similar = await this.findSimilar({
        orgId: args.orgId,
        scope,
        agentId: args.agentId,
        roomId: args.roomId,
        title,
        body,
      })

      if (similar) {
        await this.getDb()
          .update(memories)
          .set({
            body,
            tags: [...new Set([...(similar.tags ?? []), ...b.tags])].slice(0, 12),
            confidence: Math.max(similar.confidence, b.confidence),
            emotionalSalience: Math.max(similar.emotionalSalience, b.emotionalSalience),
            lastUsedAt: new Date(),
            useCount: sql`${memories.useCount} + 1`,
            updatedAt: new Date(),
            ...(similar.body !== body
              ? { embedding: null, embeddingModel: null, embeddedAt: null }
              : {}),
          })
          .where(eq(memories.id, similar.id))
        if (similar.body !== body) this.scheduleEmbedding(args.orgId, [similar.id])
        beliefsMerged++
        continue
      }

      await this.write({
        orgId: args.orgId,
        scope,
        agentId: args.agentId,
        roomId: args.roomId,
        kind: b.kind,
        title,
        body,
        tags: b.tags,
        source: "consolidation",
        epistemicStatus: b.epistemicStatus,
        confidence: b.confidence,
        emotionalSalience: b.emotionalSalience,
        perspective: b.perspective,
        createdByAgentId: args.agentId,
      })
      beliefsSaved++
    }

    const resolvedIds = new Set<string>()
    for (const r of args.insights.resolvedLoops) {
      const done = await this.resolveOpenLoop(r.id, args.orgId, args.agentId, r.resolution)
      if (done) {
        resolvedIds.add(r.id)
        loopsResolved++
      }
    }

    const stillOpen = args.activeLoops.filter((l) => !resolvedIds.has(l.id))
    for (const l of args.insights.openLoops) {
      if (stillOpen.some((open) => jaccard(open.description, l.description) >= 0.6)) continue
      const dueAt = l.dueInHours ? new Date(Date.now() + l.dueInHours * 60 * 60 * 1000) : null
      const created = await this.createOpenLoop({
        orgId: args.orgId,
        agentId: args.agentId,
        roomId: args.roomId,
        description: l.description,
        dueAt,
      })
      stillOpen.push(created)
      loopsSaved++
    }

    if (args.insights.episode && args.roomId) {
      try {
        await this.writeDailyEpisode({
          orgId: args.orgId,
          agentId: args.agentId,
          roomId: args.roomId,
          summary: args.insights.episode,
        })
      } catch {}
    }

    return { beliefsSaved, beliefsMerged, loopsSaved, loopsResolved }
  }

  /** An existing memory in the same scope bucket that restates `title`/`body`. */
  async findSimilar(args: {
    orgId: string
    scope: MemoryScope
    agentId: string
    roomId: string | null
    title: string
    body: string
  }): Promise<MemoryRow | null> {
    const db = this.getDb()
    const bucket = buildScopeConditions({
      orgId: args.orgId,
      scope: args.scope,
      agentId: args.agentId,
      roomId: args.roomId,
    })
    const tsQuerySource = buildOrTsQuery(queryTerms(`${args.title} ${args.title} ${args.body}`, 16))
    const titleMatch = sql`lower(${memories.title}) = lower(${args.title})`
    const match = tsQuerySource
      ? or(titleMatch, sql`tsv @@ to_tsquery('english', ${tsQuerySource})`)
      : titleMatch

    const rows = await db
      .select()
      .from(memories)
      .where(
        and(
          bucket,
          inArray(memories.epistemicStatus, ACTIVE_STATUSES),
          ne(memories.kind, "episode"),
          match,
        ),
      )
      .orderBy(desc(memories.updatedAt))
      .limit(10)

    return rows.find((r) => isNearDuplicate({ title: args.title, body: args.body }, r)) ?? null
  }

  /**
   * Appends one line to the agent's diary for today in this room ("what I did today").
   * Private to the agent and bound to the room; decays after ~2 weeks unless recalled.
   */
  async writeDailyEpisode(args: {
    orgId: string
    agentId: string
    roomId: string
    summary: string
  }) {
    const today = new Date().toISOString().split("T")[0] ?? ""
    const title = `Daily Episode: ${today}`
    const line = `- ${redactSecrets(args.summary.trim().slice(0, 300)).text}`
    const [existing] = await this.getDb()
      .select({ body: memories.body })
      .from(memories)
      .where(
        and(
          eq(memories.orgId, args.orgId),
          eq(memories.scope, "agent"),
          eq(memories.agentId, args.agentId),
          eq(memories.roomId, args.roomId),
          eq(memories.title, title),
        ),
      )
      .limit(1)
    const body = existing ? `${existing.body}\n${line}`.slice(-4000) : line
    return this.write({
      orgId: args.orgId,
      scope: "agent",
      agentId: args.agentId,
      roomId: args.roomId,
      kind: "episode",
      title,
      body,
      tags: ["episode", today],
      source: "consolidation",
      decayHalfLifeDays: 14,
      createdByAgentId: args.agentId,
    })
  }

  /**
   * Runs the dream consolidation cycle (decayed episodes, overdue loops, old withdrawn
   * records) and embeds memories still missing a vector for the current model.
   */
  async consolidate(orgId: string): Promise<{
    expiredEpisodes: number
    loopsUpdated: number
    withdrawnCleaned: number
    embedded: number
  }> {
    const result = await this.dream.dreamConsolidate(orgId)
    let embedded = 0
    try {
      embedded = await this.embedMemories(orgId, { limit: 100 })
    } catch (error) {
      console.warn("[memory] embedding backfill failed:", redactSecrets(String(error)).text)
    }
    return {
      expiredEpisodes: result.prunedEpisodes,
      loopsUpdated: result.staleLoopsFlagged,
      withdrawnCleaned: result.withdrawnCleaned,
      embedded,
    }
  }

  /**
   * Markdown mirror for the agent's persistent computer (/home/bot/.saaya/memory/).
   *
   * The computer is shared by every room the agent works in, so the mirror holds only what
   * is visible from every room: the agent's agent-wide memories, org-wide memories and
   * loops not tied to a room. Room-bound memories reach the agent through recall instead.
   */
  async generateMemoryMirror(args: {
    orgId: string
    agentId: string
  }): Promise<{ memoryMd: string; openLoopsMd: string; topics: Record<string, string> }> {
    const rows = await this.getDb()
      .select()
      .from(memories)
      .where(
        and(
          buildScopeConditions({ orgId: args.orgId, agentId: args.agentId, roomId: null }),
          inArray(memories.epistemicStatus, ACTIVE_STATUSES),
          ne(memories.kind, "episode"),
        ),
      )
      .orderBy(desc(memories.pinned), desc(memories.updatedAt))
      .limit(200)

    const line = (m: MemoryRow) =>
      `- **${m.title}** (${m.scope === "agent" ? "private" : "workspace"}, ${m.kind}, ${m.epistemicStatus}): ${m.body}`
    const pinned = rows.filter((r) => r.pinned)
    const memoryMd = [
      "# Agent Memory",
      "",
      "Generated by the Sayabot memory layer from your agent-wide and workspace memories.",
      "Room-specific memories are not mirrored here; use the recall tool inside a room.",
      "",
      "## Pinned",
      "",
      ...(pinned.length ? pinned.map(line) : ["_None._"]),
      "",
      "## Beliefs & Decisions",
      "",
      ...rows
        .filter((r) => !r.pinned)
        .slice(0, 50)
        .map(line),
    ].join("\n")

    const topics: Record<string, string> = {}
    for (const row of rows) {
      for (const tag of (row.tags ?? []).slice(0, 6)) {
        if (!topics[tag] && Object.keys(topics).length >= 40) continue
        topics[tag] = `${topics[tag] ?? `# Topic: ${tag}\n\n`}- **${row.title}**: ${row.body}\n`
      }
    }

    let openLoopsMd = this.openLoops.formatOpenLoopsMarkdown([])
    try {
      const loops = await this.openLoops.getActiveLoops({
        orgId: args.orgId,
        agentId: args.agentId,
        roomless: true,
      })
      openLoopsMd = this.openLoops.formatOpenLoopsMarkdown(loops)
    } catch {}

    return { memoryMd, openLoopsMd, topics }
  }

  /**
   * Permanently deletes a memory the caller may change.
   */
  async forget(id: string, access: MemoryAccessContext): Promise<boolean> {
    const row = await this.loadAccessible(id, access, "write")
    if (!row) return false
    const result = await this.getDb()
      .delete(memories)
      .where(and(eq(memories.id, id), eq(memories.orgId, access.orgId)))
      .returning({ id: memories.id })
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
