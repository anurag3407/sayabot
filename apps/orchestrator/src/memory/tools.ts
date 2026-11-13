import { z } from "zod"
import type { ToolSpec } from "../tools/audited"
import { getMemoryService } from "./service"
import type { MemoryAccessContext } from "./modules/sources"

export interface MemoryToolsArgs {
  orgId: string
  agentId: string
  roomId: string
}

const NOT_FOUND = "Memory not found, or not one you can change from this room."

export function memoryTools(args: MemoryToolsArgs): ToolSpec[] {
  const service = getMemoryService()
  const { orgId, agentId, roomId } = args
  const access: MemoryAccessContext = { orgId, agentId, roomId }

  const rememberTool: ToolSpec = {
    name: "remember",
    description:
      "Save a durable fact, decision, preference, belief, hypothesis, or procedure across turns. " +
      "Scopes: 'agent' = private to you in every room (default), 'room' = shared with everyone in this room, " +
      "'org' = the whole workspace. Saving again with the same title updates that memory. " +
      "Supports epistemic status, emotional salience, evidence links, and superseding an older belief.",
    schema: z.object({
      title: z.string().min(1).max(200),
      body: z.string().min(1).max(4096),
      scope: z.enum(["agent", "room", "org"]).default("agent"),
      kind: z.enum(["fact", "preference", "decision", "procedure", "episode"]).default("fact"),
      epistemic_status: z
        .enum(["verified", "belief", "hypothesis"])
        .default("belief")
        .describe(
          "verified (checked against evidence), belief (working assumption), or hypothesis (unconfirmed)",
        ),
      confidence: z.number().min(0.0).max(1.0).optional().default(0.85),
      emotional_salience: z
        .number()
        .min(0.0)
        .max(1.0)
        .optional()
        .default(0.5)
        .describe("Importance/surprise factor to resist Ebbinghaus forgetting decay"),
      perspective: z.enum(["first_person", "third_person"]).optional().default("first_person"),
      evidence_refs: z
        .array(z.string())
        .optional()
        .describe("URIs, filepaths, or references supporting this belief"),
      supersedes_memory_id: z
        .string()
        .uuid()
        .optional()
        .describe("ID of an older memory that this belief supersedes"),
      tags: z.array(z.string()).optional(),
      pinned: z.boolean().optional(),
    }),
    dangerous: false,
    execute: async (input: {
      title: string
      body: string
      scope: "agent" | "room" | "org"
      kind: "fact" | "preference" | "decision" | "procedure" | "episode"
      epistemic_status: "verified" | "belief" | "hypothesis"
      confidence?: number
      emotional_salience?: number
      perspective?: "first_person" | "third_person"
      evidence_refs?: string[]
      supersedes_memory_id?: string
      tags?: string[]
      pinned?: boolean
    }) => {
      const memory = await service.write({
        orgId,
        scope: input.scope,
        agentId: input.scope === "agent" ? agentId : null,
        roomId: input.scope === "room" ? roomId : null,
        kind: input.kind,
        title: input.title,
        body: input.body,
        tags: input.tags,
        pinned: input.pinned,
        epistemicStatus: input.epistemic_status,
        confidence: input.confidence,
        emotionalSalience: input.emotional_salience,
        perspective: input.perspective,
        evidenceRefs: input.evidence_refs,
        createdByAgentId: agentId,
      })

      if (!memory) {
        throw new Error("Failed to save memory")
      }

      let superseded: boolean | undefined
      if (input.supersedes_memory_id) {
        superseded = await service.supersedeBelief(input.supersedes_memory_id, memory.id, access)
      }

      return {
        ok: true,
        id: memory.id,
        title: memory.title,
        scope: memory.scope,
        epistemic_status: memory.epistemicStatus,
        ...(superseded === undefined ? {} : { superseded }),
      }
    },
  }

  const recallTool: ToolSpec = {
    name: "recall",
    description:
      "Search your memory: your private memories, this room's shared memories, workspace memories, and what the owner already told you (owner facts). " +
      "Ranked by relevance (full-text, semantic, keyword), retention decay, salience and epistemic status. Cite results as [#id] when you use them.",
    schema: z.object({
      query: z.string().min(1),
      scope: z.enum(["agent", "room", "org"]).optional(),
      epistemic_filter: z
        .array(z.enum(["verified", "belief", "hypothesis", "superseded", "withdrawn"]))
        .optional()
        .describe("Restrict to these epistemic statuses (default: verified, belief, hypothesis)"),
      min_salience: z
        .number()
        .min(0.0)
        .max(1.0)
        .optional()
        .describe("Minimum emotional salience threshold"),
      include_links: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to include knowledge graph wikilinks"),
      limit: z.number().int().positive().max(20).optional().default(8),
    }),
    dangerous: false,
    execute: async (input: {
      query: string
      scope?: "agent" | "room" | "org"
      epistemic_filter?: ("verified" | "belief" | "hypothesis" | "superseded" | "withdrawn")[]
      min_salience?: number
      include_links?: boolean
      limit?: number
    }) => {
      const [matches, facts] = await Promise.all([
        service.recall({
          orgId,
          query: input.query,
          scope: input.scope,
          agentId,
          roomId,
          epistemicFilter: input.epistemic_filter,
          minSalience: input.min_salience,
          includeLinks: input.include_links,
          limit: input.limit,
          minRelevance: 0.1,
          reinforce: true,
        }),
        input.scope
          ? Promise.resolve({ facts: [], total: 0 })
          : service
              .relevantOwnerFacts({ orgId, roomId, query: input.query, limit: 5 })
              .catch(() => ({ facts: [], total: 0 })),
      ])

      return {
        query: input.query,
        count: matches.length,
        memories: matches.map((m) => ({
          id: m.id,
          scope: m.scope === "agent" ? "private" : m.scope,
          title: m.title,
          body: m.body,
          kind: m.kind,
          epistemic_status: m.epistemicStatus,
          confidence: m.confidence,
          emotional_salience: m.emotionalSalience,
          retention: m.retention,
          relevance: m.relevance,
          score: m.score,
          links: m.links,
        })),
        ...(facts.facts.length > 0 ? { owner_facts: facts.facts } : {}),
        ...(matches.length === 0 && facts.facts.length === 0
          ? { hint: "No matching memories. Try other keywords or a broader query." }
          : {}),
      }
    },
  }

  const openLoopTool: ToolSpec = {
    name: "open_loop",
    description:
      "Track, update, or resolve your commitments, promises, and active blockers across turns.",
    schema: z.object({
      action: z
        .enum(["create", "update", "resolve", "list"])
        .describe("Action to perform on open loops"),
      id: z.string().uuid().optional().describe("Open loop ID for update or resolve"),
      description: z
        .string()
        .min(1)
        .max(2048)
        .optional()
        .describe("Description of the commitment or promise"),
      due_in_hours: z.number().positive().optional().describe("Hours until this commitment is due"),
      status: z.enum(["open", "in_progress", "blocked", "resolved", "dropped"]).optional(),
      blocker_reason: z.string().optional().describe("Reason if loop is blocked"),
      resolution: z.string().optional().describe("Resolution notes when resolving loop"),
    }),
    dangerous: false,
    execute: async (input: {
      action: "create" | "update" | "resolve" | "list"
      id?: string
      description?: string
      due_in_hours?: number
      status?: "open" | "in_progress" | "blocked" | "resolved" | "dropped"
      blocker_reason?: string
      resolution?: string
    }) => {
      if (input.action === "create") {
        if (!input.description) throw new Error("description required for open_loop create")
        const dueAt = input.due_in_hours
          ? new Date(Date.now() + input.due_in_hours * 60 * 60 * 1000)
          : null
        const loop = await service.createOpenLoop({
          orgId,
          agentId,
          roomId,
          description: input.description,
          dueAt,
        })
        return { ok: true, loop }
      }

      if (input.action === "update") {
        if (!input.id) throw new Error("id required for open_loop update")
        const updated = await service.updateOpenLoop({
          id: input.id,
          orgId,
          agentId,
          status: input.status,
          blockerReason: input.blocker_reason,
          resolution: input.resolution,
          dueAt: input.due_in_hours
            ? new Date(Date.now() + input.due_in_hours * 60 * 60 * 1000)
            : undefined,
        })
        return updated ? { ok: true, loop: updated } : { ok: false, error: "Open loop not found." }
      }

      if (input.action === "resolve") {
        if (!input.id) throw new Error("id required for open_loop resolve")
        const resolved = await service.resolveOpenLoop(
          input.id,
          orgId,
          agentId,
          input.resolution ?? "Resolved",
        )
        return resolved
          ? { ok: true, loop: resolved }
          : { ok: false, error: "Open loop not found." }
      }

      const loops = await service.getActiveLoops({ orgId, agentId, roomId })
      return { ok: true, count: loops.length, loops }
    },
  }

  const reflectTool: ToolSpec = {
    name: "reflect",
    description:
      "Cognitive reflection tool: detect contradictions with existing beliefs or inspect belief evolution lineage.",
    schema: z.object({
      action: z
        .enum(["detect_contradictions", "belief_lineage"])
        .describe("Action: detect_contradictions or belief_lineage"),
      title: z.string().optional().describe("Candidate belief title for contradiction check"),
      tags: z.array(z.string()).optional(),
      memory_id: z.string().uuid().optional().describe("Memory ID for lineage traversal"),
    }),
    dangerous: false,
    execute: async (input: {
      action: "detect_contradictions" | "belief_lineage"
      title?: string
      tags?: string[]
      memory_id?: string
    }) => {
      if (input.action === "detect_contradictions") {
        if (!input.title) throw new Error("title required for detect_contradictions")
        const contradictions = await service.detectContradictions({
          orgId,
          title: input.title,
          tags: input.tags,
          agentId,
          roomId,
        })
        return { ok: true, potential_contradictions: contradictions }
      }

      if (input.action === "belief_lineage") {
        if (!input.memory_id) throw new Error("memory_id required for belief_lineage")
        const lineage = await service.getBeliefLineage(input.memory_id, access)
        return {
          ok: true,
          lineage: lineage.map((l) => ({
            id: l.id,
            title: l.title,
            epistemic_status: l.epistemicStatus,
            created_at: l.createdAt,
          })),
        }
      }

      throw new Error(`Unsupported action: ${input.action}`)
    },
  }

  const graphWalkTool: ToolSpec = {
    name: "graph_walk",
    description:
      "Traverse the knowledge graph starting from a memory node along relational links and concept [[wikilinks]].",
    schema: z.object({
      start_memory_id: z.string().uuid().describe("Root memory ID to start graph exploration"),
      max_depth: z
        .number()
        .int()
        .min(1)
        .max(2)
        .optional()
        .default(1)
        .describe("Search depth (1 or 2 hops)"),
      limit: z.number().int().positive().max(20).optional().default(10),
    }),
    dangerous: false,
    execute: async (input: { start_memory_id: string; max_depth?: number; limit?: number }) => {
      const graph = await service.graphWalk({
        startMemoryId: input.start_memory_id,
        access,
        maxDepth: input.max_depth,
        limit: input.limit,
      })

      return {
        ok: true,
        root_memory_id: input.start_memory_id,
        connected_nodes: graph.nodes.map((n) => ({
          id: n.memory.id,
          title: n.memory.title,
          epistemic_status: n.memory.epistemicStatus,
          depth: n.depth,
          relationship: n.relationship,
          weight: n.weight,
        })),
        edge_count: graph.edges.length,
      }
    },
  }

  const forgetTool: ToolSpec = {
    name: "forget",
    description:
      "Retract an outdated or falsified memory by ID. By default it is withdrawn (kept for audit, never recalled). " +
      "hard_delete=true erases it permanently and needs a person's approval.",
    schema: z.object({
      id: z.string().uuid(),
      reason: z.string().optional().describe("Reason for withdrawal or retraction"),
      hard_delete: z
        .boolean()
        .optional()
        .default(false)
        .describe("Permanently delete instead of withdraw (requires approval)"),
    }),
    dangerous: (input) => input.hard_delete === true,
    execute: async (input: { id: string; reason?: string; hard_delete?: boolean }) => {
      if (input.hard_delete) {
        const deleted = await service.forget(input.id, access)
        return deleted
          ? { ok: true, id: input.id, action: "deleted" }
          : { ok: false, id: input.id, error: NOT_FOUND }
      }
      const withdrawn = await service.withdrawBelief(
        input.id,
        access,
        input.reason ?? "Retracted by agent",
      )
      return withdrawn
        ? { ok: true, id: input.id, action: "withdrawn" }
        : { ok: false, id: input.id, error: NOT_FOUND }
    },
  }

  return [rememberTool, recallTool, openLoopTool, reflectTool, graphWalkTool, forgetTool]
}
