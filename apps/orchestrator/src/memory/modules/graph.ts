import { and, eq, inArray, or } from "drizzle-orm"
import { memories, memoryLinks, type MemoryLinkRow, type MemoryRow } from "@sayabot/db"
import type { MemoryLinkInput, MemoryLinkType, MemoryLinkView } from "../types"

const WIKILINK_REGEX = /\[\[([a-zA-Z0-9_\-\s]+)\]\]/g

export function extractWikilinks(text: string): string[] {
  const matches = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = WIKILINK_REGEX.exec(text)) !== null) {
    const raw = match[1]?.trim()
    if (raw && raw.length > 0) {
      matches.add(raw.toLowerCase().replace(/\s+/g, "-"))
    }
  }
  return Array.from(matches)
}

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
 */
export class MemoryGraphEngine {
  constructor(private db: any) {}

  /**
   * Synchronizes graph links for a given memory item.
   * Connects explicit memory links and auto-extracted [[slug]] wikilinks.
   */
  async syncLinks(input: {
    orgId: string
    sourceMemoryId: string
    bodyText: string
    explicitLinks?: MemoryLinkInput[]
  }): Promise<MemoryLinkRow[]> {
    const explicit = input.explicitLinks ?? []
    const parsedSlugs = extractWikilinks(input.bodyText)

    const linksToInsert: Array<{
      orgId: string
      sourceMemoryId: string
      targetMemoryId?: string | null
      targetSlug?: string | null
      relationship: MemoryLinkType
      weight: number
    }> = []

    for (const link of explicit) {
      linksToInsert.push({
        orgId: input.orgId,
        sourceMemoryId: input.sourceMemoryId,
        targetMemoryId: link.targetMemoryId ?? null,
        targetSlug: link.targetSlug ? link.targetSlug.toLowerCase() : null,
        relationship: link.relationship ?? "relates_to",
        weight: link.weight ?? 1.0,
      })
    }

    // Auto-link parsed wikilinks if not already present
    for (const slug of parsedSlugs) {
      const alreadyAdded = linksToInsert.some((l) => l.targetSlug === slug)
      if (!alreadyAdded) {
        linksToInsert.push({
          orgId: input.orgId,
          sourceMemoryId: input.sourceMemoryId,
          targetSlug: slug,
          relationship: "relates_to",
          weight: 0.8,
        })
      }
    }

    if (linksToInsert.length === 0) return []

    // Remove existing links for this memory and recreate
    await this.db
      .delete(memoryLinks)
      .where(
        and(
          eq(memoryLinks.sourceMemoryId, input.sourceMemoryId),
          eq(memoryLinks.orgId, input.orgId),
        ),
      )

    const inserted = await this.db.insert(memoryLinks).values(linksToInsert).returning()
    return inserted
  }

  /**
   * Performs a breadth-first graph walk starting from a given memory ID up to maxDepth (1 or 2).
   */
  async graphWalk(input: {
    orgId: string
    startMemoryId: string
    maxDepth?: number
    limit?: number
  }): Promise<GraphWalkResult> {
    const maxDepth = Math.min(2, Math.max(1, input.maxDepth ?? 1))
    const limit = input.limit ?? 15

    const visitedMemoryIds = new Set<string>([input.startMemoryId])
    const resultNodes: GraphNode[] = []
    const resultEdges: MemoryLinkRow[] = []

    let currentLevelIds = [input.startMemoryId]

    for (let depth = 1; depth <= maxDepth; depth++) {
      if (currentLevelIds.length === 0 || resultNodes.length >= limit) break

      // Find all edges starting from or pointing to current level IDs
      const edges: MemoryLinkRow[] = await this.db
        .select()
        .from(memoryLinks)
        .where(
          and(
            eq(memoryLinks.orgId, input.orgId),
            or(
              inArray(memoryLinks.sourceMemoryId, currentLevelIds),
              inArray(memoryLinks.targetMemoryId, currentLevelIds),
            ),
          ),
        )

      const nextLevelIds: string[] = []

      for (const edge of edges) {
        resultEdges.push(edge)

        const neighborId =
          edge.sourceMemoryId === currentLevelIds[0]
            ? edge.targetMemoryId
            : edge.sourceMemoryId

        if (neighborId && !visitedMemoryIds.has(neighborId)) {
          visitedMemoryIds.add(neighborId)
          nextLevelIds.push(neighborId)
        }
      }

      if (nextLevelIds.length > 0) {
        const neighborMemories: MemoryRow[] = await this.db
          .select()
          .from(memories)
          .where(and(eq(memories.orgId, input.orgId), inArray(memories.id, nextLevelIds)))

        for (const mem of neighborMemories) {
          const matchingEdge = edges.find(
            (e) => e.sourceMemoryId === mem.id || e.targetMemoryId === mem.id,
          )
          resultNodes.push({
            memory: mem,
            depth,
            relationship: matchingEdge?.relationship as MemoryLinkType,
            weight: matchingEdge?.weight ?? 1.0,
          })
          if (resultNodes.length >= limit) break
        }
      }

      currentLevelIds = nextLevelIds
    }

    return {
      rootMemoryId: input.startMemoryId,
      nodes: resultNodes,
      edges: resultEdges,
    }
  }

  /**
   * Retrieves links for a list of memory IDs.
   */
  async getLinksForMemories(
    orgId: string,
    memoryIds: string[],
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

    const map: Record<string, MemoryLinkView[]> = {}
    for (const id of memoryIds) {
      map[id] = []
    }

    for (const r of rows) {
      if (!map[r.sourceMemoryId]) map[r.sourceMemoryId] = []
      map[r.sourceMemoryId]!.push({
        id: r.id,
        targetMemoryId: r.targetMemoryId,
        targetSlug: r.targetSlug,
        relationship: r.relationship as MemoryLinkType,
        weight: r.weight,
      })
    }

    return map
  }
}
