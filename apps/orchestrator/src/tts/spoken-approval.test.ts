import { describe, expect, it, vi } from "vitest"
import {
  generateSpokenApprovalPrompt,
  parseSpokenApproval,
  processSpokenDecision,
} from "./spoken-approval"

vi.mock("../tools/approvals", () => ({
  resolveApprovalWaiter: vi.fn(),
}))

describe("spoken approval protocol", () => {
  it("accurately classifies affirmative spoken phrases", () => {
    expect(parseSpokenApproval("Yes, please proceed")).toBe("approved")
    expect(parseSpokenApproval("Go ahead and run it")).toBe("approved")
    expect(parseSpokenApproval("Sure, that looks fine")).toBe("approved")
    expect(parseSpokenApproval("approve")).toBe("approved")
    expect(parseSpokenApproval("OK do it")).toBe("approved")
  })

  it("accurately classifies negative spoken phrases", () => {
    expect(parseSpokenApproval("No, do not delete that")).toBe("rejected")
    expect(parseSpokenApproval("Cancel this immediately")).toBe("rejected")
    expect(parseSpokenApproval("reject")).toBe("rejected")
    expect(parseSpokenApproval("Nope, stop")).toBe("rejected")
  })

  it("returns unclear for ambiguous or empty utterances", () => {
    expect(parseSpokenApproval("what was the total price?")).toBe("unclear")
    expect(parseSpokenApproval("")).toBe("unclear")
    expect(parseSpokenApproval("maybe later")).toBe("unclear")
  })

  it("generates concise spoken approval prompts", () => {
    const prompt = generateSpokenApprovalPrompt("terminal_exec", { command: "rm -rf /tmp/data" })
    expect(prompt).toContain("terminal exec")
    expect(prompt).toContain("command rm -rf /tmp/data")
    expect(prompt).toContain("Do you approve or reject?")
  })

  it("processes spoken decision and resolves approval waiter", async () => {
    const { resolveApprovalWaiter } = await import("../tools/approvals")

    const res = processSpokenDecision("call-123", "Yes, go ahead")
    expect(res.resolved).toBe(true)
    expect(res.decision).toBe("approved")
    expect(resolveApprovalWaiter).toHaveBeenCalledWith("call-123", "approved")

    const unclearRes = processSpokenDecision("call-123", "I am thinking")
    expect(unclearRes.resolved).toBe(false)
  })
})
