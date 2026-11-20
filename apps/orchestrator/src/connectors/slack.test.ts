import { describe, expect, it, vi } from "vitest"
import { SlackConnector } from "./slack"

function channelListResponse(names: Record<string, string>) {
  return {
    ok: true,
    channels: Object.entries(names).map(([id, name]) => ({ id, name })),
  }
}

describe("SlackConnector channel scope", () => {
  it("accepts a channel id granted as a name", async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify(channelListResponse({ C1: "general" }))),
    )
    const client = new SlackConnector({ botToken: "xoxb-test", fetchFn: fetchFn as any })

    await expect(client.assertChannelAllowed("C1", ["general"])).resolves.toBeUndefined()
  })

  it("accepts a channel name granted as a name", async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify(channelListResponse({ C1: "general" }))),
    )
    const client = new SlackConnector({ botToken: "xoxb-test", fetchFn: fetchFn as any })

    await expect(client.assertChannelAllowed("#general", ["general"])).resolves.toBeUndefined()
  })

  it("accepts ids without asking Slack for the channel list", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(channelListResponse({}))))
    const client = new SlackConnector({ botToken: "xoxb-test", fetchFn: fetchFn as any })

    await expect(client.assertChannelAllowed("C0ABC123", ["C0ABC123"])).resolves.toBeUndefined()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("rejects a channel outside the grant", async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify(channelListResponse({ C1: "general" }))),
    )
    const client = new SlackConnector({ botToken: "xoxb-test", fetchFn: fetchFn as any })

    await expect(client.assertChannelAllowed("C2", ["general"])).rejects.toThrow(
      /outside this agent's allowed list/i,
    )
  })

  it("allows everything when the grant does not restrict channels", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(channelListResponse({}))))
    const client = new SlackConnector({ botToken: "xoxb-test", fetchFn: fetchFn as any })

    await expect(client.assertChannelAllowed("C9", [])).resolves.toBeUndefined()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
