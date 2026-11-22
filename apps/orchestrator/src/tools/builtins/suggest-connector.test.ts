import { describe, expect, it } from "vitest"
import { suggestConnectorTool } from "./suggest-connector"

describe("suggestConnectorTool", () => {
  const tool = suggestConnectorTool({
    orgId: "org-test-1",
    agentId: "agent-test-1",
    roomId: "room-test-1",
  })

  it("defines tool spec accurately", () => {
    expect(tool.name).toBe("suggest_connector")
    expect(tool.dangerous).toBe(false)
  })

  it("executes and returns suggested connector payload", async () => {
    const res = (await tool.execute({
      source: "github",
      name: "GitHub",
      reason: "Connect GitHub to allow me to search repository code, pull requests, and issues.",
    })) as any

    expect(res.ok).toBe(true)
    expect(res.suggested).toBe(true)
    expect(res.source).toBe("github")
    expect(res.name).toBe("GitHub")
    expect(res.reason).toContain("search repository code")
  })

  it("supports composio app toolkit parameter", async () => {
    const res = (await tool.execute({
      source: "composio",
      name: "Composio",
      app: "gmail",
      reason: "Connect Gmail via Composio to check unread emails.",
    })) as any

    expect(res.ok).toBe(true)
    expect(res.app).toBe("gmail")
  })

  it("supports catalog marketplace apps", async () => {
    const res = (await tool.execute({
      source: "clickup",
      name: "ClickUp",
      reason: "Connect ClickUp to manage and sync tasks in your workspace.",
    })) as any

    expect(res.ok).toBe(true)
    expect(res.source).toBe("clickup")
    expect(res.name).toBe("ClickUp")
  })
})
