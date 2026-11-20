import { describe, expect, it } from "vitest"
import { formatInvitationMessage, generateSetupInstructions } from "./instructions"
import { listTools, mcpRoutes, MCP_TOOLS } from "./server"

describe("mesh MCP server", () => {
  it("exposes the complete Jinxo-parity tool surface including check_in", () => {
    const names = MCP_TOOLS.map((t) => t.name)
    for (const name of [
      "check_in",
      "whoami",
      "get_inbox",
      "get_room_messages",
      "post_message",
      "send_message",
      "send_direct_message",
      "list_tasks",
      "create_task",
      "claim_task",
      "take_task",
      "update_task",
      "report_checkin",
      "request_human_decision",
      "ask_for_help",
      "update_my_profile",
      "start_vote",
      "cast_vote",
    ]) {
      expect(names).toContain(name)
    }
  })

  it("publishes a JSON object schema for every tool", () => {
    for (const tool of listTools()) {
      expect(tool.inputSchema.type).toBe("object")
      expect(tool.inputSchema).not.toHaveProperty("$schema")
      expect(tool.description.length).toBeGreaterThan(10)
    }
  })

  it("validates arguments before running", () => {
    const post = MCP_TOOLS.find((t) => t.name === "post_message")!
    expect(post.schema.safeParse({ content: "" }).success).toBe(false)
    expect(
      post.schema.safeParse({ room_id: "7d6f2f0e-8f1c-4c55-9a0f-2f4b8f7b9b11", content: "hi" })
        .success,
    ).toBe(true)
    expect(post.schema.safeParse({ text: "hello via text alias" }).success).toBe(true)
  })

  it("generates tailored setup instructions for Codex", () => {
    const text = generateSetupInstructions({
      handle: "codex",
      displayName: "Codex",
      roomName: "AnuragMishra's room",
      roomId: "r2934e2ab063c",
      roomOwnerName: "Anurag Mishra",
      timezone: "Asia/Calcutta",
      token: "mesh_ak_test123",
      connectionUrl: "http://localhost:7431/mcp/mesh_ak_test123?client=codex",
      client: "codex",
    })

    expect(text).toContain("Saaya instructions for Codex by OpenAI")
    expect(text).toContain("ABOUT YOU")
    expect(text).toContain("@codex")
    expect(text).toContain("AnuragMishra's room")
    expect(text).toContain("Asia/Calcutta")
    expect(text).toContain(".codex/config.toml")
    expect(text).toContain("[mcp_servers.saaya-codex]")
    expect(text).toContain("check_in")
    expect(text).toContain("KICKOFF SEQUENCE")
    expect(text).toContain("NO MCP CONNECTOR SUPPORT? USE DIRECT HTTP CALLS")
  })

  it("generates tailored setup instructions for Hermes", () => {
    const text = generateSetupInstructions({
      handle: "hermes",
      displayName: "Hermes Agent",
      roomName: "Dev Room",
      roomId: "r12345",
      roomOwnerName: "Anurag Mishra",
      timezone: "Asia/Calcutta",
      token: "mesh_ak_hermes456",
      connectionUrl: "http://localhost:7431/mcp/mesh_ak_hermes456?client=hermes",
      client: "hermes",
    })

    expect(text).toContain("Saaya instructions for Hermes Agent")
    expect(text).toContain("hermes mcp add saaya-hermes")
    expect(text).toContain("~/.hermes/config.json")
    expect(text).toContain("KICKOFF SEQUENCE")
  })

  it("formats the one-click invitation message", () => {
    const msg = formatInvitationMessage({
      roomName: "AnuragMishra's room",
      roomOwnerName: "Anurag Mishra",
      timezone: "Asia/Calcutta",
      clientName: "codex",
      connectionUrl: "http://localhost:7431/mcp/tr_test",
    })

    expect(msg).toContain('Hi! This is my own room for "AnuragMishra\'s room" on Saaya.')
    expect(msg).toContain("• connect with the link below")
    expect(msg).toContain(
      "• check in with the other bots every hour on the hour, 9:00 AM to 5:00 PM Asia/Calcutta time",
    )
    expect(msg).toContain("This message is for codex.")
    expect(msg).toContain("http://localhost:7431/mcp/tr_test")
  })

  it("handles GET /v1/mcp without valid token gracefully", async () => {
    const res = await mcpRoutes.request("/v1/mcp/invalid_token")
    expect(res.status).toBe(401)
    const text = await res.text()
    expect(text).toContain("Saaya setup error: Invalid, revoked, or missing agent key.")
  })
})
