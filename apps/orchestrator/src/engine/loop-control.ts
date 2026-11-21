import type { ModelMessage, UserModelMessage } from "ai"
import type { RunInterrupt } from "../active-runs"
import { elideOldToolResults } from "./compaction"
import { estimateMessageTokens } from "./budget"

/**
 * Pure helpers that drive the Engine v2 agent loop between steps. Everything in
 * here is deterministic so it can be unit tested without a model or database.
 */

/** Rough token estimate (~4 chars/token) used for context budgeting. */
export function estimateTokens(messages: ModelMessage[]): number {
  return estimateMessageTokens(messages)
}

export interface StepToolCall {
  toolName: string
  input?: unknown
}

export interface StepLike {
  toolCalls?: StepToolCall[]
}

function callSignature(call: StepToolCall): string {
  let input: string
  try {
    input = JSON.stringify(call.input ?? null)
  } catch {
    input = String(call.input)
  }
  return `${call.toolName}:${input}`
}

export const REPEAT_THRESHOLD = 3
const SHELL_TOOLS = new Set(["terminal_exec", "code_sandbox", "computer_shell"])
export const SHELL_STREAK = 8

/** True when the last N steps are only shell or sandbox calls. Different commands still count. */
export function detectShellStreak(steps: StepLike[], threshold = SHELL_STREAK): boolean {
  if (steps.length < threshold) return false
  return steps.slice(-threshold).every((step) => {
    const names = (step.toolCalls ?? []).map((call) => call.toolName)
    return names.length > 0 && names.every((name) => SHELL_TOOLS.has(name))
  })
}

/**
 * Detects a doom loop: the same tool called with identical input in each of the
 * last N steps. Returns the repeated tool name, or null when progress looks real.
 */
export function detectRepeatedToolCalls(
  steps: StepLike[],
  threshold = REPEAT_THRESHOLD,
): string | null {
  if (steps.length < threshold) return null
  const recent = steps.slice(-threshold)
  const signatures = recent.map((s) => (s.toolCalls ?? []).map(callSignature).sort().join("|"))
  const first = signatures[0]
  if (!first) return null
  if (signatures.every((sig) => sig === first)) {
    return recent[0]?.toolCalls?.[0]?.toolName ?? null
  }
  return null
}

/** True once the model has called update_plan at least once in this run. */
export function hasPlan(steps: StepLike[]): boolean {
  return steps.some((s) => (s.toolCalls ?? []).some((c) => c.toolName === "update_plan"))
}

export function systemReminder(text: string): UserModelMessage {
  return { role: "user", content: `<system-reminder>\n${text}\n</system-reminder>` }
}

export function steeringMessage(interrupts: RunInterrupt[]): UserModelMessage {
  const body = interrupts
    .map((i) => i.content.trim())
    .filter(Boolean)
    .join("\n\n")
  return {
    role: "user",
    content:
      "<steering>\nA human in the room sent this while you were working. " +
      "Take it into account from this step on; it overrides earlier instructions where they conflict.\n\n" +
      body +
      "\n</steering>",
  }
}

export interface PrepareStepInput {
  messages: ModelMessage[]
  steps: StepLike[]
  stepNumber: number
  maxSteps: number
  interrupts: RunInterrupt[]
  contextBudgetTokens: number
  planToolAvailable: boolean
  /** Reminders already sent this run, so each fires at most once (except doom-loop). */
  sentReminders: Set<string>
}

export interface PrepareStepDecision {
  messages?: ModelMessage[]
  reminders: string[]
  steered: boolean
  elidedCount: number
}

/**
 * Decides what (if anything) to change before the next model call:
 * 1. Fold in human steering messages that arrived mid-run.
 * 2. Elide old tool results when the transcript nears the context budget.
 * 3. Nudge on doom loops, missing plans, and approaching the step limit.
 */
