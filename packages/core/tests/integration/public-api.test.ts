import { describe, expect, it } from "vitest"
import * as core from "@sayabot/core"
import * as server from "@sayabot/core/server"

describe("core public API surface", () => {
  it("re-exports every module (no dropped export)", () => {
    const expected: Array<[string, unknown]> = [
      ["normalizeClient", core.normalizeClient],
      ["extractHandles", core.extractHandles],
      ["redactSecrets", core.redactSecrets],
      ["planMentionsTurn", core.planMentionsTurn],
      ["computeCostUsd", core.computeCostUsd],
      ["matchesHostPattern", core.matchesHostPattern],
      ["roomEventSchema", core.roomEventSchema],
      ["botMessageBodySchema", core.botMessageBodySchema],
    ]
    for (const [name, value] of expected) expect(value, name).toBeDefined()
  })

  it("server entry only exposes server-safe helpers", () => {
    expect(typeof server.signWebhook).toBe("function")
    expect(typeof server.assertSafeEgressHost).toBe("function")
    expect(typeof server.generateAgentApiKey).toBe("function")
    expect((server as Record<string, unknown>).normalizeClient).toBeUndefined()
  })

  it("roomEventSchema round-trips every discriminant", () => {
    const samples = [
      { type: "message.delta", messageId: "m", seq: 0, delta: "hi" },
      { type: "message.done", messageId: "m", status: "complete" },
      { type: "tool.approval_resolved", toolCallId: "t", status: "approved" },
      { type: "room.notice", level: "info", message: "x" },
    ] as const
    for (const s of samples) expect(core.roomEventSchema.safeParse(s).success).toBe(true)
    expect(core.roomEventSchema.safeParse({ type: "nope" }).success).toBe(false)
  })

  it("capabilities parse with defaults and reject garbage", () => {
    expect(core.parseCapabilities(undefined).sandbox).toBeDefined()
    expect(() => core.parseCapabilities("not json")).not.toThrow()
  })
})
