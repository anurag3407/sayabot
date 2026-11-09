import type { ModelMessage, ToolModelMessage, UserModelMessage } from "ai"

export interface CompactedSummary {
  goal: string
  decisions: string[]
  filesTouched: string[]
  openQuestions: string[]
  planStatus: string
  factsLearned: string[]
  activeMode?: string
  pendingVerifications?: string[]
}

export interface CompactTranscriptArgs {
  messages: ModelMessage[]
  keepLastKTools?: number
  summary?: CompactedSummary
  protectedPrefixCount?: number
  keepLastMessages?: number
}

export interface CompactTranscriptResult {
  messages: ModelMessage[]
  elidedCount: number
  compactedThroughIdx: number
  extractedFacts: string[]
}

export const ELIDED_PREFIX = "[result elided:"

function summarizeToolOutcome(output: unknown): string {
  if (!output || typeof output !== "object") return "output omitted, success not inferred"
  const wrapped = output as { type?: string; value?: unknown }
  if (wrapped.type?.startsWith("error")) return `failed: ${String(wrapped.value).slice(0, 240)}`
  if (wrapped.value && typeof wrapped.value === "object") {
    const value = wrapped.value as Record<string, unknown>
    const exit = value.exit_code ?? value.exitCode
    if (value.ok === false || value.error || (typeof exit === "number" && exit !== 0)) {
      return `failed: ${String(value.error ?? `exit ${exit}`).slice(0, 240)}`
    }
    if (exit === 0) return "exit 0"
  }
  return "output omitted, success not inferred"
}

export function compactionBoundary(messages: ModelMessage[], protectedPrefixCount = 0, keepLastMessages = 8): number {
  let boundary = Math.max(protectedPrefixCount, messages.length - keepLastMessages)
  const callLocations = new Map<string, number>()
  messages.forEach((message, index) => {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const part of message.content) if (part.type === "tool-call") callLocations.set(part.toolCallId, index)
    }
  })
  for (let index = boundary; index < messages.length; index++) {
    const message = messages[index]!
    if (message.role !== "tool") continue
    for (const part of message.content) {
      if (part.type !== "tool-result") continue
      const callIndex = callLocations.get(part.toolCallId)
      if (callIndex !== undefined && callIndex >= protectedPrefixCount && callIndex < boundary) boundary = callIndex
    }
  }
  return boundary
}

function isElided(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { type?: unknown }).type === "text" &&
    String((output as { value?: unknown }).value ?? "").startsWith(ELIDED_PREFIX)
  )
}

/**
 * Strategy 1: Clear old tool results.
 * Keeps the most recent K=6 tool results verbatim and elides older ones.
 */
export function elideOldToolResults(
  messages: ModelMessage[],
  keepLastK = 6,
): { messages: ModelMessage[]; elidedCount: number } {
  let toolResultCount = 0

  // Count total tool results
  for (const msg of messages) {
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      toolResultCount += msg.content.length
    }
  }

  if (toolResultCount <= keepLastK) {
    return { messages, elidedCount: 0 }
  }

  let resultsToElide = toolResultCount - keepLastK
  let elidedCount = 0

  const updatedMessages = messages.map((msg) => {
    if (msg.role !== "tool" || !Array.isArray(msg.content)) {
      return msg
    }

    const updatedContent = msg.content.map((part) => {
      if (part.type === "tool-result" && resultsToElide > 0) {
        resultsToElide--
        if (isElided(part.output)) return part
        elidedCount++
        return {
          ...part,
          output: {
            type: "text" as const,
            value: `${ELIDED_PREFIX} ${summarizeToolOutcome(part.output)}; call ${part.toolCallId}. Re-read the source or rerun the check if needed.]`,
          },
        }
      }
      return part
    })

    return {
      ...msg,
      content: updatedContent,
    } as ToolModelMessage
  })

  return { messages: updatedMessages, elidedCount }
}

/**
 * Formats a structured compacted state into a clean model message.
 */
export function formatCompactedSummary(summary: CompactedSummary): string {
  const parts = [
    `[Compacted Run Summary]`,
    `Goal: ${summary.goal}`,
  ]

  if (summary.activeMode) {
    parts.push(`Active Mode: ${summary.activeMode}`)
  }

  if (summary.decisions.length > 0) {
    parts.push(`Decisions:\n${summary.decisions.map((d) => `- ${d}`).join("\n")}`)
  }

  if (summary.filesTouched.length > 0) {
    parts.push(`Files Touched:\n${summary.filesTouched.map((f) => `- ${f}`).join("\n")}`)
  }

  if (summary.factsLearned.length > 0) {
    parts.push(`Facts Learned:\n${summary.factsLearned.map((f) => `- ${f}`).join("\n")}`)
  }

  if (summary.openQuestions.length > 0) {
    parts.push(`Open Questions:\n${summary.openQuestions.map((q) => `- ${q}`).join("\n")}`)
  }

  if (summary.pendingVerifications && summary.pendingVerifications.length > 0) {
    parts.push(`Pending Verifications:\n${summary.pendingVerifications.map((v) => `- ${v}`).join("\n")}`)
  }

  if (summary.planStatus) {
    parts.push(`Plan Status: ${summary.planStatus}`)
  }

  return parts.join("\n\n")
}

/**
 * Compacts a transcript:
 * 1. Elides old tool results past the last K=6.
 * 2. If a summary is provided, collapses messages before the active tail into one compacted summary message.
 */
export function compactTranscript(args: CompactTranscriptArgs): CompactTranscriptResult {
  const { messages: elidedMessages, elidedCount } = elideOldToolResults(
    args.messages,
    args.keepLastKTools ?? 6,
  )

  if (!args.summary) {
    return {
      messages: elidedMessages,
      elidedCount,
      compactedThroughIdx: 0,
      extractedFacts: [],
    }
  }

  const summaryText = formatCompactedSummary(args.summary)
  const summaryMessage: UserModelMessage = {
    role: "user",
    content: summaryText,
  }

  const firstNonSystem = elidedMessages.findIndex((message) => message.role !== "system")
  const protectedPrefixCount = args.protectedPrefixCount ?? (firstNonSystem < 0 ? elidedMessages.length : firstNonSystem)
  const compactedThroughIdx = compactionBoundary(elidedMessages, protectedPrefixCount, args.keepLastMessages ?? 4)
  if (compactedThroughIdx <= protectedPrefixCount) {
    return { messages: elidedMessages, elidedCount, compactedThroughIdx: 0, extractedFacts: [] }
  }
  const activeTail = elidedMessages.slice(compactedThroughIdx)

  return {
    messages: [...elidedMessages.slice(0, protectedPrefixCount), summaryMessage, ...activeTail],
    elidedCount,
    compactedThroughIdx,
    extractedFacts: args.summary.factsLearned,
  }
}
