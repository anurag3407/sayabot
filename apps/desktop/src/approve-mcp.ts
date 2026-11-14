/**
 * Claude Code's permission prompt for agents running on this Mac (`--permission-prompt-tool
 * mcp__sayabot_mac__approve`). Claude starts this as a tiny stdio MCP server (Electron as plain
 * Node: ELECTRON_RUN_AS_NODE=1). Each `approve` call is handed to the Sayabot app over a private
 * socket; the app turns it into an approval card the Mac's owner can answer from the web, the
 * phone or this Mac, and the answer comes back here as allow or deny.
 *
 * No dependencies on purpose: it only speaks newline-delimited JSON-RPC.
 */
import * as net from "node:net"
import * as readline from "node:readline"

const SOCKET = process.env.SAYABOT_APPROVAL_SOCKET ?? ""
/** Longer than the server's five-minute approval window, so the server's answer always wins. */
const ANSWER_TIMEOUT_MS = 6 * 60_000

interface Rpc {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

interface Decision {
  behavior: "allow" | "deny"
  updatedInput?: Record<string, unknown>
  message?: string
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)
}

/** Asks the Sayabot app; any failure means "no", never a silent yes. */
function ask(request: {
  tool_name: string
  input: Record<string, unknown>
  tool_use_id: string
}): Promise<Decision> {
  const deny = (message: string): Decision => ({ behavior: "deny", message })
  if (!SOCKET) return Promise.resolve(deny("Sayabot couldn't ask anyone, so this wasn't allowed."))
  return new Promise((resolve) => {
    let settled = false
    let buffer = ""
    const done = (decision: Decision) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(decision)
    }
    const timer = setTimeout(() => done(deny("Nobody answered in time.")), ANSWER_TIMEOUT_MS)
    const socket = net.createConnection(SOCKET, () => {
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const line = buffer.split("\n")[0]
      if (!buffer.includes("\n") || !line) return
      try {
        const parsed = JSON.parse(line) as Decision
        if (parsed.behavior === "allow") {
          done({ behavior: "allow", updatedInput: parsed.updatedInput ?? request.input })
        } else {
          done(deny(parsed.message || "The owner said no."))
        }
      } catch {
        done(deny("Sayabot sent an answer it couldn't read."))
      }
    })
    socket.on("error", () => done(deny("Sayabot isn't reachable, so this wasn't allowed.")))
    socket.on("close", () => done(deny("Sayabot stopped waiting for an answer.")))
  })
}

const TOOL = {
  name: "approve",
  description:
    "Asks the owner of this Mac whether the agent may take a step that needs permission.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string" },
      input: { type: "object" },
      tool_use_id: { type: "string" },
    },
    required: ["tool_name", "input"],
  },
}

async function handle(message: Rpc): Promise<void> {
  const { id, method, params } = message
  if (method === "initialize") {
    send({
      id,
      result: {
        protocolVersion:
          typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "sayabot_mac", version: "1.0.0" },
      },
    })
    return
  }
  if (method === "tools/list") {
    send({ id, result: { tools: [TOOL] } })
    return
  }
  if (method === "tools/call") {
    const args = (params?.arguments ?? {}) as Record<string, unknown>
    const decision = await ask({
      tool_name: String(args.tool_name ?? "unknown"),
      input: (args.input && typeof args.input === "object" ? args.input : {}) as Record<
        string,
        unknown
      >,
      tool_use_id: String(args.tool_use_id ?? `approval-${Date.now()}`),
    })
    send({ id, result: { content: [{ type: "text", text: JSON.stringify(decision) }] } })
    return
  }
  if (method === "ping") {
    send({ id, result: {} })
    return
  }
  // Notifications (no id) need no answer; unknown requests get a proper error.
  if (id !== undefined && id !== null)
    send({ id, error: { code: -32601, message: `Unknown method ${method}` } })
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return
  let message: Rpc
  try {
    message = JSON.parse(line) as Rpc
  } catch {
    return
  }
  void handle(message)
})
