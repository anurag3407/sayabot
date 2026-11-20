import { PassThrough } from "node:stream"

import { describe, expect, it } from "vitest"

import { HttpError, RpcError } from "./client.js"
import { serveMcpStdio } from "./stdio.js"

async function bridge(
  lines: string[],
  post: (payload: unknown) => Promise<unknown>,
): Promise<Array<Record<string, unknown>>> {
  const input = new PassThrough()
  const output = new PassThrough()
  const chunks: string[] = []
  output.on("data", (chunk: Buffer) => chunks.push(String(chunk)))

  const done = serveMcpStdio({ post, input, output })
  for (const line of lines) input.write(`${line}\n`)
  input.end()
  await done

  return chunks
    .join("")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("serveMcpStdio", () => {
  it("forwards a request and writes the server's response back verbatim", async () => {
    const seen: unknown[] = []
    const frames = await bridge(
      ['{"jsonrpc":"2.0","id":7,"method":"tools/list"}'],
      async (payload) => {
        seen.push(payload)
        return { jsonrpc: "2.0", id: 7, result: { tools: [] } }
      },
    )

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ method: "tools/list" })
    expect(frames).toEqual([{ jsonrpc: "2.0", id: 7, result: { tools: [] } }])
  })

  it("stays silent for notifications, which the server answers 202", async () => {
    const frames = await bridge(
      ['{"jsonrpc":"2.0","method":"notifications/initialized"}'],
      async () => null,
    )

    expect(frames).toEqual([])
  })

  it("never replies to a notification, even if the server answers with a body", async () => {
    const frames = await bridge(['{"jsonrpc":"2.0","method":"notifications/initialized"}'], async () => ({
      jsonrpc: "2.0",
      error: { code: -32601, message: "method not found" },
    }))

    expect(frames).toEqual([])
  })

  it("reports a parse error without calling the server", async () => {
    let calls = 0
    const frames = await bridge(["{not json"], async () => {
      calls += 1
      return null
    })

    expect(calls).toBe(0)
    expect(frames[0]).toMatchObject({ id: null, error: { code: -32700 } })
  })

  it("answers each request id in a batch when the request fails", async () => {
    const frames = await bridge(
      ['[{"jsonrpc":"2.0","id":1,"method":"a"},{"jsonrpc":"2.0","id":2,"method":"b"}]'],
      async () => {
        throw new HttpError(500, "HTTP 500")
      },
    )

    // A batch is answered with a single JSON array, so the client sees one frame of two responses.
    expect(frames).toHaveLength(1)
    const batch = frames[0] as unknown as Array<{ id: number; error: { code: number } }>
    expect(batch.map((frame) => frame.id)).toEqual([1, 2])
    expect(batch[0]).toMatchObject({ error: { code: -32603 } })
  })

  it("keeps a JSON-RPC error code from the server", async () => {
    const frames = await bridge(['{"jsonrpc":"2.0","id":3,"method":"x"}'], async () => {
      throw new RpcError(-32601, "method not found")
    })

    expect(frames[0]).toMatchObject({ id: 3, error: { code: -32601, message: "method not found" } })
  })

  it("ignores blank lines", async () => {
    let calls = 0
    const frames = await bridge(["", "   "], async () => {
      calls += 1
      return null
    })

    expect(calls).toBe(0)
    expect(frames).toEqual([])
  })
})
