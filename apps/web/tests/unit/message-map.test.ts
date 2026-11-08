import { describe, expect, it } from "vitest"
import { messageFromRow, sortMessages, sortToolCalls, toolCallFromRow } from "../../src/lib/message-map"

const lookup = {
  agents: new Map([["a1", { displayName: "Ada", handle: "ada" }]]),
  members: new Map([["u1", { displayName: "Sam" }]]),
}
const row = (over: Record<string, unknown>) => ({
  id: "m1", room_id: "r1", thread_root_id: null, sender_type: "human", sender_id: "u1",
  content: "hi", status: "complete", mentions: null, run_id: null, metadata: null,
  created_at: "2026-01-01T00:00:00Z", ...over,
}) as never

describe("messageFromRow", () => {
  it("resolves member and agent display names", () => {
    expect(messageFromRow(row({}), lookup).senderName).toBe("Sam")
    const agent = messageFromRow(row({ sender_type: "agent", sender_id: "a1" }), lookup)
    expect(agent.senderName).toBe("Ada")
    expect(agent.senderHandle).toBe("ada")
  })
  it("falls back for removed agents / former members; system is literal", () => {
    expect(messageFromRow(row({ sender_type: "agent", sender_id: "gone" }), lookup).senderName).toBe("Removed agent")
    expect(messageFromRow(row({ sender_type: "human", sender_id: "gone" }), lookup).senderName).toBe("Former member")
    expect(messageFromRow(row({ sender_type: "system", sender_id: null }), lookup).senderName).toBe("system")
  })
  it("defaults null mentions/metadata to empty collections", () => {
    const m = messageFromRow(row({}), lookup)
    expect(m.mentions).toEqual([])
    expect(m.metadata).toEqual({})
  })
})

describe("toolCallFromRow + sorting", () => {
  it("defaults null args to {}", () => {
    const tc = toolCallFromRow({ id: "t", run_id: null, room_id: "r", message_id: null, tool_name: "x", args: null, result: null, status: "done", approved_by: null, resolved_at: null, error: null, created_at: "2026-01-01T00:00:00Z" } as never)
    expect(tc.args).toEqual({})
  })
  it("sorts ascending without mutating the input", () => {
    const msgs = [messageFromRow(row({ id: "b", created_at: "2026-01-02T00:00:00Z" }), lookup), messageFromRow(row({ id: "a", created_at: "2026-01-01T00:00:00Z" }), lookup)]
    expect(sortMessages(msgs).map((m) => m.id)).toEqual(["a", "b"])
    expect(msgs[0]!.id).toBe("b")
    const calls = [{ createdAt: "2026-01-02" }, { createdAt: "2026-01-01" }] as never[]
    expect(sortToolCalls(calls).map((c: any) => c.createdAt)).toEqual(["2026-01-01", "2026-01-02"])
  })
})
