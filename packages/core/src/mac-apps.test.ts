import { describe, expect, it } from "vitest"
import {
  MAC_CLI_APPS,
  macAppInfo,
  macAppSplitsSystemPrompt,
  macAppTakesRoomTools,
  macRunRefusal,
} from "./mac-apps"

const OWNER = "user-owner"
const own = { senderType: "human" as const, senderId: OWNER, metadata: {} }

describe("macRunRefusal (personal-use sign-ins)", () => {
  it("lets Antigravity answer only its owner's own messages", () => {
    expect(macRunRefusal("antigravity", own, OWNER)).toBeNull()
    for (const trigger of [
      { senderType: "human" as const, senderId: "someone-else" }, // another member
      { senderType: "human" as const, senderId: null }, // connector / chat gateway
      { senderType: "system" as const, senderId: null }, // routine, task wake
      { senderType: "agent" as const, senderId: "agent-1" }, // another bot
      { ...own, metadata: { automated: true } }, // meeting, scheduled
    ]) {
      expect(macRunRefusal("antigravity", trigger, OWNER)).toMatch(/only answers its owner/)
    }
    expect(macRunRefusal("antigravity", own, null)).not.toBeNull()
  })

  it("leaves every other app alone", () => {
    const routine = { senderType: "system" as const, senderId: null }
    expect(macRunRefusal("claude-code", routine, OWNER)).toBeNull()
    expect(macRunRefusal("gemini", routine, OWNER)).toBeNull()
    expect(macRunRefusal("ollama", routine, OWNER)).toBeNull()
  })

  it("is set only on Antigravity, which also carries the note", () => {
    expect(MAC_CLI_APPS.filter((app) => app.personalUseOnly).map((app) => app.id)).toEqual([
      "antigravity",
    ])
    expect(macAppInfo("antigravity")?.policyNote).toMatch(/GEMINI_API_KEY/)
  })
})

describe("Mac app version gates", () => {
  it("split the system prompt for ACP apps on 1.0.32+ only", () => {
    expect(macAppSplitsSystemPrompt("antigravity", "1.0.32")).toBe(true)
    expect(macAppSplitsSystemPrompt("copilot", "1.2.0")).toBe(true)
    expect(macAppSplitsSystemPrompt("antigravity", "1.0.31")).toBe(false)
    expect(macAppSplitsSystemPrompt("claude-code", "9.0.0")).toBe(false)
    expect(macAppSplitsSystemPrompt("pi", "9.0.0")).toBe(false)
    expect(macAppSplitsSystemPrompt("antigravity", null)).toBe(false)
  })

  it("give room tools to ACP apps from the same version", () => {
    expect(macAppTakesRoomTools("antigravity", "1.0.32")).toBe(true)
    expect(macAppTakesRoomTools("antigravity", "1.0.4")).toBe(false)
    expect(macAppTakesRoomTools("codex", null)).toBe(true)
  })
})
