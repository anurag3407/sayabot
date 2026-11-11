import { generateText, stepCountIs, type ToolSet } from "ai"
import { z } from "zod"
import type { AgentRow } from "../runner/context"
import { resolveAgentCheapModel } from "../runner/llm"
import { toAuditedTools, type ToolSpec } from "../tools/audited"
import { recordUsageEvent, tokensFrom } from "../usage"
import { READ_ONLY_TOOL_NAMES } from "./subagents"

export type VerifyMode = "off" | "self" | "critic"

export function getVerifyMode(params: Record<string, unknown> | null | undefined): VerifyMode {
  if (!params) return "self"
  const val = params.verify
  if (val === "off" || val === "self" || val === "critic") return val
  return "self"
}

export function buildSelfVerificationPrompt(taskBrief?: string): string {
  const requirementsContext = taskBrief ? `\nTask requirements:\n${taskBrief}\n` : ""
  return [
    "Verification checklist before concluding:",
    requirementsContext,
    "1. Re-read the initial prompt and task requirements.",
    "2. For each requirement, verify and provide concrete evidence that it is completely met.",
    "3. If files, code, or canvas artifacts were modified, confirm that tests or linters were run and passed without regressions.",
    "4. If any item is incomplete or broken, fix it now.",
    "5. Once fully verified, output your clear final conclusion.",
  ]
    .filter(Boolean)
    .join("\n")
}

export interface CriticReviewArgs {
  agent: AgentRow
  orgId: string
  roomId: string
  taskBrief: string
  proposedOutput: string
  availableToolSpecs?: ToolSpec[]
  cycle: number
  signal?: AbortSignal
  scrub?: (value: string) => string
}

export interface CriticReviewResult {
  pass: boolean
  reasons: string[]
  feedback?: string
}

const criticResponseSchema = z.object({
  pass: z.boolean().describe("Whether the proposed work satisfies all task requirements"),
  reasons: z.array(z.string()).describe("List of reasons or missing requirements if not passing"),
  feedback: z.string().optional().describe("Actionable feedback for the agent to fix issues"),
})

export async function runCriticVerification(args: CriticReviewArgs): Promise<CriticReviewResult> {
  if (args.cycle >= 2) {
    return {
      pass: false,
      reasons: ["Verification remains unresolved after the revision limit (2). Human review is required."],
    }
  }

  try {
  const resolved = await resolveAgentCheapModel(args.agent)
  const allowedSpecs = (args.availableToolSpecs ?? []).filter((s) => READ_ONLY_TOOL_NAMES.has(s.name))

  const criticTools: ToolSet = toAuditedTools(allowedSpecs, {
    orgId: args.orgId,
    roomId: args.roomId,
    agentId: args.agent.id,
    runId: null,
    messageId: null,
    scrub: args.scrub,
  })

    const result = await generateText({
      model: resolved.model,
      system: [
        "You are an impartial, rigorous critic evaluating an agent's completed work against its task requirements.",
        "Your job is to verify whether the work actually satisfies what was asked.",
        "You have read-only tools to inspect files, git status, and canvas if necessary.",
        "Be constructive: if rejecting, clearly explain what is missing or incorrect.",
        "Format your answer as JSON with: { \"pass\": boolean, \"reasons\": string[], \"feedback\": string }",
      ].join("\n"),
      prompt: [
        `Task Requirements:`,
        args.taskBrief,
        `\nProposed Output/Work from Agent:`,
        args.proposedOutput,
        `\nEvaluate whether the requirements are satisfied. Reply ONLY with valid JSON matching the format.`,
      ].join("\n"),
      tools: criticTools,
      stopWhen: stepCountIs(6),
      abortSignal: args.signal,
      maxOutputTokens: 2048,
    })

    await recordUsageEvent({
      orgId: args.orgId,
      roomId: args.roomId,
      agentId: args.agent.id,
      provider: resolved.provider,
      model: resolved.modelName,
      tokens: tokensFrom(result.totalUsage),
      kind: "verify",
    })
    const cleaned = result.text.trim().replace(/^```json\s*/, "").replace(/\s*```$/, "")
    const parsed = JSON.parse(cleaned)
    const validated = criticResponseSchema.parse(parsed)
    return {
      pass: validated.pass,
      reasons: validated.reasons,
      feedback: validated.feedback,
    }
  } catch (err) {
    return {
      pass: false,
      reasons: [`Critic could not verify the work: ${err instanceof Error ? err.message : String(err)}`],
    }
  }
}
