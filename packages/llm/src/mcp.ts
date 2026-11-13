import { createHash } from "node:crypto"
import { createMCPClient } from "@ai-sdk/mcp"
import { assertSafeEgressHost } from "@sayabot/core/server"
import type { OAuthClientProvider } from "@ai-sdk/mcp"
import type { ToolSet } from "ai"

export interface McpServerConfig {
  id: string
  name: string
  transport: "http" | "sse" | "stdio"
  url: string
  headers?: Record<string, string>
  /** Local programs only. `npx` with a catalog argv; never a path the user typed. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** Sign-in servers: adds the bearer token and refreshes it on a 401. */
  authProvider?: OAuthClientProvider
  /**
   * Tool names that wait for a person's OK. `*` means every tool; `@writes` means every tool
   * whose name does not start with a read verb (get, list, search, ...), for catalog apps whose
   * tool names are not known ahead of time.
   */
  dangerousTools: string[]
}

const READ_VERBS = /^(get|list|search|read|fetch|find|lookup|view|describe|retrieve|show|whoami|count|preview|download)(_|-|$|[A-Z])/

/** Whether a call to `toolName` on this server needs a person's OK first. */
export function isDangerousMcpTool(dangerousTools: string[], toolName: string): boolean {
  if (dangerousTools.includes(toolName) || dangerousTools.includes("*")) return true
  if (dangerousTools.includes("@writes")) return !READ_VERBS.test(toolName)
  return false
}

export interface McpToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface McpToolMeta {
  serverId: string
  serverName: string
  originalName: string
  dangerous: boolean
  /** Display-only server claims. Never grant permissions or waive approval based on these. */
  annotations?: McpToolAnnotations
}

export interface McpToolsResult {
  tools: ToolSet
  meta: Record<string, McpToolMeta>
  errors: { serverName: string; message: string }[]
  call: (serverId: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
  close: () => Promise<void>
}

export interface McpConnectionOptions {
  signal?: AbortSignal
  /** Per-server startup budget, including DNS, initialization and all tool-list pages. */
  timeoutMs?: number
  callTimeoutMs?: number
  closeTimeoutMs?: number
}

type Client = Awaited<ReturnType<typeof createMCPClient>>

/** A tool reported failure via `isError`; the server connection is still healthy. */
export class McpToolError extends Error {
  override name = "McpToolError"
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export function mcpToolName(serverName: string, toolName: string): string {
  const slug = serverName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_") || "tool"
  return `${slug || "mcp"}__${safeTool}`.slice(0, 64)
}

function budget(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1 || value > 60_000) throw new Error("Invalid MCP timeout budget")
  return value
}

/** Bound even transports that fail to settle after cancellation; still pass the signal to the SDK. */
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, ms: number, external?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const signal = external ? AbortSignal.any([external, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(new Error("MCP operation timed out")), ms)
  let onAbort: () => void = () => {}
  try {
    signal.throwIfAborted()
    return await Promise.race([
      Promise.resolve().then(() => { signal.throwIfAborted(); return operation(signal) }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason ?? new Error("MCP operation aborted"))
        signal.addEventListener("abort", onAbort, { once: true })
        if (signal.aborted) onAbort()
      }),
    ])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", onAbort)
  }
}

function safeAnnotations(value: unknown): McpToolAnnotations | undefined {
  if (!value || typeof value !== "object") return undefined
  const input = value as Record<string, unknown>
  const output: McpToolAnnotations = {}
  if (typeof input.title === "string") output.title = input.title.slice(0, 200)
  for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
    if (typeof input[key] === "boolean") output[key] = input[key]
  }
  return Object.keys(output).length ? output : undefined
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  if (!Array.isArray(result.content)) throw new Error("Invalid MCP tool response")
  return result.content.map((part: unknown) => {
    if (!part || typeof part !== "object" || !("type" in part) || typeof part.type !== "string") {
      throw new Error("Invalid MCP content part")
    }
    if (part.type === "text") {
      if (!("text" in part) || typeof part.text !== "string") throw new Error("Invalid MCP text content")
      return part.text
    }
    if (part.type === "resource") {
      const resource = "resource" in part ? part.resource : undefined
      if (!resource || typeof resource !== "object" || !("uri" in resource) || typeof resource.uri !== "string") {
        throw new Error("Invalid MCP resource content")
      }
      return "text" in resource && typeof resource.text === "string" ? resource.text : `[resource ${resource.uri}]`
    }
    return `[${part.type}]`
  }).join("\n")
}

/** Only catalog programs: `npx -y <package>` with optional extra args that are not flags. */
function stdioTransport(server: McpServerConfig): { command: string; args: string[]; env: Record<string, string>; stderr: "ignore" } {
  const args = server.args ?? []
  const packageArg = args[1] ?? ""
  if (
    server.command !== "npx" ||
    args[0] !== "-y" ||
    !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(packageArg) ||
    args.slice(2).some((arg) => arg.startsWith("-") || /[\s]/.test(arg))
  ) {
    throw new Error("This local app isn't one Sayabot can start")
  }
  const env: Record<string, string> = {}
  if (process.env.PATH) env.PATH = process.env.PATH
  if (process.env.HOME) env.HOME = process.env.HOME
  for (const [key, value] of Object.entries(server.env ?? {})) {
    if (!/^[A-Z][A-Z0-9_]{0,40}$/.test(key) || typeof value !== "string") throw new Error("Invalid environment for a local app")
    env[key] = value
  }
  return { command: "npx", args: [...args], env, stderr: "ignore" }
}

