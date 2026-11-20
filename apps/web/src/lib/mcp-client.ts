/**
 * The one place the web app opens an MCP connection: "list tools" (the connection test every
 * marketplace app runs on connect) and "try a tool". Keeping both on one builder means the URL
 * rules and header handling cannot drift between them, and the integration suite can drive the
 * real code against a local server.
 *
 * Deliberately free of `server-only` imports: the key-encryption key and the OAuth provider are
 * passed in by the caller (`lib/actions/mcp.ts`).
 */

import { createMCPClient } from "@ai-sdk/mcp"
import type { OAuthClientProvider } from "@ai-sdk/mcp"
import { openSecret } from "@sayabot/llm"

/** Local programs run when an agent uses them, not from the web app's tool inspector. */
export const STDIO_TOOLS_MESSAGE = "This program runs when an agent uses it."

export interface McpServerRow {
  id: string
  name: string
  transport: string
  url: string
  headers_enc: string | null
}

export interface McpConnectOptions {
  kek: string
  authProvider?: OAuthClientProvider
}

export interface McpToolSummary {
  name: string
  description: string
}

/**
 * Same rule the orchestrator enforces at run time (`packages/llm/src/mcp.ts`): HTTPS only,
 * unless ALLOW_LOCAL_MCP is on; never credentials or a fragment in the URL. Checking it here
 * means the settings "connected" result can't promise a server agents will refuse to use.
 */
export function assertMcpUrl(url: string): void {
  const parsed = new URL(url)
  const allowLocal = process.env.ALLOW_LOCAL_MCP === "true"
  if (parsed.protocol !== "https:" && !(allowLocal && parsed.protocol === "http:")) {
    throw new Error("MCP URL must use HTTPS (HTTP requires ALLOW_LOCAL_MCP)")
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error("MCP URL cannot contain credentials or a fragment")
  }
}

/** Sealed headers (`{ headers }`) or a local program's environment (`{ env }`, ignored here). */
export function mcpHeadersFor(row: McpServerRow, kek: string): Record<string, string> {
  if (!row.headers_enc) return {}
  const parsed = JSON.parse(openSecret(row.headers_enc, kek)) as {
    headers?: Record<string, string>
  }
  return parsed.headers ?? {}
}

export function assertMcpTestable(row: McpServerRow): void {
  if (row.transport === "stdio") throw new Error(STDIO_TOOLS_MESSAGE)
  if (row.transport !== "http" && row.transport !== "sse")
    throw new Error("Unsupported MCP transport")
}

export async function connectMcpServer(row: McpServerRow, opts: McpConnectOptions) {
  assertMcpTestable(row)
  assertMcpUrl(row.url)
  return createMCPClient({
    transport: {
      type: row.transport as "http" | "sse",
      url: row.url,
      headers: mcpHeadersFor(row, opts.kek),
      redirect: "error",
      ...(opts.authProvider ? { authProvider: opts.authProvider } : {}),
    },
  })
}

/** The connection test: what a marketplace app runs right after it is saved. */
export async function listMcpServerTools(
  row: McpServerRow,
  opts: McpConnectOptions,
): Promise<McpToolSummary[]> {
  const client = await connectMcpServer(row, opts)
  try {
    const result = await client.listTools()
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
    }))
  } finally {
    await client.close().catch(() => {})
  }
}

export async function callMcpServerTool(
  row: McpServerRow,
  opts: McpConnectOptions,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: unknown[]; isError: boolean }> {
  const client = await connectMcpServer(row, opts)
  try {
    const result = (await client.callTool({ name: toolName, arguments: args })) as {
      content?: unknown[]
      isError?: boolean
    }
    return { content: result.content ?? [], isError: result.isError === true }
  } finally {
    await client.close().catch(() => {})
  }
}
