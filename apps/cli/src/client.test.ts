import { describe, expect, it } from "vitest"

import { HttpError, RpcError, SayabotClient, mcpEndpoint } from "./client.js"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

interface Captured {
  url: string
  headers: Record<string, string>
  body: unknown
}

function clientWith(handler: (request: Captured) => Response | Promise<Response>) {
  const captured: Captured[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: Captured = {
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    }
    captured.push(request)
    return await handler(request)
  }) as typeof fetch

  return {
    client: new SayabotClient({ url: "http://127.0.0.1:8787/", key: "saaya_ak_test", fetchImpl }),
    captured,
  }
}

describe("SayabotClient", () => {
  it("posts to /v1/mcp with the key in an authorization header, never the URL", async () => {
    const { client, captured } = clientWith(() =>
      jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }),
    )

    await client.request("tools/list")

    expect(captured[0]?.url).toBe("http://127.0.0.1:8787/v1/mcp")
    expect(mcpEndpoint("https://sayabot.example/api/v1/mcp")).toBe(
      "https://sayabot.example/api/v1/mcp",
    )
    expect(captured[0]?.headers.authorization).toBe("Bearer saaya_ak_test")
    expect(captured[0]?.url).not.toContain("saaya_ak_test")
    expect(captured[0]?.body).toMatchObject({ jsonrpc: "2.0", method: "tools/list" })
  })

  it("returns the result payload", async () => {
    const { client } = clientWith(() =>
      jsonResponse({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "check_in" }] } }),
    )

    const tools = await client.listTools()

    expect(tools).toEqual([{ name: "check_in" }])
  })

  it("turns a JSON-RPC error into an RpcError with the server's code", async () => {
    const { client } = clientWith(() =>
      jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "method not found" },
      }),
    )

    await expect(client.request("nope")).rejects.toBeInstanceOf(RpcError)
    await expect(client.request("nope")).rejects.toMatchObject({ code: -32601 })
  })

  it("raises an HttpError that hints at the key on 401", async () => {
    const { client } = clientWith(() => new Response("unauthorized", { status: 401 }))

    const error = await client.request("tools/list").catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(401)
    expect((error as Error).message).toContain("Settings → Bots")
  })

  it("treats 202 as no body, which is how notifications are answered", async () => {
    const { client } = clientWith(() => new Response(null, { status: 202 }))

    await expect(
      client.post({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ).resolves.toBeNull()
  })

  it("sends the tool name and arguments unchanged", async () => {
    const { client, captured } = clientWith(() =>
      jsonResponse({ jsonrpc: "2.0", id: 1, result: { structuredContent: { ok: true } } }),
    )

    const result = await client.callTool("post_message", { content: "hi" })

    expect(result.structuredContent).toEqual({ ok: true })
    expect(captured[0]?.body).toMatchObject({
      method: "tools/call",
      params: { name: "post_message", arguments: { content: "hi" } },
    })
  })
})
