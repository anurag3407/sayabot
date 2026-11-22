import { describe, expect, it } from "vitest"
import type { ModelMessage } from "ai"
import type { AgentRow, ContextMessage, RoomRow } from "../runner/context"
import {
  applyRollingCacheBreakpoint,
  applyToolCacheBreakpoint,
  buildEngineContext,
  computeCanvasDiffSummary,
  sortToolSpecs,
} from "./context"

const mockAgent: AgentRow = {
  id: "agent-123",
  orgId: "org-1",
  handle: "coder",
  displayName: "Coder Bot",
  avatar: null,
  systemPrompt: "You are an expert full-stack engineer.",
  capabilities: {
    computer: { profile: "standard" },
    tasks: true,
    canvas: true,
    sandbox: false,
    webSearch: false,
    document: true,
    github: false,
    postgres: false,
    mcp: true,
    secrets: false,
    memory: true,
    subagents: true,
    cron: true,
    connectors: true,
    storage: false,
  },
  kind: "llm",
  providerKeyId: null,
  model: "claude-3-7-sonnet-20250219",
  toolIds: [],
  webhookUrl: null,
  webhookSecretEnc: null,
  templateId: null,
  ownerUserId: null,
  visibility: "org",
  bio: null,
  params: {
    engine: "v2",
    maxSteps: 60,
  },
  lastSeenAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
}

const mockRoom: RoomRow = {
  id: "room-abc",
  orgId: "org-1",
  name: "general",
  systemDirective: "We build high-performance distributed systems.",
  turnMode: "mentions",
  dailyBudgetUsd: 50.0,
  turnCap: 3,
  rpmLimit: null,
  moderatorAgentId: null,
  debateOrder: [],
  timezone: "UTC",
  executionMode: "ask_risky",
  executionModeSetBy: null,
  agentDmUserId: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  kind: "public",
  createdBy: null,
  agentDmAgentId: null,
}

const mockHistory: ContextMessage[] = [
  {
    id: "msg-1",
    senderType: "human",
    senderId: "user-1",
    senderName: "Anurag",
    senderHandle: null,
    content: "Please inspect our API routes.",
    status: "done",
    createdAt: "2026-11-07T08:00:00Z",
  },
  {
    id: "msg-2",
    senderType: "agent",
    senderId: "agent-123",
    senderName: "Coder Bot",
    senderHandle: "coder",
    content: "I will check apps/orchestrator/src/index.ts now.",
    status: "done",
    createdAt: "2026-11-07T08:01:00Z",
  },
]

