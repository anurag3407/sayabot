import { describe, expect, it } from "vitest"
import { agentListPrompt, buildSystemPrompt, buildUserPrompt, renderTranscript, toWebhookContext, type ContextMessage, type AgentRow, type RoomRow } from "../../src/runner/context"

const room = { id: "r", name: "general", orgId: "o", systemDirective: null } as unknown as RoomRow
const agent = { id: "a", handle: "ada", displayName: "Ada", systemPrompt: "Be terse.", capabilities: null, params: {} } as unknown as AgentRow
const msg = (over: Partial<ContextMessage>): ContextMessage => ({ id: "m", senderType: "human", senderId: null, senderName: "Sam", content: "hi", status: "complete", mentions: [], runId: null, metadata: {}, createdAt: "2026-01-01T00:00:00Z", ...over })

describe("renderTranscript", () => {
  it("labels senders and truncates long messages", () => {
    const out = renderTranscript([msg({ content: "x".repeat(5000), senderType: "agent", senderName: "Ada", senderHandle: "ada" })])
    expect(out).toContain("Ada (@ada) (agent)")
    expect(out).toContain("\u2026")
    expect(out.length).toBeLessThan(5000)
  })

  it("marks streaming messages and keeps the transcript within budget (drops oldest)", () => {
    const many = Array.from({ length: 40 }, (_, i) => msg({ id: "m" + i, content: "y".repeat(2000), status: "streaming" }))
    const out = renderTranscript(many)
    expect(out).toContain("(still streaming)")
    expect(out.length).toBeLessThanOrEqual(62000)
  })

  it("renders empty input as empty string", () => {
    expect(renderTranscript([])).toBe("")
  })
})

describe("buildSystemPrompt / buildUserPrompt", () => {
  it("includes identity, directive, instructions; omits computer block without capability", () => {
    const p = buildSystemPrompt({ room: { ...room, systemDirective: "Use British spelling." } as RoomRow, agent, role: "responder" })
    expect(p).toContain("@ada")
    expect(p).toContain("Use British spelling.")
    expect(p).toContain("Be terse.")
    expect(p).not.toContain("/home/bot")
  })

  it("adds the computer block when the computer capability is on", () => {
    const p = buildSystemPrompt({ room, agent: { ...agent, capabilities: { computer: { profile: "standard" } } } as unknown as AgentRow, role: "responder" })
    expect(p).toContain("/home/bot")
  })

  it("user prompt includes canvases/tasks and ends naming the agent", () => {
    const p = buildUserPrompt({ transcript: "hello", canvases: "<canvas/>", tasks: "MESH-1 open", agent, extra: "extra ctx" })
    expect(p).toContain("<canvas/>")
    expect(p).toContain("MESH-1 open")
    expect(p.trimEnd()).toContain("@ada")
  })
})

describe("toWebhookContext / agentListPrompt", () => {
  it("keeps the last 20 messages and caps content", () => {
    const many = Array.from({ length: 30 }, (_, i) => msg({ id: "m" + i, content: "z".repeat(5000) }))
    const ctx = toWebhookContext(many)
    expect(ctx).toHaveLength(20)
    expect(ctx[0]!.content.length).toBeLessThanOrEqual(4000)
  })

  it("lists agents as id: @handle (name) lines", () => {
    const out = agentListPrompt([{ agent: { id: "a1", handle: "ada", displayName: "Ada" } } as never])
    expect(out).toBe("- a1: @ada (Ada)")
  })
})
