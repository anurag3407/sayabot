import { describe, expect, it } from "vitest"
import {
  formatInvitationMessage,
  generateSetupInstructions,
  getClientConfigSnippet,
} from "./invite"

describe("Invite helpers", () => {
  it("formats invitation message correctly", () => {
    const msg = formatInvitationMessage({
      roomName: "Engineering",
      roomOwnerName: "Alice",
      timezone: "America/New_York",
      clientName: "Claude Code",
      connectionUrl: "https://saaya.example.com/mcp/r/sinv_123",
    })

    expect(msg).toContain('Hi! This is my own room for "Engineering" on Saaya.')
    expect(msg).toContain("America/New_York")
    expect(msg).toContain("This message is for Claude Code.")
    expect(msg).toContain("https://saaya.example.com/mcp/r/sinv_123")
  })

  it("generates correct client configuration snippets", () => {
    const url = "https://saaya.example.com/mcp/token_abc"
    const name = "saaya-bot"

    expect(getClientConfigSnippet("claude-code", url, name)).toBe(
      `claude mcp add --transport http ${name} ${url}`,
    )

    expect(getClientConfigSnippet("hermes", url, name)).toBe(`hermes mcp add ${name} ${url}`)

    expect(getClientConfigSnippet("codex", url, name)).toContain(
      `[mcp_servers.${name}]\nurl = "${url}"`,
    )

    const cursorConfig = JSON.parse(getClientConfigSnippet("cursor", url, name))
    expect(cursorConfig.mcpServers[name].url).toBe(url)

    const geminiConfig = JSON.parse(getClientConfigSnippet("antigravity", url, name))
    expect(geminiConfig.mcpServers[name].httpUrl).toBe(url)
  })

  it("includes STAY ACTIVE section only for loop-capable clients", () => {
    const baseContext = {
      handle: "coder",
      displayName: "Coder Bot",
      roomName: "Dev Room",
      roomId: "room-123",
      roomOwnerName: "Bob",
      timezone: "UTC",
      token: "secret_token",
      connectionUrl: "https://saaya.example.com/mcp/token",
    }

    // claude-code is loop capable
    const claudeCodeInstructions = generateSetupInstructions({
      ...baseContext,
      client: "claude-code",
    })
    expect(claudeCodeInstructions).toContain("STAY ACTIVE (Loop Mode):")
    expect(claudeCodeInstructions).toContain("After joining, call wait_for_activity in a loop.")

    // claude (app) is not loop capable
    const claudeAppInstructions = generateSetupInstructions({
      ...baseContext,
      client: "claude",
    })
    expect(claudeAppInstructions).not.toContain("STAY ACTIVE (Loop Mode):")
    expect(claudeAppInstructions).not.toContain("call wait_for_activity in a loop")
  })
})
