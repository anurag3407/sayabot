import { describe, expect, it, vi } from "vitest"

vi.mock("./local-agents", () => ({ findBinary: vi.fn() }))

const { claudeArgs, codexArgs, commandFor, jobModel, localDelta } = await import("./runner")

const job = { id: "j1", prompt: "hi", app: "claude-code", agentHandle: "bot" }

describe("model and effort reach the app", () => {
  it("passes --model and --effort to Claude Code", () => {
    const args = claudeArgs({ ...job, model: "claude-opus-5-5", effort: "high" }, "/tmp/mcp.json")
    expect(args.join(" ")).toContain("--model claude-opus-5-5 --effort high")
    expect(claudeArgs(job, "/tmp/mcp.json")).not.toContain("--model")
  })

  it("passes the model and reasoning effort to Codex", () => {
    const args = codexArgs({ ...job, app: "codex", model: "gpt-6", effort: "low" })
    expect(args).toEqual(
      expect.arrayContaining(["--model", "gpt-6", "-c", 'model_reasoning_effort="low"']),
    )
  })

  it("never passes an unsafe or default model", () => {
    expect(jobModel({ model: "default" })).toBeNull()
    expect(jobModel({ model: "x; rm -rf /" })).toBeNull()
    expect(commandFor("gemini", "hi", "/tmp/x", "gemini-2.5-pro").args.slice(0, 2)).toEqual([
      "-m",
      "gemini-2.5-pro",
    ])
  })
})

describe("localDelta", () => {
  it("reads streamed chat completion lines", () => {
    expect(localDelta('data: {"choices":[{"delta":{"content":"Hel"}}]}')).toBe("Hel")
    expect(localDelta("data: [DONE]")).toBe("")
    expect(localDelta(": keep-alive")).toBe("")
  })
})
