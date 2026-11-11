/**
 * The Marketplace catalog: remote MCP servers people can connect in a click or two.
 * Only servers that work with what Sayabot speaks today (Streamable HTTP or SSE, auth by a
 * static header or a key in the URL) are connectable. Sign-in-only servers are listed as
 * "coming soon" rather than shown as broken buttons.
 *
 * URLs and the final server config are built on the server from this list; the browser only
 * ever sends an app id and the person's key.
 */

export type AppAuth =
  | { kind: "none" }
  | {
      kind: "token"
      header: string
      prefix: string
      label: string
      help: string
      optional?: boolean
    }
  | { kind: "url-key"; label: string; help: string; template: string }
  | { kind: "personal-url"; label: string; help: string; placeholder: string; host: string }
  | { kind: "oauth" }

export type AppCategory = "developer" | "knowledge" | "search" | "data" | "business" | "automation"

export interface MarketplaceApp {
  id: string
  name: string
  tagline: string
  category: AppCategory
  url: string
  transport: "http" | "sse"
  auth: AppAuth
  /** Brand tint for the tile. */
  color: string
  docs: string
  /** Tools that change things; calls to these wait for a person's OK. */
  dangerousTools?: string[]
}

export const APP_CATEGORIES: { id: AppCategory; label: string }[] = [
  { id: "developer", label: "Developer tools" },
  { id: "knowledge", label: "Docs & knowledge" },
  { id: "search", label: "Search & web" },
  { id: "data", label: "Data & databases" },
  { id: "business", label: "Business" },
  { id: "automation", label: "Automation" },
]

const bearer = (label: string, help: string, optional = false): AppAuth => ({
  kind: "token",
  header: "Authorization",
  prefix: "Bearer ",
  label,
  help,
  optional,
})

