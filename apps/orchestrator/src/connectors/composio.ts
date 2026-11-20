/**
 * Composio client: one API key reaches the whole connected-app catalog OpenMausBot exposes
 * (Gmail, Google Calendar, Slack, Notion, Linear, HubSpot, Jira, … — the toolkits keep growing,
 * so nothing here is a fixed list). Tokens are the person's own OAuth connections created in
 * their Composio project; this client only lists and executes on their behalf.
 *
 * Docs: https://docs.composio.dev/reference/api-reference — auth is `x-api-key`,
 * base `https://backend.composio.dev/api/v3`.
 */

export interface ComposioToolkit {
  slug: string
  name: string
  description?: string
}

export interface ComposioTool {
  slug: string
  name: string
  description?: string
}

export interface ComposioAccount {
  id: string
  toolkit?: string
  status: string
}

export interface ComposioConnectorOptions {
  apiKey: string
  /** Override the API origin. Tests point this at a local stub server. */
  baseUrl?: string
  fetchFn?: typeof fetch
}

/**
 * Read verbs, as Composio names them: `GMAIL_FETCH_EMAILS`, `NOTION_QUERY_DATABASE`, … The
 * toolkit is a prefix (one or more words: `GOOGLE_ANALYTICS_BATCH_RUN_REPORTS`), so the verb is
 * looked for in any segment after the first rather than assumed to be the second.
 */
const READ_VERBS = new Set([
  "GET",
  "LIST",
  "SEARCH",
  "READ",
  "FETCH",
  "FIND",
  "LOOKUP",
  "VIEW",
  "DESCRIBE",
  "RETRIEVE",
  "SHOW",
  "WHOAMI",
  "COUNT",
  "PREVIEW",
  "DOWNLOAD",
  "QUERY",
])

/** The toolkit a tool slug belongs to, when the slug's toolkit is a single word. */
export function toolkitOfSlug(slug: string): string {
  return slug.split("_")[0]?.toLowerCase() ?? ""
}

/** Whether a Composio tool only reads. Anything else counts as a write for a read-only grant. */
export function isReadOnlyComposioTool(slug: string): boolean {
  return slug
    .split("_")
    .slice(1)
    .some((segment) => READ_VERBS.has(segment.toUpperCase()))
}

interface ToolkitItem {
  slug?: string
  name?: string
  meta?: { description?: string; logo?: string }
  description?: string
}

interface ToolItem {
  slug?: string
  name?: string
  description?: string
}

interface AccountItem {
  id?: string
  status?: string
  toolkit?: { slug?: string }
}

export class ComposioConnector {
  private apiKey: string
  private baseUrl: string
  private fetchFn: typeof fetch

  constructor(opts: ComposioConnectorOptions) {
    this.apiKey = opts.apiKey
    this.baseUrl = (opts.baseUrl ?? "https://backend.composio.dev/api/v3").replace(/\/+$/, "")
    this.fetchFn = opts.fetchFn ?? fetch
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "x-api-key": this.apiKey,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(
        `Composio ${path.split("?")[0]} failed (${res.status}): ${text.slice(0, 200)}`,
      )
    }
    return (text ? JSON.parse(text) : {}) as T
  }

  async toolkits(args: { limit?: number; search?: string } = {}): Promise<ComposioToolkit[]> {
    const params = new URLSearchParams({
      limit: String(Math.min(100, Math.max(1, args.limit ?? 50))),
    })
    if (args.search) params.set("search", args.search)
    const body = await this.request<{ items?: ToolkitItem[] }>(`/toolkits?${params}`)
    return (body.items ?? []).flatMap((item) => {
      const slug = item.slug?.toLowerCase()
      if (!slug) return []
      return [
        {
          slug,
          name: item.name ?? slug,
          ...((item.meta?.description ?? item.description)
            ? { description: (item.meta?.description ?? item.description) as string }
            : {}),
        },
      ]
    })
  }

  async tools(args: { toolkit: string; search?: string; limit?: number }): Promise<ComposioTool[]> {
    const params = new URLSearchParams({
      toolkit_slug: args.toolkit.toLowerCase(),
      limit: String(Math.min(100, Math.max(1, args.limit ?? 25))),
    })
    if (args.search) params.set("search", args.search)
    const body = await this.request<{ items?: ToolItem[] }>(`/tools?${params}`)
    return (body.items ?? []).flatMap((item) => {
      const slug = item.slug
      if (!slug) return []
      return [
        {
          slug,
          name: item.name ?? slug,
          ...(item.description ? { description: item.description } : {}),
        },
      ]
    })
  }

  async connectedAccounts(args: { userId: string; limit?: number }): Promise<ComposioAccount[]> {
    const params = new URLSearchParams({
      user_ids: args.userId,
      limit: String(Math.min(100, Math.max(1, args.limit ?? 100))),
    })
    const body = await this.request<{ items?: AccountItem[] }>(`/connected_accounts?${params}`)
    return (body.items ?? []).flatMap((item) =>
      item.id
        ? [
            {
              id: item.id,
              toolkit: item.toolkit?.slug?.toLowerCase(),
              status: item.status ?? "INITIALIZED",
            },
          ]
        : [],
    )
  }

  async execute(args: {
    toolSlug: string
    userId: string
    arguments: Record<string, unknown>
    connectedAccountId?: string
  }): Promise<unknown> {
    const body = await this.request<{
      data?: unknown
      error?: string | null
      successful?: boolean
      message?: string
    }>(`/tools/execute/${encodeURIComponent(args.toolSlug)}`, {
      method: "POST",
      body: JSON.stringify({
        user_id: args.userId,
        arguments: args.arguments,
        ...(args.connectedAccountId ? { connected_account_id: args.connectedAccountId } : {}),
      }),
    })
    if (body.successful === false || body.error) {
      throw new Error(
        `Composio ${args.toolSlug} failed: ${String(body.error ?? body.message ?? "unknown error").slice(0, 300)}`,
      )
    }
    return body.data ?? body
  }

  /** A sign-in link the person opens to connect one toolkit to this workspace's Composio user. */
  async connectLink(args: { toolkit: string; userId: string }): Promise<string> {
    const body = await this.request<{ redirect_url?: string; redirectUrl?: string }>(
      "/connected_accounts/link",
      {
        method: "POST",
        body: JSON.stringify({ toolkit_slug: args.toolkit.toLowerCase(), user_id: args.userId }),
      },
    )
    const url = body.redirect_url ?? body.redirectUrl
    if (!url) throw new Error("Composio did not return a connection link")
    return url
  }
}
