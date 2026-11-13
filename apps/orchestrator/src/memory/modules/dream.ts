import { generateText } from "ai"
import { and, eq, inArray, lt } from "drizzle-orm"
import { z } from "zod"
import { memories, openLoops, type Db } from "@sayabot/db"
import type { AgentRow } from "../../runner/context"
import { resolveAgentCheapModel } from "../../runner/llm"
import { recordUsageEvent, tokensFrom } from "../../usage"
import { calculateRetention } from "./salience"

const beliefSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  kind: z.enum(["fact", "preference", "decision", "procedure"]).catch("fact"),
  // A transcript is the agent's own account: it can support a belief, never verify one.
  epistemicStatus: z
    .enum(["verified", "belief", "hypothesis"])
    .catch("belief")
    .transform((s) => (s === "verified" ? ("belief" as const) : s)),
  confidence: z.number().min(0).max(1).catch(0.8),
  emotionalSalience: z.number().min(0).max(1).catch(0.5),
  perspective: z.enum(["first_person", "third_person"]).catch("first_person"),
  tags: z.array(z.string().trim().min(1).max(40)).max(6).catch([]),
  shared: z.boolean().catch(false),
})

const openLoopSchema = z.object({
  description: z.string().trim().min(1).max(500),
  dueInHours: z
    .number()
    .positive()
    .max(24 * 90)
    .optional()
    .catch(undefined),
})

const resolvedLoopSchema = z.object({
  id: z.string().min(1),
  resolution: z.string().trim().max(500).catch("Resolved during conversation"),
})

const insightSchema = z.object({
  beliefs: z.array(z.unknown()).catch([]),
  openLoops: z.array(z.unknown()).catch([]),
  resolvedLoops: z.array(z.unknown()).catch([]),
  episode: z.string().trim().max(400).optional().catch(undefined),
})

export type ExtractedBelief = z.infer<typeof beliefSchema>
export type ExtractedOpenLoop = z.infer<typeof openLoopSchema>

export interface DreamInsight {
  beliefs: ExtractedBelief[]
  openLoops: ExtractedOpenLoop[]
  resolvedLoops: Array<{ id: string; resolution: string }>
  episode?: string
}

export interface DreamConsolidationResult {
  prunedEpisodes: number
  withdrawnCleaned: number
  staleLoopsFlagged: number
}

const EMPTY: DreamInsight = { beliefs: [], openLoops: [], resolvedLoops: [] }

const SYSTEM_PROMPT = [
  "You are the memory consolidator for an AI agent. From one conversation turn, extract only what is worth remembering in future turns.",
  "Return ONLY JSON with this shape:",
  "{",
  '  "beliefs": [{ "title": string, "body": string, "kind": "fact"|"preference"|"decision"|"procedure", "epistemicStatus": "belief"|"hypothesis", "confidence": number, "emotionalSalience": number, "perspective": "first_person"|"third_person", "tags": string[], "shared": boolean }],',
  '  "openLoops": [{ "description": string, "dueInHours": number }],',
  '  "resolvedLoops": [{ "id": string, "resolution": string }],',
  '  "episode": string',
  "}",
  "Rules:",
  "- At most 3 beliefs and 2 open loops. Return empty arrays when nothing durable happened. Ignore greetings, status chatter and anything already in the active loops.",
  "- Capture what the human stated (preferences, decisions, constraints, facts about them or the project) as well as what the agent concluded.",
  "- Titles are short noun phrases naming the topic (e.g. 'Deploy target', 'Report format preference') so a later restatement updates the same memory.",
  "- shared=true only for project knowledge the whole room's team should rely on; personal details about a person stay shared=false.",
  "- openLoops are commitments the agent made or was asked for and has not finished.",
  "- resolvedLoops lists ids from ACTIVE LOOPS that this turn clearly completed or cancelled.",
  "- episode is one sentence (max 200 chars) on what happened this turn, or omit it.",
  "- Never copy credentials, tokens, keys or passwords into any field.",
].join("\n")

/** Tolerates code fences and prose around the JSON object. */
export function parseInsightJson(text: string): unknown {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}

export function normalizeInsights(raw: unknown, activeLoopIds: ReadonlySet<string>): DreamInsight {
  const parsed = insightSchema.safeParse(raw)
  if (!parsed.success) return EMPTY
  const beliefs = parsed.data.beliefs
    .map((b) => beliefSchema.safeParse(b))
    .flatMap((r) => (r.success ? [r.data] : []))
    .slice(0, 3)
  const loops = parsed.data.openLoops
    .map((l) => openLoopSchema.safeParse(l))
    .flatMap((r) => (r.success ? [r.data] : []))
    .slice(0, 2)
  // Only loops we showed the model may be resolved: no hallucinated or foreign ids.
  const resolvedLoops = parsed.data.resolvedLoops
    .map((l) => resolvedLoopSchema.safeParse(l))
    .flatMap((r) => (r.success && activeLoopIds.has(r.data.id) ? [r.data] : []))
  const episode = parsed.data.episode?.slice(0, 200) || undefined
  return { beliefs, openLoops: loops, resolvedLoops, episode }
}