describe("Engine Context Builder (E3)", () => {
  it("maintains strict byte-identical prefix stability across different timestamps", () => {
    const time1 = new Date("2026-11-07T10:00:00.000Z")
    const time2 = new Date("2026-11-07T18:45:22.123Z")

    const res1 = buildEngineContext({
      agent: mockAgent,
      room: mockRoom,
      provider: "anthropic",
      roomHistory: mockHistory,
      skillsIndex: [
        { slug: "run-tests", description: "Run test suite" },
        { slug: "build-page", description: "Build landing page" },
      ],
      pinnedMemories: [{ id: "mem-1", title: "DB policy", body: "Staging DB is read-only" }],
      volatileTail: {
        now: time1,
        recalledMemories: [{ id: "mem-2", title: "User preference", body: "Anurag prefers pnpm" }],
        canvasDiffs: [{ id: "canv-1", title: "API Docs", diffSummary: "+5 -2 lines" }],
        currentTrigger: "Run the tests.",
      },
    })

    const res2 = buildEngineContext({
      agent: mockAgent,
      room: mockRoom,
      provider: "anthropic",
      roomHistory: mockHistory,
      skillsIndex: [
        { slug: "build-page", description: "Build landing page" }, // different initial order
        { slug: "run-tests", description: "Run test suite" },
      ],
      pinnedMemories: [{ id: "mem-1", title: "DB policy", body: "Staging DB is read-only" }],
      volatileTail: {
        now: time2, // completely different now time
        recalledMemories: [{ id: "mem-2", title: "User preference", body: "Anurag prefers pnpm" }],
        canvasDiffs: [{ id: "canv-1", title: "API Docs", diffSummary: "+5 -2 lines" }],
        currentTrigger: "Run the tests.",
      },
    })

    // Assert that the rendered prefix is 100% byte-identical
    expect(res1.prefixString).toBe(res2.prefixString)
    expect(res1.prefix).toEqual(res2.prefix)

    // Volatile tail message should reflect the differing timestamps
    expect(res1.tail.content as string).toContain("Current Time: 2026-11-07T10:00:00.000Z")
    expect(res2.tail.content as string).toContain("Current Time: 2026-11-07T18:45:22.123Z")
  })

  it("applies Anthropic cache breakpoints at system 1, system 2, and rolling run history", () => {
    const res = buildEngineContext({
      agent: mockAgent,
      room: mockRoom,
      provider: "anthropic",
      roomHistory: mockHistory,
      runHistory: [
        { role: "assistant", content: "Checking file existence." },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "fs_read",
              output: { value: "ok" } as any,
            },
          ],
        },
      ],
      volatileTail: {
        now: new Date("2026-11-07T10:00:00Z"),
      },
    })

    // Breakpoint 1: System 1 (frozen)
    const sys1 = res.prefix[0]!
    expect(sys1.role).toBe("system")
    expect((sys1.providerOptions as any)?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    })

    // Breakpoint 2: System 2 (slow-changing)
    const sys2 = res.prefix[1]!
    expect(sys2.role).toBe("system")
    expect((sys2.providerOptions as any)?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    })

    // Breakpoint 3: Rolling last runHistory step
    const lastRunStep = res.prefix[res.prefix.length - 1]!
    expect(lastRunStep.role).toBe("tool")
    expect((lastRunStep.providerOptions as any)?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    })
  })

  it("maps room history speakers correctly: other speakers -> user, self -> assistant", () => {
    const res = buildEngineContext({
      agent: mockAgent,
      room: mockRoom,
      provider: "anthropic",
      roomHistory: mockHistory,
      volatileTail: {
        now: new Date("2026-11-07T10:00:00Z"),
      },
    })

    // System 1 & 2 are indices 0 and 1
    const humanMsg = res.prefix[2]!
    expect(humanMsg.role).toBe("user")
    expect(humanMsg.content).toBe("[Anurag (human)]: Please inspect our API routes.")

    const selfMsg = res.prefix[3]!
    expect(selfMsg.role).toBe("assistant")
    expect(selfMsg.content).toBe("I will check apps/orchestrator/src/index.ts now.")
  })

  it("never sends Anthropic-style cache controls to automatic-cache providers", () => {
    for (const provider of ["google", "openai", "openai-compatible"]) {
      const context = buildEngineContext({
        agent: mockAgent,
        room: mockRoom,
        provider,
        roomHistory: [],
        volatileTail: { now: "fixed" },
      })
      expect(context.prefix.every((message) => message.providerOptions === undefined)).toBe(true)
    }
  })

  it("sorts tool specs deterministically", () => {
    const specs = [
      { name: "update_task", description: "b" } as any,
      { name: "canvas_patch", description: "c" } as any,
      { name: "ask_user", description: "a" } as any,
    ]
    const sorted = sortToolSpecs(specs)
    expect(sorted.map((s) => s.name)).toEqual(["ask_user", "canvas_patch", "update_task"])
  })

  it("computes canvas line diff summaries accurately", () => {
    expect(computeCanvasDiffSummary(undefined, "line 1\nline 2")).toBe("2 lines total")
    expect(computeCanvasDiffSummary("a\nb\nc", "a\nb\nc")).toBe("unchanged (3 lines)")
    expect(computeCanvasDiffSummary("a\nb", "a\nb\nc\nd")).toBe("+2 -0 lines")
    expect(computeCanvasDiffSummary("a\nb\nc", "a")).toBe("+0 -2 lines")
  })

  it("applies tool cache breakpoint on the alphabetically last tool definition for Anthropic", () => {
    const mockTools = {
      zebra_tool: { description: "z tool" } as any,
      alpha_tool: { description: "a tool" } as any,
      middle_tool: { description: "m tool" } as any,
    }

    const cached = applyToolCacheBreakpoint(mockTools, "anthropic")
    expect((cached.alpha_tool as any).providerOptions).toBeUndefined()
    expect((cached.middle_tool as any).providerOptions).toBeUndefined()
    expect((cached.zebra_tool as any).providerOptions?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    })

    // Non-anthropic providers do not receive explicit cacheControl
    const openaiTools = applyToolCacheBreakpoint(mockTools, "openai")
    expect((openaiTools.zebra_tool as any).providerOptions).toBeUndefined()
  })

  it("applies tool cache breakpoint on the alphabetically last active tool when activeToolNames is provided", () => {
    const mockTools = {
      zebra_tool: { description: "z tool" } as any,
      alpha_tool: { description: "a tool" } as any,
      middle_tool: { description: "m tool" } as any,
    }

    // When zebra_tool is inactive, middle_tool should get the breakpoint and others should have it stripped
    const cached = applyToolCacheBreakpoint(mockTools, "anthropic", ["alpha_tool", "middle_tool"])
    expect((cached.alpha_tool as any).providerOptions?.anthropic).toBeUndefined()
    expect((cached.zebra_tool as any).providerOptions?.anthropic).toBeUndefined()
    expect((cached.middle_tool as any).providerOptions?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    })
  })

  it("supports chat history boundary caching with 4-breakpoint layout", () => {
    const res = buildEngineContext({
      agent: mockAgent,
      room: mockRoom,
      provider: "anthropic",
      roomHistory: mockHistory,
      cacheHistoryBoundary: true,
      volatileTail: {
        now: new Date("2026-11-07T10:00:00Z"),
        currentTrigger: "Continue previous work",
      },
    })

    // System prompt should be consolidated to 1 breakpoint on system2
    const sys1 = res.prefix[0]!
    expect((sys1.providerOptions as any)?.anthropic).toBeUndefined()

    const sys2 = res.prefix[1]!
    expect((sys2.providerOptions as any)?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    })

    // Last message in roomHistory gets the history boundary breakpoint
    expect(res.historyBoundaryIndex).toBe(1) // 2 messages in mockHistory -> index 1
    const lastHistMsg = res.prefix[3]! // index 0=sys1, 1=sys2, 2=hist[0], 3=hist[1]
    expect(lastHistMsg.role).toBe("assistant")
    expect((lastHistMsg.providerOptions as any)?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    })

    // Rolling breakpoint preserves history boundary while marking tail
    const messages: ModelMessage[] = [
      { role: "user", content: "hist1" },
      { role: "assistant", content: "hist2" }, // history boundary at idx 1
      { role: "user", content: "turn tail" },
      { role: "assistant", content: "step1 call" },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "1", output: "ok" }] as any }, // tail at idx 4
    ]

    const rolling = applyRollingCacheBreakpoint(messages, "anthropic", 1)
    expect((rolling[0] as any).providerOptions?.anthropic).toBeUndefined()
    expect((rolling[1] as any).providerOptions?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    })
    expect((rolling[2] as any).providerOptions?.anthropic).toBeUndefined()
    expect((rolling[3] as any).providerOptions?.anthropic).toBeUndefined()
    expect((rolling[4] as any).providerOptions?.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
    })
  })
})
