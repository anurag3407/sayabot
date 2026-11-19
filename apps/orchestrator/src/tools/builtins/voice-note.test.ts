import { describe, expect, it } from "vitest"
import { sendVoiceNoteTool } from "./voice-note"

describe("send_voice_note tool", () => {
  const tool = sendVoiceNoteTool({
    orgId: "org-1",
    agentId: "agent-1",
    roomId: "room-1",
  })

  it("is marked safe (dangerous: false)", () => {
    const isDangerous = typeof tool.dangerous === "function" ? tool.dangerous({}) : tool.dangerous
    expect(isDangerous).toBe(false)
  })

  it("has a valid zod schema enforcing 1-1000 characters", () => {
    expect(() => tool.schema.parse({ text: "Hello team" })).not.toThrow()
    expect(() => tool.schema.parse({ text: "" })).toThrow()
    expect(() => tool.schema.parse({ text: "a".repeat(1001) })).toThrow()
  })

  it("handles empty or non-speakable text with a clear error", async () => {
    const result = (await tool.execute({ text: "... ... !!!" })) as any
    expect(result.ok).toBe(false)
    expect(result.error).toContain("must contain speakable words")
  })
})
