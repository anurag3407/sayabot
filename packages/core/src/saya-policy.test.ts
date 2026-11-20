import { describe, expect, it } from "vitest"
import { assignableModelId, reviewApproval, roomConfigPatch } from "./saya-policy"

describe("reviewApproval", () => {
  it("lets Saya approve another agent's ordinary command", () => {
    expect(
      reviewApproval({
        decision: "approve",
        callerAgentId: "saya",
        subjectAgentId: "scout",
        toolName: "computer_shell",
      }),
    ).toEqual({ allow: true })
  })

  it("refuses self-approval and the two tools that must stay with a person", () => {
    expect(
      reviewApproval({
        decision: "approve",
        callerAgentId: "saya",
        subjectAgentId: "saya",
        toolName: "sayabot_create_bot",
      }).allow,
    ).toBe(false)
    expect(
      reviewApproval({
        decision: "approve",
        callerAgentId: "saya",
        subjectAgentId: "scout",
        toolName: "use_secret",
      }).allow,
    ).toBe(false)
    expect(
      reviewApproval({
        decision: "approve",
        callerAgentId: "saya",
        subjectAgentId: "scout",
        toolName: "sayabot_decide",
      }).allow,
    ).toBe(false)
  })

  it("refuses an approval that is not tied to an agent", () => {
    expect(
      reviewApproval({
        decision: "approve",
        callerAgentId: "saya",
        subjectAgentId: null,
        toolName: "computer_shell",
      }).allow,
    ).toBe(false)
  })
})

describe("roomConfigPatch", () => {
  it("accepts the room settings Saya is allowed to change", () => {
    const result = roomConfigPatch({
      name: "Planning",
      timezone: "Europe/Berlin",
      turnMode: "mentions",
      executionMode: "ask_risky",
      systemDirective: "Keep standups short.",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.patch).toMatchObject({
        name: "Planning",
        timezone: "Europe/Berlin",
        turnMode: "mentions",
        executionMode: "ask_risky",
      })
    }
  })

  it("leaves auto and turbo with the person at the computer", () => {
    expect(roomConfigPatch({ executionMode: "turbo" }).ok).toBe(false)
    expect(roomConfigPatch({ executionMode: "auto" }).ok).toBe(false)
  })
})

describe("assignableModelId", () => {
  it("accepts a provider model id and rejects a credential-shaped value", () => {
    expect(assignableModelId("anthropic/claude-sonnet-4")).toBe(true)
    expect(assignableModelId("https://user:pass@llm.example/v1")).toBe(false)
    expect(assignableModelId("sk-ant-secret")).toBe(false)
  })
})
