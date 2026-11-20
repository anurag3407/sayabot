import { getProviderCapabilities } from "@sayabot/llm"
import type { Provider } from "@sayabot/core"
import type { LanguageModelUsage, ModelMessage } from "ai"
import { z } from "zod"
import type { ToolSpec } from "../tools/audited"

export function estimateTextTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / 3)
}

export function estimateMessageTokens(messages: ModelMessage[]): number {
  return messages.reduce(
    (sum, message) =>
      sum +
      16 +
      estimateTextTokens(
        typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      ),
    0,
  )
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback
}

export function resolveContextBudget(
  provider: string,
  params: Record<string, unknown>,
  toolTokens = 0,
) {
  const contextWindow = Math.min(
    2_000_000,
    Math.max(
      4096,
      positiveInteger(
        params.contextWindowTokens,
        getProviderCapabilities(provider as Provider).defaultContextWindow,
      ),
    ),
  )
  // Large-context models get room for long file writes (tool-call arguments are
  // output tokens) and full thinking budgets; small local models keep 4k.
  const defaultOutput = contextWindow >= 100_000 ? 16_384 : 4096
  const outputTokens = Math.min(
    Math.floor(contextWindow / 2),
    positiveInteger(params.maxOutputTokens, defaultOutput),
  )
  const safetyTokens = Math.max(1024, Math.ceil(contextWindow * 0.08))
  const inputTokens = Math.min(
    positiveInteger(params.contextBudgetTokens, contextWindow),
    contextWindow - outputTokens - safetyTokens,
  )
  const messageTokens = inputTokens - Math.max(0, toolTokens)
  if (messageTokens < 1024)
    throw new Error(
      "Tool definitions leave insufficient context for this model. Reduce active tools or configure the model's contextWindowTokens.",
    )
  return { contextWindow, outputTokens, inputTokens, messageTokens, toolTokens, safetyTokens }
}

export function estimateToolTokens(specs: ToolSpec[]): number {
  return specs.reduce((total, spec) => {
    let schema: unknown
    try {
      schema = z.toJSONSchema(spec.schema, { unrepresentable: "any" })
    } catch {
      schema = spec.schema
    }
    return (
      total +
      estimateTextTokens(
        JSON.stringify({ name: spec.name, description: spec.description, schema }),
      ) +
      16
    )
  }, 0)
}

export class CacheMetrics {
  private inputTokens = 0
  private outputTokens = 0
  private reportedInputTokens = 0
  private cacheReadTokens = 0
  private cacheWriteTokens = 0
  private calls = 0
  private reportedCalls = 0

  record(usage: LanguageModelUsage): void {
    const input = usage.inputTokens ?? 0
    const read = usage.inputTokenDetails?.cacheReadTokens
    this.calls++
    this.inputTokens += input
    this.outputTokens += usage.outputTokens ?? 0
    if (typeof read === "number" && Number.isFinite(read) && read >= 0 && read <= input) {
      this.reportedCalls++
      this.reportedInputTokens += input
      this.cacheReadTokens += read
    }
    this.cacheWriteTokens += usage.inputTokenDetails?.cacheWriteTokens ?? 0
  }

  snapshot() {
    return {
      calls: this.calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      reportedCalls: this.reportedCalls,
      cacheReadRatio:
        this.reportedInputTokens > 0 ? this.cacheReadTokens / this.reportedInputTokens : null,
      completeReporting: this.calls > 0 && this.reportedCalls === this.calls,
    }
  }
}
