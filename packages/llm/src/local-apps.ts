/**
 * MCP apps that are a program, not a website. The command list is fixed: a saved row
 * never gets to choose what runs. `server` apps start next to the orchestrator.
 * `desktop` apps run on a computer where the Sayabot app is open (they need local files
 * or an account signed in there).
 */
export interface LocalAppEnv {
  name: string
  label: string
  help: string
}

export interface LocalApp {
  id: string
  name: string
  tagline: string
  category: "data" | "search" | "knowledge" | "developer" | "automation" | "productivity" | "design"
  docs: string
  color: string
  where: "server" | "desktop"
  command: "npx" | "paper"
  args: readonly string[]
  env?: LocalAppEnv
  dangerousTools: string[]
}

export const LOCAL_APPS: readonly LocalApp[] = [
  {
    id: "airtable",
    name: "Airtable",
    tagline: "Bases, tables and records",
    category: "data",
    docs: "https://airtable.com/developers/web/api/introduction",
    color: "#fcb400",
    where: "server",
    command: "npx",
    args: ["-y", "airtable-mcp-server"],
    env: { name: "AIRTABLE_API_KEY", label: "Personal access token", help: "Airtable → Builder hub → Personal access tokens. Include the bases this workspace may use." },
    dangerousTools: ["@writes"],
  },
  {
    id: "brave-search",
    name: "Brave Search",
    tagline: "Web search with your own key",
    category: "search",
    docs: "https://brave.com/search/api/",
    color: "#fb542b",
    where: "server",
    command: "npx",
    args: ["-y", "@brave/brave-search-mcp-server"],
    env: { name: "BRAVE_API_KEY", label: "API key", help: "brave.com/search/api → API keys." },
    dangerousTools: [],
  },
  {
    id: "resend",
    name: "Resend",
    tagline: "Send and inspect email",
    category: "automation",
    docs: "https://resend.com/docs",
    color: "#000000",
    where: "server",
    command: "npx",
    args: ["-y", "resend-mcp"],
    env: { name: "RESEND_API_KEY", label: "API key", help: "resend.com → API keys. Sending waits for approval." },
    dangerousTools: ["@writes"],
  },
  {
    id: "firecrawl-local",
    name: "Firecrawl CLI",
    tagline: "Crawl pages with the local Firecrawl program",
    category: "search",
    docs: "https://docs.firecrawl.dev",
    color: "#ea580c",
    where: "server",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
    env: { name: "FIRECRAWL_API_KEY", label: "API key", help: "firecrawl.dev → API keys. The hosted Firecrawl app is listed separately." },
    dangerousTools: ["@writes"],
  },
  {
    id: "obsidian",
    name: "Obsidian",
    tagline: "Notes in the vault open on your computer",
    category: "knowledge",
    docs: "https://github.com/MarkusPfundstein/mcp-obsidian",
    color: "#7c3aed",
    where: "desktop",
    command: "npx",
    args: ["-y", "obsidian-mcp-server"],
    env: { name: "OBSIDIAN_API_KEY", label: "Local REST API key", help: "In Obsidian, install the Local REST API plugin and copy its API key. Leave the Sayabot app open on that computer." },
    dangerousTools: ["@writes"],
  },
  {
    id: "paper",
    name: "Paper",
    tagline: "The file open in Paper on your computer",
    category: "design",
    docs: "https://paper.design/docs/mcp",
    color: "#111111",
    where: "desktop",
    command: "paper",
    args: ["mcp"],
    dangerousTools: ["@writes"],
  },
  {
    id: "apple-apps",
    name: "Apple apps",
    tagline: "Mail, notes and reminders on this Mac",
    category: "productivity",
    docs: "https://github.com/mgsgde/mcp-icloud",
    color: "#555555",
    where: "desktop",
    command: "npx",
    args: ["-y", "mcp-icloud"],
    dangerousTools: ["@writes"],
  },
]

const BY_ID = new Map(LOCAL_APPS.map((app) => [app.id, app]))

export function findLocalApp(id: string | null | undefined): LocalApp | null {
  if (!id) return null
  return BY_ID.get(id) ?? null
}

/** What the desktop app is willing to start. Anything else is refused, even if the server asked. */
export function localAppArgv(app: LocalApp): string {
  return `${app.command} ${app.args.join(" ")}`
}
