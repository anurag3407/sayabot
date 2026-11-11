import { generateText } from "ai"
import { and, eq, inArray, lt } from "drizzle-orm"
import { memories, openLoops } from "@sayabot/db"
import type { AgentRow } from "../../runner/context"
import { resolveAgentCheapModel } from "../../runner/llm"
import { recordUsageEvent, tokensFrom } from "../../usage"
import type { EpistemicStatus } from "../types"
import { BeliefEngine } from "./beliefs"
import { MemoryGraphEngine } from "./graph"
import { OpenLoopsManager } from "./open-loops"
import { calculateRetention } from "./salience"

export interface DreamInsight {
  beliefs: Array<{
    title: string
    body: string
    kind: "fact" | "preference" | "decision"
    epistemicStatus: EpistemicStatus
    confidence: number
    emotionalSalience: number
    perspective: string
    tags: string[]
    wikilinks?: string[]
  }>
  openLoops: Array<{
    description: string
    dueInHours?: number
  }>
}

export interface DreamConsolidationResult {
  prunedEpisodes: number
  withdrawnCleaned: number
  staleLoopsFlagged: number
}

/**
 * Autonomous Consolidation Engine ("Dream / Sleep Cycle")
 * Synthesizes long-term semantic knowledge from episodic transcripts,
 * detects open commitments, and prunes decaying episodic memories according to the Ebbinghaus curve.
 */
export class DreamEngine {
  private beliefEngine: BeliefEngine
  private openLoopsManager: OpenLoopsManager
  private graphEngine: MemoryGraphEngine

  constructor(private db: any) {
    this.beliefEngine = new BeliefEngine(db)
    this.openLoopsManager = new OpenLoopsManager(db)
    this.graphEngine = new MemoryGraphEngine(db)
  }

  /**
   * Analyzes an interaction transcript and extracts high-value beliefs, epistemic updates,
   * and open commitments made during the turn.
   */
  async extractCognitiveInsights(args: {
    orgId: string
    transcriptText: string
    agent: AgentRow
    roomId?: string | null
  }): Promise<DreamInsight> {
    if (!args.transcriptText || args.transcriptText.length < 50) {
      return { beliefs: [], openLoops: [] }
    }

    try {
      const resolved = await resolveAgentCheapModel(args.agent)
      const prompt = `Transcript:\n${args.transcriptText.slice(0, 3500)}\n\nExtract cognitive beliefs and open loops:`

      const result = await generateText({
        model: resolved.model,
        system:
          "You are a cognitive memory consolidator for an AI agent. Extract durable memories and commitments from the transcript.\n" +
          "Return ONLY valid JSON matching this schema:\n" +
          "{\n" +
          '  "beliefs": [\n' +
          '    { "title": string, "body": string, "kind": "fact"|"preference"|"decision", "epistemicStatus": "verified"|"belief"|"hypothesis", "confidence": number, "emotionalSalience": number, "perspective": "first_person"|"third_person", "tags": string[] }\n' +
          "  ],\n" +
          '  "openLoops": [\n' +
          '    { "description": string, "dueInHours": number }\n' +
          "  ]\n" +
          "}\n" +
          "Limit to at most 3 beliefs and 2 open loops. Ignore fleeting status chatter.",
        prompt,
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
      const cleaned = result.text.trim().replace(/^```json\s*/, "").replace(/\s*```$/, "")
      const parsed = JSON.parse(cleaned) as DreamInsight

      return {
        beliefs: Array.isArray(parsed.beliefs) ? parsed.beliefs : [],
        openLoops: Array.isArray(parsed.openLoops) ? parsed.openLoops : [],
      }
    } catch {
      return { beliefs: [], openLoops: [] }
    }
  }

  /**
   * Applies the extracted cognitive insights directly into the memory layers.
   */
  async applyInsights(args: {
    orgId: string
    agentId: string
    roomId?: string | null
    insights: DreamInsight
  }): Promise<{ beliefsSaved: number; loopsSaved: number }> {
    let beliefsSaved = 0
    let loopsSaved = 0

    // Save beliefs
    for (const b of args.insights.beliefs) {
      if (!b.title || !b.body) continue

      const saved = await this.beliefEngine.assertBelief({
        orgId: args.orgId,
        scope: args.roomId ? "room" : "agent",
        agentId: args.agentId,
        roomId: args.roomId,
        title: b.title,
        body: b.body,
        tags: b.tags,
        epistemicStatus: b.epistemicStatus ?? "belief",
        confidence: typeof b.confidence === "number" ? b.confidence : 0.85,
        emotionalSalience: typeof b.emotionalSalience === "number" ? b.emotionalSalience : 0.5,
        perspective: b.perspective ?? "first_person",
        createdByAgentId: args.agentId,
      })

      // Link any wikilinks in the body
      await this.graphEngine.syncLinks({
        orgId: args.orgId,
        sourceMemoryId: saved.id,
        bodyText: b.body,
      })

      beliefsSaved++
    }

    // Save open loops
    for (const l of args.insights.openLoops) {
      if (!l.description) continue

      const dueAt =
        typeof l.dueInHours === "number" && l.dueInHours > 0
          ? new Date(Date.now() + l.dueInHours * 60 * 60 * 1000)
          : null

      await this.openLoopsManager.createOpenLoop({
        orgId: args.orgId,
        agentId: args.agentId,
        roomId: args.roomId,
        description: l.description,
        dueAt,
      })

      loopsSaved++
    }

    return { beliefsSaved, loopsSaved }
  }

  /**
   * Performs dream consolidation:
   * 1. Evaluates episodic memories using Ebbinghaus decay curve and prunes decayed items (retention < 0.15).
   * 2. Flags overdue open loops as blocked if past their due date.
   * 3. Purges withdrawn memories older than 60 days.
   */
  async dreamConsolidate(orgId: string): Promise<DreamConsolidationResult> {
    const now = new Date()

    // 1. Fetch candidate episodic memories to evaluate decay
    const candidateEpisodes = await this.db
      .select({
        id: memories.id,
        createdAt: memories.createdAt,
        lastUsedAt: memories.lastUsedAt,
        useCount: memories.useCount,
        decayHalfLifeDays: memories.decayHalfLifeDays,
      })
      .from(memories)
      .where(and(eq(memories.orgId, orgId), eq(memories.kind, "episode"), eq(memories.pinned, false)))
      .limit(200)

    const episodeIdsToPrune: string[] = []

    for (const ep of candidateEpisodes) {
      const retention = calculateRetention({
        createdAt: ep.createdAt,
        lastUsedAt: ep.lastUsedAt,
        useCount: ep.useCount,
        decayHalfLifeDays: ep.decayHalfLifeDays,
        now,
      })

      // If memory retention dropped below 0.15 and is older than 14 days, prune it
      const ageDays = (now.getTime() - ep.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      if (retention < 0.15 && ageDays > 14) {
        episodeIdsToPrune.push(ep.id)
      }
    }

    let prunedEpisodes = 0
    if (episodeIdsToPrune.length > 0) {
      const deleted = await this.db
        .delete(memories)
        .where(and(eq(memories.orgId, orgId), inArray(memories.id, episodeIdsToPrune)))
        .returning({ id: memories.id })
      prunedEpisodes = deleted.length
    }

    // 2. Mark overdue open loops as blocked
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

    // 3. Purge withdrawn memories older than 60 days
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
