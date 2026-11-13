/**
 * The Marketplace catalog: remote MCP servers people can connect in a click or two.
 * Hand-written entries below cover apps set up with a key; `CATALOG_APPS` adds a few hundred
 * more, most of them "Sign in with …" (OAuth 2.1 with dynamic client registration, so nothing
 * has to be registered with the vendor first; see lib/mcp-oauth.ts).
 *
 * URLs and the final server config are built on the server from this list; the browser only
 * ever sends an app id and the person's key.
 */

import { LOCAL_APPS } from "@sayabot/llm/local-apps"
import { CATALOG_APPS } from "./marketplace-catalog"

export type AppAuth =
  | { kind: "none" }
  | {
      kind: "token"
      header: string
      prefix: string
      label: string
      help: string
      optional?: boolean
      /** When set, the pasted key is an environment variable for a local program, not an HTTP header. */
      env?: string
    }
  | { kind: "url-key"; label: string; help: string; template: string }
  | { kind: "personal-url"; label: string; help: string; placeholder: string; host: string }
  | { kind: "oauth" }

export type AppCategory =
  | "developer"
  | "productivity"
  | "knowledge"
  | "search"
  | "data"
  | "sales"
  | "finance"
  | "design"
  | "automation"
  | "business"

export interface MarketplaceApp {
  id: string
  name: string
  tagline: string
  category: AppCategory
  url: string
  transport: "http" | "sse" | "stdio"
  /** Local programs. Desktop ones need the Sayabot app open on that computer. */
  runOn?: "server" | "desktop"
  auth: AppAuth
  /** Brand tint for the tile. */
  color: string
  docs: string
  /**
   * Tools that change things; calls to these wait for a person's OK. `@writes` means every tool
   * not named like a read (get_, list_, search_ ...), for apps whose tool names vary.
   */
  dangerousTools?: string[]
}

export const APP_CATEGORIES: { id: AppCategory; label: string }[] = [
  { id: "productivity", label: "Work & productivity" },
  { id: "knowledge", label: "Docs & knowledge" },
  { id: "developer", label: "Developer tools" },
  { id: "search", label: "Search & research" },
  { id: "data", label: "Data & analytics" },
  { id: "sales", label: "Sales & marketing" },
  { id: "finance", label: "Money & finance" },
  { id: "design", label: "Design & media" },
  { id: "automation", label: "Automation" },
  { id: "business", label: "More apps" },
]

const bearer = (label: string, help: string, optional = false): AppAuth => ({
  kind: "token",
  header: "Authorization",
  prefix: "Bearer ",
  label,
  help,
  optional,
})

const KEY_APPS: MarketplaceApp[] = [
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
    category: "finance",
    url: "https://mcp.stripe.com",
    transport: "http",
    auth: bearer("Restricted API key", "Use a restricted key (rk_…) with only the access you want agents to have."),
    color: "#635bff",
    docs: "https://docs.stripe.com/mcp",
    dangerousTools: ["create_refund", "create_payment_link", "cancel_subscription", "create_invoice"],
  },
]

const LOCAL_MARKETPLACE: MarketplaceApp[] = LOCAL_APPS.map((app) => ({
  id: app.id,
  name: app.name,
  tagline: app.tagline,
  category: app.category,
  url: `stdio://${app.id}`,
  transport: "stdio",
  auth: app.env
    ? { kind: "token", header: "", prefix: "", label: app.env.label, help: app.env.help, env: app.env.name }
    : { kind: "none" },
  color: app.color,
  docs: app.docs,
  dangerousTools: [...app.dangerousTools],
  runOn: app.where,
}))

const KEY_APP_IDS = new Set([...KEY_APPS, ...LOCAL_MARKETPLACE].map((app) => app.id))

export const MARKETPLACE_APPS: MarketplaceApp[] = [
  ...KEY_APPS,
  ...LOCAL_MARKETPLACE,
  ...CATALOG_APPS.filter((app) => !KEY_APP_IDS.has(app.id)),
].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))

export function findMarketplaceApp(id: string): MarketplaceApp | null {
  return MARKETPLACE_APPS.find((app) => app.id === id) ?? null
}

/** Whether a saved MCP server (by host) came from this catalog app. */
export function hostMatchesApp(host: string, app: MarketplaceApp): boolean {
  if (!host || app.transport === "stdio") return false
  let appHost: string
  try {
    appHost = app.auth.kind === "personal-url" ? app.auth.host : new URL(app.url).host
  } catch {
    return false
  }
  return host === appHost || host.endsWith(`.${appHost}`)
}

function appHost(app: MarketplaceApp): string {
  try {
    return app.auth.kind === "personal-url" ? app.auth.host : new URL(app.url).host
  } catch {
    return ""
  }
}

/**
 * The one catalog app a saved server's host belongs to: an exact host first, otherwise the
 * longest parent domain (docs.mcp.cloudflare.com is Cloudflare Docs, not Cloudflare).
 */
export function appForHost(host: string): MarketplaceApp | null {
  let best: MarketplaceApp | null = null
  let bestLength = -1
  for (const app of MARKETPLACE_APPS) {
    if (!hostMatchesApp(host, app)) continue
    const length = appHost(app).length
    if (length > bestLength) {
      best = app
      bestLength = length
    }
  }
  return best
}
