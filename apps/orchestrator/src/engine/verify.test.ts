import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ generate: vi.fn(), resolve: vi.fn() }))
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: mocks.generate,
}))
vi.mock("../runner/llm", () => ({ resolveAgentCheapModel: mocks.resolve }))
import { buildSelfVerificationPrompt, getVerifyMode, runCriticVerification } from "./verify"

describe("verify", () => {
  const args = {
    agent: {} as any,
    orgId: "org",
    roomId: "room",
    taskBrief: "Fix auth",
    proposedOutput: "Done",
    cycle: 0,
  }

  it("never turns a revision limit into a successful verification", async () => {
    expect((await runCriticVerification({ ...args, cycle: 2 })).pass).toBe(false)
  })

  it("rejects malformed critic output", async () => {
    mocks.resolve.mockResolvedValue({ model: {} })
    mocks.generate.mockResolvedValue({ text: "looks fine" })
    expect((await runCriticVerification(args)).pass).toBe(false)
  })

  it("reports unavailable reviewer without claiming success or throwing", async () => {
    mocks.resolve.mockRejectedValue(new Error("provider unavailable"))
    await expect(runCriticVerification(args)).resolves.toMatchObject({ pass: false })
  })

  it("defaults to self verification when engine is v2 or verify is unset", () => {
    expect(getVerifyMode(null)).toBe("self")
    expect(getVerifyMode({})).toBe("self")
    expect(getVerifyMode({ verify: "self" })).toBe("self")
    expect(getVerifyMode({ verify: "critic" })).toBe("critic")
    expect(getVerifyMode({ verify: "off" })).toBe("off")
  })

  it("builds self-verification checklist containing requirements and evidence prompts", () => {
    const prompt = buildSelfVerificationPrompt(
      "Refactor authentication module to support OAuth PKCE",
    )
    expect(prompt).toContain("Verification checklist before concluding:")
    expect(prompt).toContain("Refactor authentication module to support OAuth PKCE")
    expect(prompt).toContain("Re-read the initial prompt and task requirements")
    expect(prompt).toContain("concrete evidence")
    expect(prompt).toContain("tests or linters")
  })
})
