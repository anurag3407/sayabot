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

describe("macRunRefusal (provider usage rules)", () => {
  const other = { senderType: "human" as const, senderId: "someone-else" } // another member
  const outside = { senderType: "human" as const, senderId: null } // connector / chat gateway
  const routine = { senderType: "system" as const, senderId: null } // routine, task wake
  const ownBot = { senderType: "agent" as const, senderId: "agent-1", senderOwnerUserId: OWNER }
  const otherBot = {
    senderType: "agent" as const,
    senderId: "agent-2",
    senderOwnerUserId: "someone-else",
  }
  const unknownBot = { senderType: "agent" as const, senderId: "agent-3" }
  const metaBot = {
    senderType: "agent" as const,
    senderId: "agent-4",
    metadata: { botOwnerUserId: OWNER },
  }
  const meeting = { ...own, metadata: { automated: true } } // meeting, scheduled

  it("interactive apps (Antigravity, Kimi Code) answer only the owner's own messages", () => {
    for (const app of ["antigravity", "kimi"]) {
      expect(macRunRefusal(app, own, OWNER)).toBeNull()
      for (const trigger of [
        other,
        outside,
        routine,
        ownBot,
        otherBot,
        unknownBot,
        metaBot,
        meeting,
      ]) {
        expect(macRunRefusal(app, trigger, OWNER)).toMatch(/only answers its owner's own messages/)
      }
      expect(macRunRefusal(app, own, null)).not.toBeNull()
    }
    expect(macRunRefusal("antigravity", other, OWNER)).toMatch(/GEMINI_API_KEY/)
  })

  it("owner-only apps (Qoder, Command Code, Devin) refuse other people and other bots, allow routines and own bots", () => {
    for (const app of ["qoder", "command-code", "devin"]) {
      for (const trigger of [own, routine, ownBot, metaBot, meeting]) {
        expect(macRunRefusal(app, trigger, OWNER)).toBeNull()
      }
      for (const trigger of [other, outside, otherBot, unknownBot]) {
        expect(macRunRefusal(app, trigger, OWNER)).toMatch(/only answers its owner and/)
      }
    }
  })

  it("leaves apps with no rule found alone (Grok, Cursor, Qwen Code, Claude Code…)", () => {
    for (const app of ["grok", "cursor", "qwen", "claude-code", "gemini", "ollama"]) {
      expect(macRunRefusal(app, other, OWNER)).toBeNull()
      expect(macRunRefusal(app, routine, OWNER)).toBeNull()
    }
  })

  it("is set on exactly these apps, each with a note", () => {
    const withPolicy = MAC_CLI_APPS.filter((app) => app.usePolicy)
    expect(withPolicy.map((app) => [app.id, app.usePolicy?.kind]).sort()).toEqual([
      ["antigravity", "interactive"],
      ["command-code", "owner"],
      ["devin", "owner"],
      ["kimi", "interactive"],
      ["qoder", "owner"],
    ])
    for (const app of withPolicy) expect(app.policyNote).toBeTruthy()
    expect(macAppInfo("qoder")).toMatchObject({ bin: "qodercli", transport: "acp" })
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