export const MARKETPLACE_APPS: MarketplaceApp[] = [
  {
    id: "github",
    name: "GitHub",
    tagline: "Repos, issues, pull requests and code search",
    category: "developer",
    url: "https://api.githubcopilot.com/mcp/",
    transport: "http",
    auth: bearer("Personal access token", "github.com → Settings → Developer settings → Personal access tokens."),
    color: "#24292f",
    docs: "https://github.com/github/github-mcp-server",
    dangerousTools: ["create_or_update_file", "push_files", "merge_pull_request", "delete_file"],
  },
  {
    id: "linear",
    name: "Linear",
    tagline: "Issues, projects and cycles",
    category: "developer",
    url: "https://mcp.linear.app/mcp",
    transport: "http",
    auth: bearer("API key", "Linear → Settings → Security & access → Personal API keys."),
    color: "#5e6ad2",
    docs: "https://linear.app/docs/mcp",
  },
  {
    id: "semgrep",
    name: "Semgrep",
    tagline: "Scan code for security bugs",
    category: "developer",
    url: "https://mcp.semgrep.ai/mcp",
    transport: "http",
    auth: { kind: "none" },
    color: "#1b2e3c",
    docs: "https://semgrep.dev/docs/mcp",
  },
  {
    id: "grep-app",
    name: "grep.app",
    tagline: "Search code across a million public repos",
    category: "developer",
    url: "https://mcp.grep.app",
    transport: "http",
    auth: { kind: "none" },
    color: "#111827",
    docs: "https://grep.app",
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    tagline: "Ask questions about any public GitHub repo",
    category: "knowledge",
    url: "https://mcp.deepwiki.com/mcp",
    transport: "http",
    auth: { kind: "none" },
    color: "#2563eb",
    docs: "https://docs.devin.ai/work-with-devin/deepwiki-mcp",
  },
  {
    id: "context7",
    name: "Context7",
    tagline: "Up-to-date docs for thousands of libraries",
    category: "knowledge",
    url: "https://mcp.context7.com/mcp",
    transport: "http",
    auth: { kind: "none" },
    color: "#0f766e",
    docs: "https://github.com/upstash/context7",
  },
  {
    id: "microsoft-learn",
    name: "Microsoft Learn",
    tagline: "Official Microsoft and Azure docs",
    category: "knowledge",
    url: "https://learn.microsoft.com/api/mcp",
    transport: "http",
    auth: { kind: "none" },
    color: "#0078d4",
    docs: "https://learn.microsoft.com/training/support/mcp",
  },
  {
    id: "aws-knowledge",
    name: "AWS Knowledge",
    tagline: "AWS docs, guides and best practices",
    category: "knowledge",
    url: "https://knowledge-mcp.global.api.aws",
    transport: "http",
    auth: { kind: "none" },
    color: "#ff9900",
    docs: "https://awslabs.github.io/mcp/servers/aws-knowledge-mcp-server",
  },
  {
    id: "cloudflare-docs",
    name: "Cloudflare Docs",
    tagline: "Cloudflare developer documentation",
    category: "knowledge",
    url: "https://docs.mcp.cloudflare.com/mcp",
    transport: "http",
    auth: { kind: "none" },
    color: "#f38020",
    docs: "https://github.com/cloudflare/mcp-server-cloudflare",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    tagline: "Models, datasets, papers and Spaces",
    category: "knowledge",
    url: "https://huggingface.co/mcp",
    transport: "http",
    auth: bearer("Access token (optional)", "Optional. huggingface.co → Settings → Access tokens. Without one you get public data only.", true),
    color: "#ffb000",
    docs: "https://huggingface.co/settings/mcp",
  },
  {
    id: "exa",
    name: "Exa",
    tagline: "Web search built for AI agents",
    category: "search",
    url: "https://mcp.exa.ai/mcp",
    transport: "http",
    auth: {
      kind: "url-key",
      label: "Exa API key",
      help: "dashboard.exa.ai → API keys.",
      template: "https://mcp.exa.ai/mcp?exaApiKey={key}",
    },
    color: "#1f40ed",
    docs: "https://docs.exa.ai/reference/exa-mcp",
  },
  {
    id: "tavily",
    name: "Tavily",
    tagline: "Search, extract and crawl the web",
    category: "search",
    url: "https://mcp.tavily.com/mcp/",
    transport: "http",
    auth: {
      kind: "url-key",
      label: "Tavily API key",
      help: "app.tavily.com → API keys.",
      template: "https://mcp.tavily.com/mcp/?tavilyApiKey={key}",
    },
    color: "#4f46e5",
    docs: "https://docs.tavily.com/documentation/mcp",
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    tagline: "Turn any website into clean text",
    category: "search",
    url: "https://mcp.firecrawl.dev",
    transport: "http",
    auth: {
      kind: "url-key",
      label: "Firecrawl API key",
      help: "firecrawl.dev → Dashboard → API keys.",
      template: "https://mcp.firecrawl.dev/{key}/v2/mcp",
    },
    color: "#fa5d19",
    docs: "https://docs.firecrawl.dev/mcp-server",
  },
  {
    id: "apify",
    name: "Apify",
    tagline: "Thousands of ready-made scrapers",
    category: "search",
    url: "https://mcp.apify.com",
    transport: "http",
    auth: bearer("API token", "console.apify.com → Settings → API & Integrations."),
    color: "#00a3ff",
    docs: "https://docs.apify.com/platform/integrations/mcp",
  },
  {
    id: "supabase",
    name: "Supabase",
    tagline: "Query and manage your Supabase projects",
    category: "data",
    url: "https://mcp.supabase.com/mcp",
    transport: "http",
    auth: bearer("Personal access token", "supabase.com/dashboard/account/tokens."),
    color: "#3ecf8e",
    docs: "https://supabase.com/docs/guides/getting-started/mcp",
    dangerousTools: ["execute_sql", "apply_migration", "delete_branch", "pause_project"],
  },
  {
    id: "neon",
    name: "Neon",
    tagline: "Serverless Postgres: branches, queries, migrations",
    category: "data",
    url: "https://mcp.neon.tech/mcp",
    transport: "http",
    auth: bearer("API key", "console.neon.tech → Account settings → API keys."),
    color: "#00e599",
    docs: "https://neon.com/docs/ai/neon-mcp-server",
    dangerousTools: ["run_sql", "delete_project", "complete_database_migration"],
  },
  {
    id: "stripe",
    name: "Stripe",
    tagline: "Customers, payments, invoices and refunds",
    category: "business",
    url: "https://mcp.stripe.com",
    transport: "http",
    auth: bearer("Restricted API key", "Use a restricted key (rk_…) with only the access you want agents to have."),
    color: "#635bff",
    docs: "https://docs.stripe.com/mcp",
    dangerousTools: ["create_refund", "create_payment_link", "cancel_subscription", "create_invoice"],
  },
  {
    id: "zapier",
    name: "Zapier",
    tagline: "Let agents use 8,000+ apps through your Zaps",
    category: "automation",
    url: "https://mcp.zapier.com",
    transport: "http",
    auth: {
      kind: "personal-url",
      label: "Your Zapier MCP URL",
      help: "mcp.zapier.com → New MCP server → copy its server URL.",
      placeholder: "https://mcp.zapier.com/api/mcp/s/…",
      host: "mcp.zapier.com",
    },
    color: "#ff4f00",
    docs: "https://zapier.com/mcp",
  },
  {
    id: "composio",
    name: "Composio",
    tagline: "Hundreds of apps behind one connection",
    category: "automation",
    url: "https://mcp.composio.dev",
    transport: "http",
    auth: {
      kind: "personal-url",
      label: "Your Composio MCP URL",
      help: "composio.dev → MCP → create a server and copy its URL.",
      placeholder: "https://mcp.composio.dev/…",
      host: "composio.dev",
    },
    color: "#7c3aed",
    docs: "https://docs.composio.dev",
  },
  // Sign-in (OAuth) only today. Listed so people know they're coming.
  { id: "notion", name: "Notion", tagline: "Pages, databases and docs", category: "business", url: "https://mcp.notion.com/mcp", transport: "http", auth: { kind: "oauth" }, color: "#191919", docs: "https://developers.notion.com/docs/mcp" },
  { id: "sentry", name: "Sentry", tagline: "Errors and performance issues", category: "developer", url: "https://mcp.sentry.dev/mcp", transport: "http", auth: { kind: "oauth" }, color: "#362d59", docs: "https://docs.sentry.io/product/sentry-mcp/" },
  { id: "atlassian", name: "Jira & Confluence", tagline: "Tickets and team pages", category: "business", url: "https://mcp.atlassian.com/v1/sse", transport: "sse", auth: { kind: "oauth" }, color: "#0052cc", docs: "https://www.atlassian.com/platform/remote-mcp-server" },
  { id: "vercel", name: "Vercel", tagline: "Deployments, logs and projects", category: "developer", url: "https://mcp.vercel.com", transport: "http", auth: { kind: "oauth" }, color: "#000000", docs: "https://vercel.com/docs/mcp" },
]

export function findMarketplaceApp(id: string): MarketplaceApp | null {
  return MARKETPLACE_APPS.find((app) => app.id === id) ?? null
}

/** Whether a saved MCP server (by host) came from this catalog app. */
export function hostMatchesApp(host: string, app: MarketplaceApp): boolean {
  if (!host) return false
  let appHost: string
  try {
    appHost = app.auth.kind === "personal-url" ? app.auth.host : new URL(app.url).host
  } catch {
    return false
  }
  return host === appHost || host.endsWith(`.${appHost}`)
}
