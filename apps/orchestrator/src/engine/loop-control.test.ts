import type { ModelMessage } from "ai"
import { describe, expect, it } from "vitest"
import { replaceLiteral, shellQuote } from "../tools/builtins/computer"
import { applyRollingCacheBreakpoint } from "./context"
import {
  capToolOutputForModel,
  decidePrepareStep,
  detectRepeatedToolCalls,
  MODEL_OUTPUT_CHAR_LIMIT,
  needsStepSeparator,
} from "./loop-control"

const baseInput = {
  messages: [{ role: "user", content: "hi" }] as ModelMessage[],
  steps: [],
  stepNumber: 1,
  maxSteps: 60,
  interrupts: [],
  contextBudgetTokens: 120_000,
  planToolAvailable: true,
}

describe("detectRepeatedToolCalls", () => {
  it("flags identical calls in the last 3 steps", () => {
    const step = { toolCalls: [{ toolName: "fs_read", input: { path: "/a" } }] }
    expect(detectRepeatedToolCalls([step, step, step])).toBe("fs_read")
  })

  it("ignores calls with different inputs", () => {
    const steps = [1, 2, 3].map((n) => ({
      toolCalls: [{ toolName: "fs_read", input: { path: `/a${n}` } }],
    }))
    expect(detectRepeatedToolCalls(steps)).toBeNull()
  })

  it("ignores text-only steps", () => {
    expect(detectRepeatedToolCalls([{}, {}, {}])).toBeNull()
  })
})

describe("decidePrepareStep", () => {
  it("returns no override when nothing needs to change", () => {
    const decision = decidePrepareStep({ ...baseInput, sentReminders: new Set() })
    expect(decision.messages).toBeUndefined()
    expect(decision.reminders).toEqual([])
  })

  it("folds steering messages into the prompt", () => {
    const decision = decidePrepareStep({
      ...baseInput,
      interrupts: [{ messageId: "m1", content: "use postgres instead" }],
      sentReminders: new Set(),
    })
    expect(decision.steered).toBe(true)
    const last = decision.messages?.at(-1)
    expect(last?.role).toBe("user")
    expect(String(last?.content)).toContain("use postgres instead")
  })

  it("nudges for a plan once after 8 steps", () => {
    const sent = new Set<string>()
    const first = decidePrepareStep({ ...baseInput, stepNumber: 9, sentReminders: sent })
    expect(first.reminders.join()).toContain("update_plan")
    const second = decidePrepareStep({ ...baseInput, stepNumber: 10, sentReminders: sent })
    expect(second.reminders.join()).not.toContain("update_plan")
  })

  it("skips the plan nudge once a plan exists", () => {
    const decision = decidePrepareStep({
      ...baseInput,
      stepNumber: 9,
      steps: [{ toolCalls: [{ toolName: "update_plan", input: {} }] }],
      sentReminders: new Set(),
    })
    expect(decision.reminders.join()).not.toContain("update_plan")
  })

  it("warns when the step budget is nearly spent", () => {
    const decision = decidePrepareStep({
      ...baseInput,
      stepNumber: 58,
      planToolAvailable: false,
      sentReminders: new Set(),
    })
    expect(decision.reminders.join()).toContain("Wrap up")
  })

  it("elides old tool results when over the context budget", () => {
    const messages: ModelMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: `c${i}`,
          toolName: "fs_read",
          output: { type: "text", value: "x".repeat(4_000) },
        },
      ],
    }))
    const decision = decidePrepareStep({
      ...baseInput,
      messages,
      contextBudgetTokens: 5_000,
      sentReminders: new Set(),
    })
    expect(decision.elidedCount).toBe(4)
    const first = decision.messages?.[0] as any
    expect(first.content[0].output.type).toBe("text")
    expect(first.content[0].output.value).toContain("[result elided:")
  })
})

describe("capToolOutputForModel", () => {
  it("passes small results through untouched", () => {
    const value = { stdout: "ok", exit_code: 0 }
    expect(capToolOutputForModel(value)).toBe(value)
  })

  it("retains diagnostics buried in the middle of long logs", () => {
    const output = Array.from({ length: 5000 }, (_, i) =>
      i === 2500
        ? "src/auth.ts(42,7): error TS2322: string is not assignable to number"
        : `progress ${i}: building module`,
    ).join("\n")
    const result = capToolOutputForModel({ stdout: output, exit_code: 1 })
    expect(JSON.stringify(result)).toContain("error TS2322")
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(MODEL_OUTPUT_CHAR_LIMIT)
  })

  it("honors small custom budgets including JSON envelope overhead", () => {
    const result = capToolOutputForModel({ rows: Array(1000).fill({ text: "x".repeat(500) }) }, 500)
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(500)
  })

  it("keeps head and tail of long strings", () => {
    const stdout = "HEAD" + "x".repeat(100_000) + "TAIL"
    const capped = capToolOutputForModel({ stdout, exit_code: 1 }) as {
      stdout: string
      exit_code: number
    }
    expect(capped.exit_code).toBe(1)
    expect(capped.stdout.startsWith("HEAD")).toBe(true)
    expect(capped.stdout.endsWith("TAIL")).toBe(true)
    expect(capped.stdout).toContain("characters truncated")
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(MODEL_OUTPUT_CHAR_LIMIT)
  })
})

describe("needsStepSeparator", () => {
  it("adds a break between glued step texts only", () => {
    expect(needsStepSeparator("Let me check.", "Found it")).toBe(true)
    expect(needsStepSeparator("Let me check.\n", "Found it")).toBe(false)
    expect(needsStepSeparator("", "Found it")).toBe(false)
  })
})

describe("applyRollingCacheBreakpoint", () => {
  it("keeps exactly one rolling breakpoint on the last non-system message", () => {
    const cache = { anthropic: { cacheControl: { type: "ephemeral" } } }
    const messages: ModelMessage[] = [
      { role: "system", content: "s1", providerOptions: cache },
      { role: "user", content: "u1", providerOptions: cache },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ]
    const out = applyRollingCacheBreakpoint(messages, "anthropic")
    expect(out[0]?.providerOptions).toEqual(cache)
    expect(out[1]?.providerOptions).toEqual({})
    expect(out[2]?.providerOptions).toBeUndefined()
    expect(out[3]?.providerOptions).toEqual(cache)
  })

  it("is a no-op for providers without prompt caching", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "u1" }]
    expect(applyRollingCacheBreakpoint(messages, "openai")).toBe(messages)
  })
})

describe("computer tool helpers", () => {
  it("replaceLiteral does not interpret $ patterns", () => {
    expect(replaceLiteral("a = 1", "1", "$&$1", false)).toBe("a = $&$1")
    expect(replaceLiteral("x x", "x", "$'", true)).toBe("$' $'")
  })

  it("shellQuote survives embedded quotes", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })
})