/**
 * Autonomous Consolidation Engine ("Dream / Sleep Cycle")
 * Synthesizes long-term semantic knowledge from episodic transcripts,
 * detects open commitments, and prunes decaying episodic memories according to the Ebbinghaus curve.
 */
export class DreamEngine {
  constructor(private db: Db) {}

  /**
   * Extracts durable beliefs, new commitments and resolved commitments from one turn.
   * `transcriptText` must already be redacted: it is sent to the model provider.
   */
  async extractCognitiveInsights(args: {
    orgId: string
    transcriptText: string
    agent: AgentRow
    roomId?: string | null
    activeLoops?: Array<{ id: string; description: string }>
  }): Promise<DreamInsight> {
    if (!args.transcriptText || args.transcriptText.length < 50) return EMPTY

    const loops = args.activeLoops ?? []
    const loopsBlock =
      loops.length > 0
        ? `ACTIVE LOOPS:\n${loops.map((l) => `- id=${l.id}: ${l.description}`).join("\n")}`
        : "ACTIVE LOOPS: none"

    try {
      const resolved = await resolveAgentCheapModel(args.agent)
      const result = await generateText({
        model: resolved.model,
        system: SYSTEM_PROMPT,
        prompt: `${loopsBlock}\n\nTURN:\n${args.transcriptText.slice(0, 6000)}\n\nJSON:`,
      })

      await recordUsageEvent({
        orgId: args.orgId,
        roomId: args.roomId ?? null,
        agentId: args.agent.id,
        provider: resolved.provider,
        model: resolved.modelName,
        tokens: tokensFrom(result.totalUsage),
        kind: "memory",
      })

      return normalizeInsights(parseInsightJson(result.text), new Set(loops.map((l) => l.id)))
    } catch {
      return EMPTY
    }
  }

  /**
   * Performs dream consolidation:
   * 1. Evaluates episodic memories using Ebbinghaus decay curve and prunes decayed items (retention < 0.15).
   * 2. Flags overdue open loops as blocked if past their due date.
   * 3. Purges withdrawn memories older than 60 days.
   */
  async dreamConsolidate(orgId: string): Promise<DreamConsolidationResult> {
    const now = new Date()

    const candidateEpisodes = await this.db
      .select({
        id: memories.id,
        createdAt: memories.createdAt,
        lastUsedAt: memories.lastUsedAt,
        useCount: memories.useCount,
        decayHalfLifeDays: memories.decayHalfLifeDays,
      })
      .from(memories)
      .where(
        and(eq(memories.orgId, orgId), eq(memories.kind, "episode"), eq(memories.pinned, false)),
      )
      .orderBy(memories.createdAt)
      .limit(500)

    const episodeIdsToPrune: string[] = []
    for (const ep of candidateEpisodes) {
      const retention = calculateRetention({
        createdAt: ep.createdAt,
        lastUsedAt: ep.lastUsedAt,
        useCount: ep.useCount,
        decayHalfLifeDays: ep.decayHalfLifeDays,
        now,
      })
      const ageDays = (now.getTime() - ep.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      if (retention < 0.15 && ageDays > 14) episodeIdsToPrune.push(ep.id)
    }

    let prunedEpisodes = 0
    if (episodeIdsToPrune.length > 0) {
      const deleted = await this.db
        .delete(memories)
        .where(and(eq(memories.orgId, orgId), inArray(memories.id, episodeIdsToPrune)))
        .returning({ id: memories.id })
      prunedEpisodes = deleted.length
    }

    const overdueLoops = await this.db
      .update(openLoops)
      .set({
        status: "blocked",
        blockerReason: "Overdue loop auto-flagged during dream consolidation",
        updatedAt: now,
      })
      .where(
        and(
          eq(openLoops.orgId, orgId),
          inArray(openLoops.status, ["open", "in_progress"]),
          lt(openLoops.dueAt, now),
        ),
      )
      .returning({ id: openLoops.id })

    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
    const withdrawnCleanedRows = await this.db
      .delete(memories)
      .where(
        and(
          eq(memories.orgId, orgId),
          eq(memories.epistemicStatus, "withdrawn"),
          lt(memories.updatedAt, sixtyDaysAgo),
        ),
      )
      .returning({ id: memories.id })

    return {
      prunedEpisodes,
      staleLoopsFlagged: overdueLoops.length,
      withdrawnCleaned: withdrawnCleanedRows.length,
    }
  }
}
