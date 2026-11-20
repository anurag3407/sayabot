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
      "sayabot_bots",
      "sayabot_config",
      "sayabot_create_bot",
      "sayabot_create_room",
      "sayabot_rooms",
      "sayabot_update_bot",
      "sayabot_usage",
    ])
  })

  it("gates every mutation behind the approval gate", () => {
    expect(isDangerous("sayabot_create_bot")).toBe(true)
    expect(isDangerous("sayabot_update_bot")).toBe(true)
    expect(isDangerous("sayabot_create_room")).toBe(true)
    expect(isDangerous("sayabot_add_bot_to_room")).toBe(true)
  })

  it("keeps reads safe", () => {
    expect(isDangerous("sayabot_bots")).toBe(false)
    expect(isDangerous("sayabot_rooms")).toBe(false)
    expect(isDangerous("sayabot_usage")).toBe(false)
    expect(isDangerous("sayabot_config")).toBe(false)
  })
})
