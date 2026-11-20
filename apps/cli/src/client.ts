/**
 * A minimal JSON-RPC 2.0 client for the Sayabot MCP endpoint.
 *
 * The orchestrator already speaks MCP over Streamable HTTP at `/v1/mcp`, authenticated with an
 * agent API key (`saaya_ak_…`) or an OAuth access token. This client adds no new server surface:
 * it forwards JSON-RPC bodies and returns what the orchestrator says, so the CLI can only do what
 * the key's scopes and room list allow.
 */

export interface ToolDescription {
  name: string
  title?: string
  description?: string
  scope?: string
  annotations?: { readOnlyHint?: boolean }
  inputSchema?: unknown
}

export interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>
  structuredContent?: unknown
  isError?: boolean
}

interface JsonRpcResponse {
  jsonrpc?: string
  id?: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** The server answered with a non-2xx HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "HttpError"
  }
}

/** The server answered with a JSON-RPC error object. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = "RpcError"
  }
}

export interface SayabotClientOptions {
  /** Base URL of the orchestrator, e.g. `http://127.0.0.1:8787`. */
  url: string
  /** Agent API key or OAuth access token. Sent as a bearer header, never in the URL. */
  key: string
  fetchImpl?: typeof fetch
  /** `wait_for_activity` can block for ~55 s, so the default is longer than a normal request. */
  timeoutMs?: number
}

export class SayabotClient {
  readonly endpoint: string
  private readonly key: string
  private readonly doFetch: typeof fetch
  private readonly timeoutMs: number
  private nextId = 0

  constructor(options: SayabotClientOptions) {
    this.endpoint = `${options.url.replace(/\/+$/, "")}/v1/mcp`
    this.key = options.key
    this.doFetch = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 120_000
  }

  /** POST a raw JSON-RPC body. Returns `null` when the server answers `202` (notifications). */
  async post(payload: unknown): Promise<unknown> {
    const response = await this.doFetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.key}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (response.status === 202 || response.status === 204) return null

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300).trim()
      const hint =
        response.status === 401
          ? " — the agent key was rejected; check it in Settings → Bots"
          : response.status === 404
            ? ` — no MCP endpoint at ${this.endpoint}`
            : ""
      throw new HttpError(
        response.status,
        `HTTP ${response.status}${hint}${detail ? `: ${detail}` : ""}`,
      )
    }

    return await response.json()
  }

  /** Send one request and unwrap its JSON-RPC response. */
  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = ++this.nextId
    const body = await this.post({ jsonrpc: "2.0", id, method, params })
    const message = (Array.isArray(body) ? body[0] : body) as JsonRpcResponse | null | undefined
    if (!message) throw new HttpError(202, `no response for ${method}`)
    if (message.error)
      throw new RpcError(message.error.code, message.error.message, message.error.data)
    return message.result as T
  }

  /** Send a notification (no id). The server replies `202` with no body. */
  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    await this.post({ jsonrpc: "2.0", method, params })
  }

  async initialize(): Promise<unknown> {
    return await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "sayabot-cli", version: "0.0.0" },
    })
  }

  async listTools(): Promise<ToolDescription[]> {
    const result = await this.request<{ tools?: ToolDescription[] }>("tools/list")
    return result.tools ?? []
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    return await this.request<ToolCallResult>("tools/call", { name, arguments: args })
  }
}
