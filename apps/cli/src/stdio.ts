import { createInterface } from "node:readline"

import { HttpError, RpcError } from "./client.js"

/**
 * stdio transport for MCP: newline-delimited JSON-RPC on stdin and stdout, diagnostics on stderr.
 *
 * Nothing is interpreted here. Each line is parsed, forwarded to the orchestrator's `/v1/mcp`
 * endpoint and the answer is written back, which keeps this bridge byte-compatible with whatever
 * the server grows. stdout carries protocol frames only — a stray `console.log` would corrupt the
 * stream, so all logging goes through `log`.
 */

export interface StdioBridgeOptions {
  post: (payload: unknown) => Promise<unknown>
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  log?: (message: string) => void
}

interface JsonRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

const PARSE_ERROR: JsonRpcErrorObject = { code: -32700, message: "Parse error" }

function errorFor(error: unknown): JsonRpcErrorObject {
  if (error instanceof RpcError)
    return { code: error.code, message: error.message, data: error.data }
  if (error instanceof HttpError) return { code: -32603, message: error.message }
  return { code: -32603, message: error instanceof Error ? error.message : String(error) }
}

/** The `id` of each request in a payload; notifications (no `id`) are omitted. */
function requestIds(payload: unknown): Array<string | number | null> {
  const items = Array.isArray(payload) ? payload : [payload]
  const ids: Array<string | number | null> = []
  for (const item of items) {
    if (item && typeof item === "object" && "id" in item) {
      ids.push((item as { id?: string | number | null }).id ?? null)
    }
  }
  return ids
}

export async function serveMcpStdio(options: StdioBridgeOptions): Promise<void> {
  const lines = createInterface({ input: options.input, crlfDelay: Infinity, terminal: false })

  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let payload: unknown
    try {
      payload = JSON.parse(trimmed)
    } catch {
      options.output.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: PARSE_ERROR })}\n`)
      continue
    }

    const ids = requestIds(payload)

    try {
      const response = await options.post(payload)
      if (response === null || response === undefined) continue
      // A notification has no `id`, so it must never produce a reply — even if a server
      // answers with a body instead of the `202` the orchestrator sends.
      if (ids.length === 0) continue
      options.output.write(`${JSON.stringify(response)}\n`)
    } catch (error) {
      const errorObject = errorFor(error)
      if (ids.length === 0) {
        options.log?.(`${errorObject.message} (notification had no reply)`)
        continue
      }
      const frames = ids.map((id) => ({ jsonrpc: "2.0", id, error: errorObject }))
      options.output.write(`${JSON.stringify(Array.isArray(payload) ? frames : frames[0])}\n`)
    }
  }
}