export function decidePrepareStep(input: PrepareStepInput): PrepareStepDecision {
  let messages = input.messages
  let changed = false
  const reminders: string[] = []
  let elidedCount = 0

  if (input.interrupts.length > 0) {
    messages = [...messages, steeringMessage(input.interrupts)]
    changed = true
  }

  if (estimateTokens(messages) > input.contextBudgetTokens * 0.7) {
    const elided = elideOldToolResults(messages, 6)
    if (elided.elidedCount > 0) {
      messages = elided.messages
      elidedCount = elided.elidedCount
      changed = true
    }
  }

  const repeated = detectRepeatedToolCalls(input.steps)
  if (!repeated && detectShellStreak(input.steps) && !input.sentReminders.has("shell-streak")) {
    input.sentReminders.add("shell-streak")
    reminders.push(
      "You have spent many steps on shell and sandbox commands. Stop. Write the deliverable with canvas_create or canvas_write, or reply with what is done and what is blocked. Do not try another cloud sandbox after a missing token.",
    )
  }
  if (repeated) {
    reminders.push(
      `You have called ${repeated} with identical input ${REPEAT_THRESHOLD} times in a row and got the same result. ` +
        "Stop repeating it. Change your approach, read the error carefully, or explain to the room what is blocking you.",
    )
  }

  if (
    input.planToolAvailable &&
    input.stepNumber > 8 &&
    !hasPlan(input.steps) &&
    !input.sentReminders.has("plan")
  ) {
    input.sentReminders.add("plan")
    reminders.push(
      "This task is taking many steps. Call update_plan with a short checklist of the remaining work so progress stays visible to the room.",
    )
  }

  const remaining = input.maxSteps - input.stepNumber
  if (remaining <= 2 && remaining >= 0 && !input.sentReminders.has("budget")) {
    input.sentReminders.add("budget")
    reminders.push(
      `You have ${remaining + 1} step(s) left in this turn. Wrap up now: finish the current action, then write a final reply summarising what was done and what remains.`,
    )
  }

  if (reminders.length > 0) {
    messages = [...messages, systemReminder(reminders.join("\n\n"))]
    changed = true
  }

  return {
    ...(changed ? { messages } : {}),
    reminders,
    steered: input.interrupts.length > 0,
    elidedCount,
  }
}

export const MODEL_OUTPUT_CHAR_LIMIT = 40_000
const STRING_FIELD_LIMIT = 16_000

const DIAGNOSTIC_LINE =
  /\b(error|exception|traceback|panic|fatal|failed|assertionerror|expected|received)\b|^\s+at .+[:(]\d+/i

export function foldOutput(value: string, limit: number): string {
  if (value.length <= limit) return value
  const lines = value.split("\n")
  const diagnostics: string[] = []
  const included = new Set<number>()
  let diagnosticChars = 0
  const diagnosticBudget = Math.floor(limit * 0.35)
  for (let i = 0; i < lines.length && diagnosticChars < diagnosticBudget; i++) {
    if (!DIAGNOSTIC_LINE.test(lines[i]!)) continue
    for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 2); j++) {
      if (included.has(j)) continue
      const line = `${j + 1} | ${lines[j]}`.slice(
        0,
        Math.max(0, diagnosticBudget - diagnosticChars),
      )
      if (!line) break
      diagnostics.push(line)
      diagnosticChars += line.length + 1
      included.add(j)
    }
  }
  const excerpt = diagnostics.length ? `\n[Diagnostic excerpts]\n${diagnostics.join("\n")}\n` : ""
  const marker = `\n[... characters truncated from ${value.length}-character output ...]\n`
  const remaining = Math.max(0, limit - excerpt.length - marker.length)
  const head = Math.floor(remaining * 0.65)
  const tail = remaining - head
  return `${value.slice(0, head)}${excerpt}${marker}${tail ? value.slice(-tail) : ""}`.slice(
    0,
    limit,
  )
}

function truncateDeep(value: unknown, limit: number, depth = 0): unknown {
  if (typeof value === "string") return foldOutput(value, limit)
  if (depth > 6) return "[nested output omitted]"
  if (Array.isArray(value)) {
    const capped = value.slice(0, 200).map((v) => truncateDeep(v, limit, depth + 1))
    if (value.length > 200) capped.push(`[... ${value.length - 200} more items truncated ...]`)
    return capped
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        truncateDeep(v, limit, depth + 1),
      ]),
    )
  }
  return value
}

/**
 * Bounds what a tool result can cost in context. Long strings keep their head
 * and tail (errors usually live at the end of logs); oversized results that
 * still don't fit are replaced with a preview.
 */
export function capToolOutputForModel(value: unknown, limit = MODEL_OUTPUT_CHAR_LIMIT): unknown {
  let json: string
  try {
    json = JSON.stringify(value) ?? "null"
  } catch {
    return { error: "Tool output was not serializable" }
  }
  if (!Number.isFinite(limit) || limit < 128)
    throw new Error("Output limit must be at least 128 characters")
  if (json.length <= limit) return value
  const truncated = truncateDeep(value, Math.min(STRING_FIELD_LIMIT, Math.floor(limit / 2)))
  const truncatedJson = JSON.stringify(truncated) ?? "null"
  if (truncatedJson.length <= limit) return truncated
  const envelope = { truncated: true, originalChars: json.length, preview: "" }
  let low = 0
  let high = limit
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const preview = foldOutput(truncatedJson, middle)
    if (JSON.stringify({ ...envelope, preview }).length <= limit) low = middle
    else high = middle - 1
  }
  return { ...envelope, preview: foldOutput(truncatedJson, low) }
}

/** Joins step texts with a paragraph break so "Let me check" + "Done" doesn't read "Let me checkDone". */
export function needsStepSeparator(previous: string, next: string): boolean {
  if (!previous || !next) return false
  return !/\s$/.test(previous) && !/^\s/.test(next)
}