/** Fail individual servers closed, leaving healthy configured servers available. */
export async function connectMcpServers(servers: McpServerConfig[], options: McpConnectionOptions = {}): Promise<McpToolsResult> {
  const timeoutMs = budget(options.timeoutMs, 15_000)
  const callTimeoutMs = budget(options.callTimeoutMs, 30_000)
  const closeTimeoutMs = budget(options.closeTimeoutMs, 2_000)
  const tools: ToolSet = {}
  const meta: Record<string, McpToolMeta> = {}
  const errors: McpToolsResult["errors"] = []
  const clients = new Map<string, Client>()
  const discovered = new Map<string, Set<string>>()
  const closing = new WeakMap<Client, Promise<void>>()
  const lifetime = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal
  let closed = false
  const closeClient = (client: Client): Promise<void> => {
    let promise = closing.get(client)
    if (!promise) {
      promise = bounded(() => client.close(), closeTimeoutMs).catch(() => {})
      closing.set(client, promise)
    }
    return promise
  }
  const removeServer = (id: string) => {
    const client = clients.get(id)
    clients.delete(id)
    discovered.delete(id)
    for (const [name, info] of Object.entries(meta)) {
      if (info.serverId === id) { delete meta[name]; delete tools[name] }
    }
    return client
  }
  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (closePromise) return closePromise
    closed = true
    options.signal?.removeEventListener("abort", onAbort)
    lifetime.abort(new Error("MCP connections closed"))
    const active = [...clients.values()]
    clients.clear()
    discovered.clear()
    closePromise = Promise.all(active.map(closeClient)).then(() => {})
    return closePromise
  }
  const onAbort = () => { void close() }
  options.signal?.addEventListener("abort", onAbort, { once: true })
  if (options.signal?.aborted) await close()

  const candidates: Array<{ server: McpServerConfig; originalName: string; definition: ToolSet[string]; annotations?: McpToolAnnotations }> = []
  const sorted = [...servers].sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id) || compare(a.url, b.url))
  const idCounts = new Map<string, number>()
  for (const server of sorted) idCounts.set(server.id, (idCounts.get(server.id) ?? 0) + 1)
  // Connect servers concurrently so startup costs the slowest server, not the sum.
  const connectOne = async (server: McpServerConfig) => {
    let client: Client | undefined
    let failed = false
    try {
      if (!server.id || idCounts.get(server.id) !== 1) throw new Error("Duplicate or empty MCP server ID")
      if (server.transport !== "http" && server.transport !== "sse" && server.transport !== "stdio") {
        throw new Error("Unsupported MCP transport")
      }
      const stdio = server.transport === "stdio" ? stdioTransport(server) : null
      const url = stdio ? null : new URL(server.url)
      const allowLocal = process.env.ALLOW_LOCAL_MCP === "true"
      if (url && url.protocol !== "https:" && !(allowLocal && url.protocol === "http:")) {
        throw new Error("MCP URL must use HTTPS (HTTP requires ALLOW_LOCAL_MCP)")
      }
      if (url && (url.username || url.password || url.hash)) throw new Error("MCP URL cannot contain credentials or a fragment")
      const result = await bounded(async (requestSignal) => {
        if (url && !allowLocal) await assertSafeEgressHost(url.hostname)
        requestSignal.throwIfAborted()
        const transport = stdio
          ? new (await import("@ai-sdk/mcp/mcp-stdio")).StdioMCPTransport(stdio)
          : {
              type: server.transport as "http" | "sse",
              url: url!.href,
              headers: server.headers,
              redirect: "error" as const,
              ...(server.authProvider ? { authProvider: server.authProvider } : {}),
            }
        client = await createMCPClient({
          transport,
          initializationOptions: { signal: requestSignal, timeout: timeoutMs, maxTotalTimeout: timeoutMs },
          maxRetries: 0,
          onUncaughtError: () => {
            failed = true
            removeServer(server.id)
            if (client) void closeClient(client)
          },
        })
        // A non-cooperative transport may resolve after the outer deadline.
        if (requestSignal.aborted || failed) {
          void closeClient(client)
          throw new Error("MCP initialization cancelled or failed")
        }
        const definitions: Awaited<ReturnType<Client["listTools"]>>["tools"] = []
        const names = new Set<string>()
        const cursors = new Set<string>()
        let cursor: string | undefined
        do {
          requestSignal.throwIfAborted()
          const page = await client.listTools({
            params: cursor === undefined ? undefined : { cursor },
            options: { signal: requestSignal, timeout: timeoutMs, maxTotalTimeout: timeoutMs },
          })
          requestSignal.throwIfAborted()
          for (const definition of page.tools) {
            if (!definition.name || names.has(definition.name)) throw new Error("MCP returned duplicate or empty tool names")
            names.add(definition.name)
            definitions.push(definition)
          }
          if (definitions.length > 1_000) throw new Error("MCP tool catalog exceeds limit")
          cursor = page.nextCursor
          if (cursor !== undefined) {
            if (cursors.has(cursor) || cursors.size >= 100) throw new Error("MCP tool pagination exceeds limit")
            cursors.add(cursor)
          }
        } while (cursor !== undefined)
        if (failed) throw new Error("MCP connection failed during discovery")
        definitions.sort((a, b) => compare(a.name, b.name))
        const serverTools = client.toolsFromDefinitions({ tools: definitions })
        return { definitions, serverTools, names }
      }, timeoutMs, signal)
      if (!client || failed || signal.aborted) throw new Error("MCP connection unavailable")
      clients.set(server.id, client)
      discovered.set(server.id, result.names)
      for (const definition of result.definitions) {
        const tool = result.serverTools[definition.name]
        if (!tool) throw new Error("MCP tool definition missing")
        candidates.push({ server, originalName: definition.name, definition: tool, annotations: safeAnnotations(definition.annotations) })
      }
    } catch (error) {
      failed = true
      removeServer(server.id)
      if (client) await closeClient(client)
      errors.push({ serverName: server.name, message: error instanceof Error ? error.message : String(error) })
    }
  }
  await Promise.all(sorted.map(connectOne))
  errors.sort((a, b) => compare(a.serverName, b.serverName) || compare(a.message, b.message))

  const callRaw = async (serverId: string, toolName: string, args: Record<string, unknown>, callSignal?: AbortSignal) => {
    const client = clients.get(serverId)
    if (closed || !client || !discovered.get(serverId)?.has(toolName)) throw new Error("MCP server/tool is not connected")
    const combined = callSignal ? AbortSignal.any([signal, callSignal]) : signal
    try {
      const result = await bounded((requestSignal) => client.callTool({
        name: toolName, arguments: args,
        options: { signal: requestSignal, timeout: callTimeoutMs, maxTotalTimeout: callTimeoutMs },
      }), callTimeoutMs, combined)
      combined.throwIfAborted()
      if (clients.get(serverId) !== client) throw new Error("MCP connection failed during call")
      if (!result || (result.isError !== undefined && typeof result.isError !== "boolean")) throw new Error("Invalid MCP tool response")
      const text = textContent(result)
      if (result.isError) throw new McpToolError(text || "MCP tool call failed")
      return result
    } catch (error) {
      // isError is MCP's normal way to report a failed operation, and a caller
      // cancelling one request says nothing about the server: keep the connection.
      // Transport failures, malformed responses and timeouts fail the server closed.
      const callerCancelled = callSignal?.aborted === true && !signal.aborted
      if (!(error instanceof McpToolError) && !callerCancelled) {
        removeServer(serverId)
        await closeClient(client)
      }
      throw error
    }
  }

  // Prefer an unchanged legacy name over a sanitized/truncated name in the same collision group.
  const legacySafe = ({ server, originalName }: typeof candidates[number]) =>
    /^[a-zA-Z0-9_-]+$/.test(originalName) && mcpToolName(server.name, originalName).endsWith(`__${originalName}`)
  const available = candidates.filter(({ server }) => clients.has(server.id)).sort((a, b) =>
    Number(legacySafe(b)) - Number(legacySafe(a)) || compare(a.server.name, b.server.name) ||
    compare(a.server.id, b.server.id) || compare(a.originalName, b.originalName))
  const reserved = new Set(available.map(({ server, originalName }) => mcpToolName(server.name, originalName)))
  const used = new Set<string>()
  const named = available.map((candidate) => {
    const { server, originalName } = candidate
    const base = mcpToolName(server.name, originalName)
    let name = base
    let attempt = 0
    while (used.has(name) || (name !== base && reserved.has(name))) {
      const hash = createHash("sha256").update(JSON.stringify([server.id, originalName, attempt++])).digest("hex").slice(0, 12)
      name = `${base.slice(0, 51)}_${hash}`
    }
    used.add(name)
    return { ...candidate, name }
  }).sort((a, b) => compare(a.name, b.name))
  for (const { name, server, originalName, definition, annotations } of named) {
    const metadata = { ...definition.metadata }
    delete metadata.annotations
    tools[name] = {
      ...definition,
      metadata: { ...metadata, ...(annotations ? { annotations: { ...annotations } } : {}) },
      execute: async (input, executionOptions) => callRaw(server.id, originalName, input as Record<string, unknown>, executionOptions?.abortSignal),
    }
    meta[name] = { serverId: server.id, serverName: server.name, originalName,
      dangerous: isDangerousMcpTool(server.dangerousTools, originalName), ...(annotations ? { annotations } : {}) }
  }
  return { tools, meta, errors, close,
    call: async (serverId, toolName, args, callSignal) => textContent(await callRaw(serverId, toolName, args, callSignal)) }
}
