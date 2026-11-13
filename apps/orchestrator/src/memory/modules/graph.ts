import { and, eq, inArray, ne, or, sql } from "drizzle-orm"
import { memories, memoryLinks, type Db, type MemoryLinkRow, type MemoryRow } from "@sayabot/db"
import type { MemoryLinkInput, MemoryLinkType, MemoryLinkView } from "../types"
import { buildScopeConditions, type MemoryAccessContext } from "./sources"

const WIKILINK_REGEX = /\[\[([a-zA-Z0-9_\-\s]+)\]\]/g

/** Same normalisation as wikilinks so a `[[Session Management]]` link finds that title. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, "")
    .replace(/\s+/g, "-")
}

export function extractWikilinks(text: string): string[] {
  const matches = new Set<string>()
  for (const match of text.matchAll(WIKILINK_REGEX)) {
    const raw = match[1]?.trim()
    if (raw) matches.add(slugify(raw))
  }
  return Array.from(matches)
}

/** SQL twin of `slugify` applied to a memory title. */
const titleSlugSql = sql`regexp_replace(regexp_replace(lower(trim(${memories.title})), '[^a-z0-9_[:space:]-]', '', 'g'), '[[:space:]]+', '-', 'g')`

export interface GraphNode {
  memory: MemoryRow
  depth: number
  relationship?: MemoryLinkType
  weight: number
}

export interface GraphWalkResult {
  rootMemoryId?: string
  nodes: GraphNode[]
  edges: MemoryLinkRow[]
}

/**
 * Knowledge Graph Engine
 * Manages concept wikilinks [[slug]] and relational graph walks across memories.
 * Every read is filtered through the caller's memory visibility.
 */
export class MemoryGraphEngine {
  constructor(private db: Db) {}

  /**
   * Re-indexes the explicit links and `[[slug]]` wikilinks a memory's body declares.
   * `supersedes` edges are belief history, not body links, so a rewrite keeps them.
   */
  async syncLinks(input: {
    orgId: string
    sourceMemoryId: string
    bodyText: string
    explicitLinks?: MemoryLinkInput[]
  }): Promise<MemoryLinkRow[]> {
    const linksToInsert: Array<{
      orgId: string
      sourceMemoryId: string
      targetMemoryId?: string | null
      targetSlug?: string | null
      relationship: MemoryLinkType
      weight: number
    }> = []

    for (const link of input.explicitLinks ?? []) {
      if (link.relationship === "supersedes") continue
      linksToInsert.push({
        orgId: input.orgId,
        sourceMemoryId: input.sourceMemoryId,
        targetMemoryId: link.targetMemoryId ?? null,
        targetSlug: link.targetSlug ? slugify(link.targetSlug) : null,
        relationship: link.relationship ?? "relates_to",
        weight: link.weight ?? 1.0,
      })
    }

    for (const slug of extractWikilinks(input.bodyText)) {
      if (linksToInsert.some((l) => l.targetSlug === slug)) continue
      linksToInsert.push({
        orgId: input.orgId,
        sourceMemoryId: input.sourceMemoryId,
        targetSlug: slug,
        relationship: "relates_to",
        weight: 0.8,
      })
    }

    // Always clear the old body links, even when the new body has none.
    await this.db
      .delete(memoryLinks)
      .where(
        and(
          eq(memoryLinks.sourceMemoryId, input.sourceMemoryId),
          eq(memoryLinks.orgId, input.orgId),
          ne(memoryLinks.relationship, "supersedes"),
        ),
      )

    if (linksToInsert.length === 0) return []
    return this.db.insert(memoryLinks).values(linksToInsert).returning()
  }

