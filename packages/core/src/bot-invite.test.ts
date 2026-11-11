import { describe, expect, it } from "vitest"
import { botInviteMessage, botInviteState, botJoinInstructions, handleFromName } from "./bot-invite"
import { generateBotInviteCode, generatePollToken, hashAgentApiKey } from "./server"

describe("bot invites", () => {
  it("derives state with expiry, but keeps final states", () => {
    const past = new Date(Date.now() - 1000)
    const future = new Date(Date.now() + 60_000)
    expect(botInviteState({ status: "waiting", expiresAt: future })).toBe("waiting")
    expect(botInviteState({ status: "pending", expiresAt: past })).toBe("expired")
    expect(botInviteState({ status: "joined", expiresAt: past })).toBe("joined")
    expect(botInviteState({ status: "declined", expiresAt: past })).toBe("declined")
  })

  it("builds a paste message with the link and no secret", () => {
    const msg = botInviteMessage({ roomName: "Job hunt", url: "https://x.test/bot/bi_abc" })
    expect(msg).toContain('"Job hunt"')
    expect(msg.trim().endsWith("https://x.test/bot/bi_abc")).toBe(true)
    expect(msg).not.toMatch(/mesh_ak_|bp_/)
  })

  it("slugs handles", () => {
    expect(handleFromName("Hermes Agent")).toBe("hermes-agent")
    expect(handleFromName("  Dr. Ëggbot!! ")).toBe("dr-eggbot")
    expect(handleFromName("")).toBe("bot")
    expect(handleFromName("a".repeat(40)).length).toBe(24)
  })

  it("tells the bot how to ask, wait and collect", () => {
    const text = botJoinInstructions({
      roomName: "Job hunt",
      ownerName: "Anurag",
      joinUrl: "https://x.test/bot/bi_abc/join",
      statusUrl: "https://x.test/bot/bi_abc/status",
      suggestedName: "hermes",
      suggestedApp: "hermes",
    })
    expect(text).toContain("POST")
    expect(text).toContain("https://x.test/bot/bi_abc/join")
    expect(text).toContain('"name": "hermes"')
    expect(text).toContain("authorization: Bearer <poll_token>")
  })

  it("generates distinct codes and hashable poll tokens", () => {
    const a = generateBotInviteCode()
    expect(a).toMatch(/^bi_[A-Za-z0-9_-]{24}$/)
    expect(a).not.toBe(generateBotInviteCode())
    const poll = generatePollToken()
    expect(poll.token.startsWith("bp_")).toBe(true)
    expect(poll.hash).toBe(hashAgentApiKey(poll.token))
  })
})
