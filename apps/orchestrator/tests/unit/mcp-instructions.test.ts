import { describe, expect, it } from "vitest"
import { formatInvitationMessage, generateSetupInstructions, normalizeClient } from "../../src/mcp/instructions"

const ctx = {
  handle: "ada", displayName: "Ada", roomName: "General", roomId: "r1", roomOwnerName: "Sam",
  timezone: "Asia/Kolkata", token: "tok", connectionUrl: "https://x/mcp/tok",
}

describe("mcp normalizeClient", () => {
  it("mirrors core client ids", () => {
    expect(normalizeClient("claudecode").id).toBe("claude-code")
    expect(normalizeClient("gemini").id).toBe("antigravity")
    expect(normalizeClient("???").id).toBe("generic")
    expect(normalizeClient(undefined).label).toBe("AI Assistant")
  })
})

describe("formatInvitationMessage", () => {
  it("names the room, owner and link, and defaults sanely", () => {
    const out = formatInvitationMessage({ roomName: "Ops", roomOwnerName: "Jo", timezone: "UTC", connectionUrl: "https://x/y" })
    expect(out).toContain("Ops")
    expect(out).toContain("UTC")
    expect(out).toContain("https://x/y")
    const bare = formatInvitationMessage({ roomName: "", connectionUrl: "u" })
    expect(bare).toContain("my room")
  })
})

describe("generateSetupInstructions", () => {
  it("embeds handle, room, timezone and the private connection link", () => {
    const out = generateSetupInstructions(ctx)
    expect(out).toContain("@ada")
    expect(out).toContain("Asia/Kolkata")
    expect(out).toContain("https://x/mcp/tok")
    expect(out).toContain("JOIN NOW")
  })

  it("tailors setup steps to the client (codex toml vs hermes cli vs claude-code)", () => {
    expect(generateSetupInstructions({ ...ctx, client: "codex" })).toContain(".codex/config.toml")
    expect(generateSetupInstructions({ ...ctx, client: "hermes" })).toContain("hermes mcp add")
    expect(generateSetupInstructions({ ...ctx, client: "claude-code" })).toContain("Claude Code")
  })

  it("every client variant mentions the owner and the check-in schedule", () => {
    for (const client of ["codex", "cursor", "chatgpt", undefined]) {
      const out = generateSetupInstructions({ ...ctx, client })
      expect(out, String(client)).toContain("Sam")
      expect(out, String(client)).toContain("9:00 AM to 5:00 PM")
    }
  })
})