  /**
   * Breadth-first walk from a memory up to `maxDepth` (1 or 2) hops, following explicit
   * edges in both directions and resolving `[[slug]]` edges to the memories whose title
   * slugifies to that slug (plus other memories citing the same slug). Only memories the
   * caller can read become nodes; the root must be readable too.
   */
  async graphWalk(input: {
    orgId: string
    startMemoryId: string
    access: MemoryAccessContext
    maxDepth?: number
    limit?: number
  }): Promise<GraphWalkResult> {
    const maxDepth = Math.min(2, Math.max(1, input.maxDepth ?? 1))
    const limit = input.limit ?? 15
    const visible = buildScopeConditions({
      orgId: input.orgId,
      agentId: input.access.agentId,
      roomId: input.access.roomId,
    })

    const [root] = await this.db
      .select({ id: memories.id })
      .from(memories)
      .where(and(visible, eq(memories.id, input.startMemoryId)))
      .limit(1)
    if (!root) return { rootMemoryId: input.startMemoryId, nodes: [], edges: [] }

    const visited = new Set<string>([input.startMemoryId])
    const resultNodes: GraphNode[] = []
    const resultEdges: MemoryLinkRow[] = []
    let currentLevel = new Set<string>([input.startMemoryId])

    for (let depth = 1; depth <= maxDepth; depth++) {
      if (currentLevel.size === 0 || resultNodes.length >= limit) break
      const levelIds = [...currentLevel]

      const edges: MemoryLinkRow[] = await this.db
        .select()
        .from(memoryLinks)
        .where(
          and(
            eq(memoryLinks.orgId, input.orgId),
            or(
              inArray(memoryLinks.sourceMemoryId, levelIds),
              inArray(memoryLinks.targetMemoryId, levelIds),
            ),
          ),
        )

      // neighbour id -> the edge that reached it
      const reached = new Map<
        string,
        { relationship: MemoryLinkType; weight: number; edge: MemoryLinkRow }
      >()
      const note = (id: string | null | undefined, edge: MemoryLinkRow) => {
        if (!id || visited.has(id) || reached.has(id)) return
        reached.set(id, {
          relationship: edge.relationship as MemoryLinkType,
          weight: edge.weight,
          edge,
        })
      }

      const slugEdges: MemoryLinkRow[] = []
      for (const edge of edges) {
        if (currentLevel.has(edge.sourceMemoryId)) {
          if (edge.targetMemoryId) note(edge.targetMemoryId, edge)
          else if (edge.targetSlug) slugEdges.push(edge)
        } else if (edge.targetMemoryId && currentLevel.has(edge.targetMemoryId)) {
          note(edge.sourceMemoryId, edge)
        }
      }

      if (slugEdges.length > 0) {
        const slugs = [
          ...new Set(slugEdges.map((e) => e.targetSlug).filter((s): s is string => !!s)),
        ]
        const bySlug = new Map(slugEdges.map((e) => [e.targetSlug, e]))
        const titled = await this.db
          .select({ id: memories.id, slug: sql<string>`${titleSlugSql}` })
          .from(memories)
          .where(
            and(
              visible,
              sql`${titleSlugSql} in (${sql.join(
                slugs.map((s) => sql`${s}`),
                sql`, `,
              )})`,
            ),
          )
          .limit(limit * 2)
        for (const t of titled) {
          const edge = bySlug.get(t.slug)
          if (edge) note(t.id, edge)
        }
        // Co-citation: other memories linking the same concept are related too.
        const coCiting: MemoryLinkRow[] = await this.db
          .select()
          .from(memoryLinks)
          .where(and(eq(memoryLinks.orgId, input.orgId), inArray(memoryLinks.targetSlug, slugs)))
          .limit(limit * 2)
        for (const edge of coCiting) note(edge.sourceMemoryId, edge)
      }

      const candidateIds = [...reached.keys()]
      const nextLevel = new Set<string>()
      if (candidateIds.length > 0) {
        const neighborMemories: MemoryRow[] = await this.db
          .select()
          .from(memories)
          .where(and(visible, inArray(memories.id, candidateIds)))

        for (const mem of neighborMemories) {
          const via = reached.get(mem.id)
          if (!via) continue
          visited.add(mem.id)
          nextLevel.add(mem.id)
          resultEdges.push(via.edge)
          resultNodes.push({
            memory: mem,
            depth,
            relationship: via.relationship,
            weight: via.weight,
          })
          if (resultNodes.length >= limit) break
        }
      }
      currentLevel = nextLevel
    }

    return { rootMemoryId: input.startMemoryId, nodes: resultNodes, edges: resultEdges }
  }

  /**
   * Outgoing links for a list of memories. Links pointing at a memory the caller cannot
   * read are dropped so recall never reveals another agent's or room's memory ids.
   */
  async getLinksForMemories(
    orgId: string,
    memoryIds: string[],
    access: MemoryAccessContext,
  ): Promise<Record<string, MemoryLinkView[]>> {
    if (memoryIds.length === 0) return {}

    const rows = await this.db
      .select({
        id: memoryLinks.id,
        sourceMemoryId: memoryLinks.sourceMemoryId,
        targetMemoryId: memoryLinks.targetMemoryId,
        targetSlug: memoryLinks.targetSlug,
        relationship: memoryLinks.relationship,
        weight: memoryLinks.weight,
      })
      .from(memoryLinks)
      .where(and(eq(memoryLinks.orgId, orgId), inArray(memoryLinks.sourceMemoryId, memoryIds)))

    let readableTargets = new Set<string>()
    const targetIds = [
      ...new Set(rows.map((r) => r.targetMemoryId).filter((id): id is string => !!id)),
    ]
    if (targetIds.length > 0) {
      const visible = await this.db
        .select({ id: memories.id })
        .from(memories)
        .where(
          and(
            buildScopeConditions({ orgId, agentId: access.agentId, roomId: access.roomId }),
            inArray(memories.id, targetIds),
          ),
        )
      readableTargets = new Set(visible.map((v) => v.id))
    }

    const map: Record<string, MemoryLinkView[]> = {}
    for (const id of memoryIds) map[id] = []

    for (const r of rows) {
      if (r.targetMemoryId && !readableTargets.has(r.targetMemoryId)) continue
      const list = map[r.sourceMemoryId] ?? []
      list.push({
        id: r.id,
        targetMemoryId: r.targetMemoryId,
        targetSlug: r.targetSlug,
        relationship: r.relationship as MemoryLinkType,
        weight: r.weight,
      })
      map[r.sourceMemoryId] = list
    }

    return map
  }
}
