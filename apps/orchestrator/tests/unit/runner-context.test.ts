import { describe, expect, it } from "vitest"
import {
  agentAppOnline,
  agentJobSummary,
  agentListPrompt,
  buildSystemPrompt,
  handoffNames,
  leadAgentListPrompt,
  APP_ONLINE_WINDOW_MS,
  buildUserPrompt,
  renderTranscript,
  toWebhookContext,
  type ContextMessage,
  type AgentRow,
  type RoomRow,
} from "../../src/runner/context"

const room = { id: "r", name: "general", orgId: "o", systemDirective: null } as unknown as RoomRow
const agent = {
  id: "a",
  handle: "ada",
  displayName: "Ada",
  systemPrompt: "Be terse.",
  capabilities: null,
  params: {},
} as unknown as AgentRow
const msg = (over: Partial<ContextMessage>): ContextMessage => ({
  id: "m",
  senderType: "human",
  senderId: null,
  senderName: "Sam",
  content: "hi",
  status: "complete",
  mentions: [],
  runId: null,
  metadata: {},
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
})

describe("renderTranscript", () => {
  it("labels senders and truncates long messages", () => {
    const out = renderTranscript([
      msg({
        content: "x".repeat(5000),
        senderType: "agent",
        senderName: "Ada",
        senderHandle: "ada",
      }),
    ])
    expect(out).toContain("Ada (@ada) (agent)")
    expect(out).toContain("\u2026")
    expect(out.length).toBeLessThan(5000)
  })

  it("marks streaming messages and keeps the transcript within budget (drops oldest)", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      msg({ id: "m" + i, content: "y".repeat(2000), status: "streaming" }),
    )
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
    const p = buildSystemPrompt({
      room: { ...room, systemDirective: "Use British spelling." } as RoomRow,
      agent,
      role: "responder",
    })
    expect(p).toContain("@ada")
    expect(p).toContain("Use British spelling.")
    expect(p).toContain("Be terse.")
    expect(p).not.toContain("/home/bot")
  })

  it("adds the computer block when the computer capability is on", () => {
    const p = buildSystemPrompt({
      room,
      agent: {
        ...agent,
        capabilities: { computer: { profile: "standard" } },
      } as unknown as AgentRow,
      role: "responder",
    })
    expect(p).toContain("/home/bot")
    expect(p).toContain("select_computer")
    const boat = buildSystemPrompt({
      room,
      agent: {
        ...agent,
        capabilities: { computer: { profile: "standard" } },
        params: { worksOn: "boat" },
      } as unknown as AgentRow,
      role: "responder",
    })
    expect(boat).toContain("Files stored in /home/user persist")
  })

  it("user prompt includes canvases/tasks and ends naming the agent", () => {
    const p = buildUserPrompt({
      transcript: "hello",
      canvases: "<canvas/>",
      tasks: "MESH-1 open",
      agent,
      extra: "extra ctx",
    })
    expect(p).toContain("<canvas/>")
    expect(p).toContain("MESH-1 open")
    expect(p.trimEnd()).toContain("@ada")
  })
})

describe("toWebhookContext / agentListPrompt", () => {
  it("keeps the last 20 messages and caps content", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      msg({ id: "m" + i, content: "z".repeat(5000) }),
    )
    const ctx = toWebhookContext(many)
    expect(ctx).toHaveLength(20)
    expect(ctx[0]!.content.length).toBeLessThanOrEqual(4000)
  })

  it("lists agents as id: @handle (name) lines", () => {
    const out = agentListPrompt([
      { agent: { id: "a1", handle: "ada", displayName: "Ada" } } as never,
    ])
    expect(out).toBe("- a1: @ada (Ada)")
  })
})

describe("lead agent helpers", () => {
  const now = Date.parse("2026-11-16T12:00:00Z")
  const row = (over: Record<string, unknown>) =>
    ({
      agent: {
        id: "x",
        handle: "x",
        displayName: "X",
        kind: "llm",
        bio: null,
        systemPrompt: "",
        webhookUrl: null,
        lastSeenAt: null,
        ...over,
      },
      position: 0,
    }) as never

  it("treats an app as open only when it called in within the window", () => {
    expect(agentAppOnline(null, now)).toBe(false)
    expect(agentAppOnline(new Date(now - 60_000), now)).toBe(true)
    expect(agentAppOnline(new Date(now - APP_ONLINE_WINDOW_MS - 1), now)).toBe(false)
    expect(agentAppOnline("not a date", now)).toBe(false)
  })

  it("summarises an agent's job from its bio, then its instructions", () => {
    expect(agentJobSummary({ bio: "Writes docs", systemPrompt: "ignored" })).toBe("Writes docs")
    expect(agentJobSummary({ bio: null, systemPrompt: "Review   code\ncarefully" })).toBe(
      "Review code carefully",
    )
    expect(agentJobSummary({ bio: null, systemPrompt: "" })).toBe("no description")
    expect(agentJobSummary({ bio: "y".repeat(500), systemPrompt: "" }).length).toBe(200)
  })

  it("lists each agent with its job and whether it answers now", () => {
    const out = leadAgentListPrompt(
      [
        row({ id: "lead", handle: "lead", displayName: "Lead", systemPrompt: "Route work" }),
        row({ id: "w", handle: "writer", displayName: "Writer", bio: "Technical documentation" }),
        row({
          id: "c",
          handle: "coder",
          displayName: "Coder",
          kind: "external",
          lastSeenAt: new Date(now - 1000),
        }),
        row({ id: "o", handle: "old", displayName: "Old", kind: "external" }),
        row({
          id: "h",
          handle: "hook",
          displayName: "Hook",
          kind: "external",
          webhookUrl: "https://x",
        }),
      ],
      "lead",
      now,
    )
    const lines = out.split("\n")
    expect(lines[0]).toBe("- lead: @lead (Lead) (you, the lead) [answers now]: Route work")
    expect(lines[1]).toBe("- w: @writer (Writer) [answers now]: Technical documentation")
    expect(lines[2]).toContain("[invited app, open now, answers in its own time]")
    expect(lines[3]).toContain("[invited app, not open right now, answers when its owner opens it]")
    expect(lines[4]).toContain("[invited app, answers within a minute]")
  })

  it("names who the lead handed a message to", () => {
    expect(handoffNames(["writer"])).toBe("@writer")
    expect(handoffNames(["writer", "coder"])).toBe("@writer and @coder")
    expect(handoffNames(["a", "b", "c"])).toBe("@a, @b and @c")
    expect(handoffNames([])).toBe("")
  })
})
