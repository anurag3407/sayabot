import { describe, expect, it } from "vitest"
import { MCP_TOOLS, listTools } from "../../src/mcp/server"

describe("MCP tool registry", () => {
  it("listTools mirrors MCP_TOOLS (same names, same order)", () => {
    expect(listTools().map((t: any) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name))
  })

  it("tool names are unique and descriptions are present", () => {
    const names = MCP_TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const t of MCP_TOOLS) expect(t.description.length, t.name).toBeGreaterThan(10)
  })

  it("core collab tools exist (inbox, messages, tasks, decisions, votes, check-in)", () => {
    const names = MCP_TOOLS.map((t) => t.name)
    for (const expected of ["get_inbox", "post_message", "list_tasks", "claim_task", "request_human_decision", "start_vote"]) {
      expect(names, expected).toContain(expected)
    }
  })
})
