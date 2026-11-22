import { describe, expect, it } from "vitest"
import { hiddenToolRefusal, responseMessages, RoomMcpClient, withoutHiddenTools } from "./room-mcp"

describe("room-mcp bridge", () => {
  it("leaves the runner's own tools out of tools/list", () => {
    const response = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [{ name: "create_task" }, { name: "post_message" }, { name: "use_secret" }],
      },
    }
    expect(withoutHiddenTools("tools/list", response)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [{ name: "create_task" }] },
    })
    expect(withoutHiddenTools("tools/call", response)).toBe(response)
  })

  it("refuses a hidden tool without asking the server", () => {
    const call = { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "post_message" } }
    expect(hiddenToolRefusal(call)).toMatchObject({ id: 7, result: { isError: true } })
    expect(
      hiddenToolRefusal({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "x" } }),
    ).toBeNull()
    expect(hiddenToolRefusal({ jsonrpc: "2.0", id: 9, method: "tools/list" })).toBeNull()
  })

  it("reads JSON bodies and event streams", () => {
    expect(responseMessages("application/json", '{"id":1}')).toEqual([{ id: 1 }])
    expect(responseMessages("application/json", '[{"id":1},{"id":2}]')).toEqual([
      { id: 1 },
      { id: 2 },
    ])
    expect(
      responseMessages("text/event-stream", 'event: message\ndata: {"id":3}\n\ndata: oops\n\n'),
    ).toEqual([{ id: 3 }])
    expect(responseMessages("application/json", "")).toEqual([])
  })
})

describe("RoomMcpClient", () => {
  const reply = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
    new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json", ...init.headers },
    })

  it("posts with the token, keeps the MCP session and filters tools/list", async () => {
    const calls: Array<{ auth: string | null; session: string | null }> = []
    const fake = (async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      calls.push({ auth: headers.get("authorization"), session: headers.get("mcp-session-id") })
      return reply(
        {
          jsonrpc: "2.0",
          id: 1,
          result: { tools: [{ name: "create_task" }, { name: "use_secret" }] },
        },
        { headers: { "mcp-session-id": "s-1" } },
      )
    }) as unknown as typeof fetch
    const client = new RoomMcpClient("https://s.example/api/v1/mcp", "tok", fake)
    const first = await client.send({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    await client.send({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    expect(first).toEqual([{ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "create_task" }] } }])
    expect(calls).toEqual([
      { auth: "Bearer tok", session: null },
      { auth: "Bearer tok", session: "s-1" },
    ])
  })

  it("answers errors as JSON-RPC errors and notifications with nothing", async () => {
    const expired = (async () => reply({}, { status: 401 })) as unknown as typeof fetch
    const client = new RoomMcpClient("https://s.example/api/v1/mcp", "tok", expired)
    expect(await client.send({ jsonrpc: "2.0", id: 3, method: "tools/list" })).toEqual([
      {
        jsonrpc: "2.0",
        id: 3,
        error: { code: -32603, message: "This run's room tools have expired." },
      },
    ])
    expect(await client.send({ jsonrpc: "2.0", method: "notifications/initialized" })).toEqual([])
    expect(
      await new RoomMcpClient("", "", expired).send({ jsonrpc: "2.0", id: 4, method: "x" }),
    ).toMatchObject([{ id: 4, error: { message: /aren't set up/ } }])
  })
})
