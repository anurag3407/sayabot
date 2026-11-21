import { describe, expect, it } from "vitest"
import { orchestratorTools } from "./orchestrator"

const tools = orchestratorTools({ orgId: "org-test", agentId: "agent-test", roomId: "room-test" })
const byName = new Map(tools.map((tool) => [tool.name, tool]))

function isDangerous(name: string, args: Record<string, unknown> = {}): boolean {
  const tool = byName.get(name)
  if (!tool) throw new Error(`missing tool ${name}`)
  return typeof tool.dangerous === "function" ? tool.dangerous(args) : tool.dangerous
}

describe("orchestratorTools", () => {
  it("exposes the workspace-admin surface", () => {
    expect([...byName.keys()].sort()).toEqual([
      "sayabot_add_bot_to_room",
      "sayabot_approvals",
      "sayabot_bot",
      "sayabot_bots",
      "sayabot_capabilities",
      "sayabot_config",
      "sayabot_configure",
      "sayabot_connectors",
      "sayabot_create_bot",
      "sayabot_create_room",
      "sayabot_decide",
      "sayabot_delegate",
      "sayabot_delete_bot",
      "sayabot_delete_room",
      "sayabot_errors",
      "sayabot_mcp",
      "sayabot_members",
      "sayabot_memory",
      "sayabot_models",
      "sayabot_post",
      "sayabot_remove_bot_from_room",
      "sayabot_retry",
      "sayabot_room",
      "sayabot_room_model",
      "sayabot_rooms",
      "sayabot_routines",
      "sayabot_secrets",
      "sayabot_tasks",
      "sayabot_tune_bot",
      "sayabot_update_bot",
      "sayabot_usage",
    ])
  })

  it("gates every mutation behind the approval gate", () => {
    expect(isDangerous("sayabot_create_bot")).toBe(true)
    expect(isDangerous("sayabot_update_bot")).toBe(true)
    expect(isDangerous("sayabot_create_room")).toBe(true)
    expect(isDangerous("sayabot_add_bot_to_room")).toBe(true)
    expect(isDangerous("sayabot_configure")).toBe(true)
    expect(isDangerous("sayabot_delegate")).toBe(true)
    expect(isDangerous("sayabot_retry")).toBe(true)
    expect(isDangerous("sayabot_remove_bot_from_room")).toBe(true)
    expect(isDangerous("sayabot_decide", { decision: "approve" })).toBe(true)
    expect(isDangerous("sayabot_decide", { decision: "reject" })).toBe(false)
    expect(isDangerous("sayabot_routines", { action: "list" })).toBe(false)
    expect(isDangerous("sayabot_routines", { action: "create" })).toBe(true)
    expect(isDangerous("sayabot_tune_bot")).toBe(true)
    expect(isDangerous("sayabot_delete_bot")).toBe(true)
    expect(isDangerous("sayabot_delete_room")).toBe(true)
    expect(isDangerous("sayabot_room_model")).toBe(true)
    expect(isDangerous("sayabot_connectors", { action: "grant" })).toBe(true)
    expect(isDangerous("sayabot_connectors", { action: "list" })).toBe(false)
    expect(isDangerous("sayabot_secrets", { action: "revoke" })).toBe(true)
    expect(isDangerous("sayabot_mcp", { action: "disable" })).toBe(true)
    expect(isDangerous("sayabot_memory", { action: "forget" })).toBe(true)
    expect(isDangerous("sayabot_memory", { action: "list" })).toBe(false)
  })

  it("keeps reads safe", () => {
    expect(isDangerous("sayabot_bots")).toBe(false)
    expect(isDangerous("sayabot_rooms")).toBe(false)
    expect(isDangerous("sayabot_usage")).toBe(false)
    expect(isDangerous("sayabot_config")).toBe(false)
    expect(isDangerous("sayabot_models")).toBe(false)
    expect(isDangerous("sayabot_approvals")).toBe(false)
    expect(isDangerous("sayabot_errors")).toBe(false)
    expect(isDangerous("sayabot_capabilities")).toBe(false)
    expect(isDangerous("sayabot_bot")).toBe(false)
    expect(isDangerous("sayabot_room")).toBe(false)
    expect(isDangerous("sayabot_members")).toBe(false)
    expect(isDangerous("sayabot_tasks")).toBe(false)
  })

  it("documents every capability flag", async () => {
    const result = (await byName.get("sayabot_capabilities")?.execute({})) as {
      capabilities: Array<{ name: string }>
    }
    expect(result.capabilities.map((item) => item.name)).toContain("computer")
    expect(result.capabilities.map((item) => item.name)).toContain("orchestrator")
  })
})
