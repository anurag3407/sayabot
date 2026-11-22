/**
 * Sayabot's room tools for Agent Client Protocol apps (Antigravity, Copilot, Cursor, Gemini,
 * Kiro…). ACP apps start the MCP servers the client lists in session/new, and every ACP app
 * must support stdio servers, so the runner lists this file as one: Electron runs it as plain Node
 * (ELECTRON_RUN_AS_NODE=1) and it forwards each JSON-RPC line to the room's MCP endpoint with the
 * one-run token.
 *
 * It also hides the tools the runner does for the agent (posting the reply, waiting for activity,
 * secrets), which an ACP app has no flag to turn off: they're left out of tools/list and refused
 * if called anyway.
 *
 * No dependencies on purpose: it only speaks newline-delimited JSON-RPC. stdout carries protocol
 * frames only.
 */
import * as readline from "node:readline"

/** Room tools the runner handles itself; matches BLOCKED_ROOM_TOOLS in runner.ts. */
export const HIDDEN_ROOM_TOOLS: readonly string[] = [
  "post_message",
  "wait_for_activity",
  "use_secret",
]

type Json = Record<string, unknown>

const REQUEST_TIMEOUT_MS = 120_000

function record(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

/** A tools/list result without the hidden tools. Anything else passes through untouched. */
export function withoutHiddenTools(method: string | undefined, response: unknown): unknown {
  if (method !== "tools/list") return response
  const message = record(response)
  const result = record(message?.result)
  if (!message || !result || !Array.isArray(result.tools)) return response
  return {
    ...message,
    result: {
      ...result,
      tools: result.tools.filter((tool) => !HIDDEN_ROOM_TOOLS.includes(String(record(tool)?.name))),
    },
  }
}

/** The refusal for a hidden tool, or null when the call may go to the server. */
export function hiddenToolRefusal(message: Json): Json | null {
  if (message.method !== "tools/call") return null
  const name = String(record(message.params)?.name ?? "")
  if (!HIDDEN_ROOM_TOOLS.includes(name)) return null
  return {
    jsonrpc: "2.0",
    id: message.id ?? null,
    result: {
      isError: true,
      content: [
        {
          type: "text",
          text: `${name} isn't available here: your reply is posted to the room for you.`,
        },
      ],
    },
  }
}

/** The JSON-RPC messages in a response body: plain JSON, or the data lines of an event stream. */
export function responseMessages(contentType: string, body: string): unknown[] {
  if (!body.trim()) return []
  if (contentType.includes("text/event-stream")) {
    const out: unknown[] = []
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
      if (!data) continue
      try {
        out.push(JSON.parse(data))
      } catch {
        // not a JSON-RPC frame
      }
    }
    return out
  }
  try {
    const parsed: unknown = JSON.parse(body)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

function errorFrame(id: unknown, message: string): Json {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32603, message } }
}

/**
 * One MCP connection to the room's endpoint: `send` posts one JSON-RPC message and returns the
 * frames to hand back (none for a notification). Hidden tools are refused here and dropped from tools/list.
 */
export class RoomMcpClient {
  private sessionId: string | null = null

  constructor(
    private url: string,
    private token: string,
    private doFetch: typeof fetch = fetch,
  ) {}

  async send(message: Json): Promise<unknown[]> {
    const isRequest = message.id !== undefined && message.id !== null
    const refusal = hiddenToolRefusal(message)
    if (refusal) return isRequest ? [refusal] : []
    if (!this.url || !this.token) {
      return isRequest
        ? [errorFrame(message.id, "Sayabot room tools aren't set up for this run.")]
        : []
    }
    try {
      const response = await this.doFetch(this.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      this.sessionId = response.headers.get("mcp-session-id") ?? this.sessionId
      const body = await response.text()
      if (!response.ok) {
        return isRequest
          ? [
              errorFrame(
                message.id,
                response.status === 401
                  ? "This run's room tools have expired."
                  : `Sayabot answered HTTP ${response.status}.`,
              ),
            ]
          : []
      }
      if (!isRequest) return []
      const method = typeof message.method === "string" ? message.method : undefined
      return responseMessages(response.headers.get("content-type") ?? "", body).map((frame) =>
        withoutHiddenTools(method, frame),
      )
    } catch (error) {
      return isRequest
        ? [
            errorFrame(
              message.id,
              `Couldn't reach Sayabot: ${error instanceof Error ? error.message : String(error)}`,
            ),
          ]
        : []
    }
  }
}

function main(): void {
  const client = new RoomMcpClient(
    process.env.SAYABOT_MCP_URL ?? "",
    process.env.SAYABOT_MCP_TOKEN ?? "",
  )
  const write = (frame: unknown) => process.stdout.write(`${JSON.stringify(frame)}\n`)
  readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
    if (!line.trim()) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })
      return
    }
    const message = record(parsed)
    if (message) void client.send(message).then((frames) => frames.forEach(write))
  })
}

// Only when started as the MCP server, not when a test imports the helpers.
if (typeof require !== "undefined" && require.main === module) main()
