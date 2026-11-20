import { describe, expect, it } from "vitest"
import {
  ComposioConnector,
  isReadOnlyComposioTool,
  toolkitOfSlug,
} from "./composio"

describe("ComposioConnector", () => {
  it("determines toolkit slug correctly", () => {
    expect(toolkitOfSlug("GMAIL_FETCH_EMAILS")).toBe("gmail")
    expect(toolkitOfSlug("SLACK_SEND_MESSAGE")).toBe("slack")
    expect(toolkitOfSlug("NOTION_QUERY_DATABASE")).toBe("notion")
  })

  it("identifies read-only tools vs mutating actions", () => {
    expect(isReadOnlyComposioTool("GMAIL_FETCH_EMAILS")).toBe(true)
    expect(isReadOnlyComposioTool("NOTION_QUERY_DATABASE")).toBe(true)
    expect(isReadOnlyComposioTool("SLACK_LIST_CHANNELS")).toBe(true)
    expect(isReadOnlyComposioTool("SLACK_SEND_MESSAGE")).toBe(false)
    expect(isReadOnlyComposioTool("GITHUB_CREATE_PULL_REQUEST")).toBe(false)
    expect(isReadOnlyComposioTool("HUBSPOT_DELETE_CONTACT")).toBe(false)
  })

  it("handles network errors and failure responses gracefully", async () => {
    const connector = new ComposioConnector({
      apiKey: "invalid-key",
      fetchFn: async () =>
        new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401 }),
    })

    await expect(connector.toolkits()).rejects.toThrow(/Composio \/toolkits failed \(401\)/)
  })
})
