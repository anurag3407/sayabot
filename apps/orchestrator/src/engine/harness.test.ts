import { beforeEach, describe, expect, it, vi } from "vitest"
import { tool } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import { z } from "zod"
import { RunEvidence } from "./evidence"
import { runEngineTurn } from "./run"
import type { RunLlmTurnArgs } from "../runner/llm"

const state = vi.hoisted(() => ({
  model: undefined as any,
  tools: {} as any,
  specs: [] as any[],
  evidence: undefined as any,
  updates: [] as any[],
  inserts: [] as any[],
  events: [] as any[],
  nextId: 0,
}))

vi.mock("../db", () => ({ getDb: () => ({
  insert: () => ({ values: (value: unknown) => {
    state.inserts.push(value)
    return { returning: async () => [{ id: `row-${++state.nextId}`, metadata: {} }], then: (resolve: (value: unknown) => void) => Promise.resolve(resolve(undefined)) }
  } }),
  update: () => ({ set: (value: unknown) => ({ where: async () => { state.updates.push(value) } }) }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
}) }))
vi.mock("../runner/llm", () => ({
  resolveAgentModel: async () => ({ model: state.model, provider: "openai-compatible", modelName: "test-model" }),
  resolveEffortLevel: () => undefined,
}))
vi.mock("../runner/context", () => ({
  loadConversation: async () => [], loadCanvasContext: async () => "", loadTaskContext: async () => "", loadTaskBriefContext: async () => "",
}))
vi.mock("../tools", () => ({ buildTools: async () => ({
  tools: state.tools, specs: state.specs, activeToolNames: () => undefined,
  warnings: [], close: async () => {}, verification: () => state.evidence.snapshot(),
}) }))
vi.mock("./skills", () => ({ getAvailableSkills: async () => [] }))
vi.mock("../memory/service", () => ({ getMemoryService: () => ({
  getPinnedDigest: async () => [], recall: async () => [], extractMemoriesFromTranscript: async () => {}, getActiveLoops: async () => [],
}) }))
vi.mock("../realtime", () => ({ broadcast: async (_room: string, event: unknown) => { state.events.push(event) } }))

const args = (params: Record<string, unknown> = {}): RunLlmTurnArgs => ({
  agent: { id: "agent", handle: "helper", displayName: "Helper", capabilities: {}, params, systemPrompt: "" },
  room: { id: "room", orgId: "org", name: "work", systemDirective: "" },
  trigger: { id: "trigger", content: "Fix the bug and verify it" },
  sessionId: "session", step: 0, role: "responder", threadRootId: null,
} as RunLlmTurnArgs)

function installTool(name: string, execute: () => Promise<unknown>) {
  const spec = state.evidence.wrap({ name, description: name, schema: z.object({}), dangerous: false, execute })
  state.specs.push(spec)
  state.tools[name] = tool({ inputSchema: spec.schema, execute: spec.execute })
}

function model(actions: Array<string | { tool: string }>, prompts: any[] = []) {
  let call = 0
  return new MockLanguageModelV4({
    doStream: async (options: any) => {
      prompts.push(options.prompt)
      const action = actions[call++] ?? "No additional action"
      const chunks: any[] = [{ type: "stream-start", warnings: [] }]
      if (typeof action === "string") chunks.push({ type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: action }, { type: "text-end", id: "text" })
      else chunks.push({ type: "tool-call", toolCallId: `call-${call}`, toolName: action.tool, input: "{}" })
      chunks.push({ type: "finish", finishReason: { unified: typeof action === "string" ? "stop" : "tool-calls", raw: "stop" }, usage: { inputTokens: { total: 1000, noCache: 200, cacheRead: 800, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } } })
      return { stream: new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close() } }) }
    },
  } as any)
}

beforeEach(() => {
  state.tools = {}
  state.specs = []
  state.evidence = new RunEvidence()
  state.updates = []
  state.inserts = []
  state.events = []
  state.nextId = 0
})

describe("live engine loop with a scripted provider", () => {
  it("forces verification after an edit and records real cache usage", async () => {
    installTool("fs_edit", async () => ({ ok: true }))
    installTool("verify_workspace", async () => ({ passed: true, checks: [{ kind: "test", command: "pnpm test", cwd: "/repo", exitCode: 0, durationMs: 10 }] }))
    const prompts: any[] = []
    state.model = model([{ tool: "fs_edit" }, "Done", { tool: "verify_workspace" }, "Verified"], prompts)
    const result = await runEngineTurn(args())
    expect(result.error).toBeNull()
    expect(prompts).toHaveLength(4)
    expect(JSON.stringify(prompts[2]).includes("Prose is not execution evidence")).toBe(true)
    const finalMessage = state.updates.find((update) => update.metadata?.harness)
    expect(finalMessage.metadata.harness.verification.status).toBe("passed")
    expect(finalMessage.metadata.harness.cache).toMatchObject({ calls: 4, inputTokens: 4000, cacheReadRatio: 0.8 })
    expect(state.inserts.find((insert) => insert.cachedInputTokens !== undefined)?.cachedInputTokens).toBe(3200)
  })

  it("nudges once, then flags an unverified completion claim without failing the turn", async () => {
    installTool("fs_write", async () => ({ ok: true }))
    const prompts: unknown[] = []
    state.model = model([{ tool: "fs_write" }, "Done", "Done", "Done"], prompts)
    const result = await runEngineTurn(args())
    expect(result.error).toBeNull()
    expect(JSON.stringify(prompts)).toContain("verify_workspace")
    const finalMessage = state.updates.find((update) => update.metadata?.harness)
    expect(finalMessage.metadata.harness.verification.status).toBe("pending")
    expect(finalMessage.metadata.warnings.join()).toContain("unverified")
  })

  it("does not report a tool-step limit as completed work", async () => {
    installTool("fs_read", async () => ({ content: "file" }))
    state.model = model([{ tool: "fs_read" }])
    const result = await runEngineTurn(args({ maxSteps: 1 }))
    expect(result.error).toContain("Step limit")
  })

  it("retains prior tool pairs exactly once across steps", async () => {
    installTool("fs_read", async () => ({ content: "file" }))
    const prompts: any[] = []
    state.model = model([{ tool: "fs_read" }, { tool: "fs_read" }, "Answer"], prompts)
    const result = await runEngineTurn(args())
    expect(result.error).toBeNull()
    const final = prompts[2] as Array<{ role: string; content: any[] }>
    const calls = final.filter((message) => message.role === "assistant").flatMap((message) => message.content).filter((part) => part.type === "tool-call")
    expect(calls.map((call) => call.toolCallId)).toEqual(["call-1", "call-2"])
  })
})
