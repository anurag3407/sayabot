import { z } from "zod"
import { getEnv } from "../../env"
import { assertSafeWebhookUrl } from "../../ssrf"
import type { ToolSpec } from "../audited"
import { resolveToolCredential, type OrgToolConfig } from "../secrets"

export interface SearchResultItem {
  title: string
  url: string
  description: string
}

export interface WebSearchOutput {
  provider: string
  query: string
  results: SearchResultItem[]
  answer?: string
  fallback?: boolean
  warning?: string
}

export type WebSearchProvider =
  | "duckduckgo"
  | "tavily"
  | "brave"
  | "searxng"
  | "serper"
  | "exa"
  | "tinyfish"
  | "firecrawl"
  | "perplexity"
  | "bing"

export interface ProviderMeta {
  id: WebSearchProvider
  name: string
  description: string
  badge: "Free" | "AI Search" | "Search API" | "Self-Hosted"
  requiresKey: boolean
  requiresUrl?: boolean
  keyPlaceholder?: string
  docsUrl?: string
}

export const SEARCH_PROVIDERS: ProviderMeta[] = [
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    description: "Keyless, zero-cost web search via DuckDuckGo. Works out of the box with zero configuration.",
    badge: "Free",
    requiresKey: false,
  },
  {
    id: "tinyfish",
    name: "TinyFish",
    description: "Zero-cost browser-rendered web, news, and academic research search API.",
    badge: "Free",
    requiresKey: true,
    keyPlaceholder: "tf_… (free at tinyfish.ai)",
    docsUrl: "https://tinyfish.ai",
  },
  {
    id: "tavily",
    name: "Tavily",
    description: "AI-native search engine built for agents with synthesis and clean extracted context.",
    badge: "AI Search",
    requiresKey: true,
    keyPlaceholder: "tvly-…",
    docsUrl: "https://tavily.com",
  },
  {
    id: "brave",
    name: "Brave Search",
    description: "Independent, privacy-focused search index with fast results and 2,000 free queries/mo.",
    badge: "Search API",
    requiresKey: true,
    keyPlaceholder: "BSA…",
    docsUrl: "https://brave.com/search/api",
  },
  {
    id: "searxng",
    name: "SearXNG",
    description: "Open-source privacy metasearch engine. Connect to any public or self-hosted instance.",
    badge: "Self-Hosted",
    requiresKey: false,
    requiresUrl: true,
    keyPlaceholder: "Optional API token",
    docsUrl: "https://docs.searxng.org",
  },
  {
    id: "serper",
    name: "Serper (Google Search)",
    description: "Fast Google Search API returning organic results, knowledge graphs, and snippets.",
    badge: "Search API",
    requiresKey: true,
    keyPlaceholder: "Your Serper API key",
    docsUrl: "https://serper.dev",
  },
  {
    id: "exa",
    name: "Exa / Metaphor",
    description: "Neural semantic search designed specifically for AI models and deep research.",
    badge: "AI Search",
    requiresKey: true,
    keyPlaceholder: "exa-…",
    docsUrl: "https://exa.ai",
  },
  {
    id: "firecrawl",
    name: "Firecrawl Search",
    description: "Search the web with automatic LLM-ready markdown page extraction.",
    badge: "AI Search",
    requiresKey: true,
    keyPlaceholder: "fc-…",
    docsUrl: "https://firecrawl.dev",
  },
  {
    id: "perplexity",
    name: "Perplexity (Sonar)",
    description: "Conversational web search engine with live citations and grounded reasoning.",
    badge: "AI Search",
    requiresKey: true,
    keyPlaceholder: "pplx-…",
    docsUrl: "https://docs.perplexity.ai",
  },
  {
    id: "bing",
    name: "Bing Web Search",
    description: "Microsoft Azure Bing Web Search API across global web pages and news.",
    badge: "Search API",
    requiresKey: true,
    keyPlaceholder: "Azure Cognitive key",
    docsUrl: "https://www.microsoft.com/en-us/bing/apis/bing-web-search-api",
  },
]

// ── Search Provider Implementations ─────────────────────────────────────────

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
}

async function searchDuckDuckGo(query: string, count: number, signal?: AbortSignal): Promise<SearchResultItem[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal,
  })
  if (!response.ok) throw new Error(`DuckDuckGo responded with status ${response.status}`)
  const html = await response.text()
  if (
    html.includes("anomaly-modal") ||
    html.includes("challenge") ||
    html.includes("captcha") ||
    html.includes("bots use DuckDuckGo")
  ) {
    throw new Error("DuckDuckGo rate-limited or blocked this request")
  }
  const results: SearchResultItem[] = []
  const blocks = html.split(/<div class="[^"]*result\s+results_links[^"]*"[^>]*>/i).slice(1)
  for (const block of blocks) {
    if (results.length >= count) break
    const titleMatch =
      block.match(/<a class="result__url"[^>]*href="([^"]+)"[\s\S]*?<h2 class="result__title">([\s\S]*?)<\/h2>/i) ||
      block.match(/<h2 class="result__title">[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
    if (!titleMatch) continue

    let targetUrl = titleMatch[1] || ""
    const uddgMatch = targetUrl.match(/uddg=([^&]+)/)
    if (uddgMatch && uddgMatch[1]) {
      try {
        targetUrl = decodeURIComponent(uddgMatch[1])
      } catch {}
    } else if (targetUrl.startsWith("//")) {
      targetUrl = `https:${targetUrl}`
    }

    const title = decodeHtmlEntities((titleMatch[2] || "").replace(/<[^>]+>/g, "").trim())
    const rawSnippet = snippetMatch?.[1] ?? ""
    const snippet = decodeHtmlEntities(rawSnippet.replace(/<[^>]+>/g, "").trim())

    if (title && targetUrl && !targetUrl.includes("duckduckgo.com/y.js")) {
      results.push({ title, url: targetUrl, description: snippet })
    }
  }
  return results
}

async function searchTavily(
  query: string,
  count: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ results: SearchResultItem[]; answer?: string }> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: count,
      search_depth: "basic",
      include_answer: true,
    }),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Tavily search failed (${response.status}): ${text.slice(0, 200)}`)
  }
  const data = (await response.json()) as {
    answer?: string
    results?: Array<{ title?: string; url?: string; content?: string }>
  }
  const results = (data.results ?? []).slice(0, count).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.content ?? "",
  }))
  return { results, answer: data.answer }
}

async function searchBrave(
  query: string,
  count: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    text_decorations: "false",
    safesearch: "moderate",
  })
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      accept: "application/json",
      "x-subscription-token": apiKey,
    },
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Brave search failed (${response.status}): ${text.slice(0, 200)}`)
  }
  const data = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
  }
  return (data.web?.results ?? []).slice(0, count).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.description ?? "",
  }))
}

async function searchSearXNG(
  query: string,
  count: number,
  baseUrl?: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const base = (baseUrl || "https://searx.be").replace(/\/+$/, "")
  // Validate baseUrl against SSRF to prevent hitting internal hosts or cloud metadata
  await assertSafeWebhookUrl(base, false)
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const response = await fetch(url, { headers, signal })
  if (!response.ok) {
    throw new Error(`SearXNG instance failed (${response.status}) at ${base}`)
  }
  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>
  }
  return (data.results ?? []).slice(0, count).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.content ?? "",
  }))
}

async function searchSerper(
  query: string,
  count: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: count }),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Serper search failed (${response.status}): ${text.slice(0, 200)}`)
  }
  const data = (await response.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>
  }
  return (data.organic ?? []).slice(0, count).map((r) => ({
    title: r.title ?? "",
    url: r.link ?? "",
    description: r.snippet ?? "",
  }))
}

async function searchExa(
  query: string,
  count: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      num_results: count,
      use_autoprompt: true,
      contents: {
        text: { max_characters: 1000 },
      },
    }),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Exa search failed (${response.status}): ${text.slice(0, 200)}`)
  }
  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; text?: string; snippet?: string }>
  }
  return (data.results ?? []).slice(0, count).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.text ?? r.snippet ?? "",
  }))
}

async function searchTinyFish(
  query: string,
  count: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const response = await fetch(`https://api.search.tinyfish.ai/?q=${encodeURIComponent(query)}`, {
    headers: {
      "X-API-Key": apiKey,
      Accept: "application/json",
    },
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`TinyFish search failed (${response.status}): ${text.slice(0, 200)}`)
  }
  const data = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; snippet?: string }>
  }
  return (data.results ?? []).slice(0, count).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.snippet ?? "",
  }))
}

async function searchFirecrawl(
  query: string,
  count: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const response = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit: count }),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Firecrawl search failed (${response.status}): ${text.slice(0, 200)}`)
  }
  const data = (await response.json()) as {
    data?: Array<{ title?: string; url?: string; description?: string; markdown?: string }>
  }
  return (data.data ?? []).slice(0, count).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.description || r.markdown?.slice(0, 300) || "",
  }))
}

async function searchPerplexity(
  query: string,
  _count: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ results: SearchResultItem[]; answer?: string }> {
  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: `Search the web and provide concise findings with source URLs for: ${query}` }],
    }),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Perplexity search failed (${response.status}): ${text.slice(0, 200)}`)
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    citations?: string[]
  }
  const answer = data.choices?.[0]?.message?.content ?? ""
  const citations = data.citations ?? []
  const results: SearchResultItem[] = citations.map((url, i) => ({
    title: `Source ${i + 1}`,
    url,
    description: answer.slice(0, 300),
  }))
  if (results.length === 0 && answer) {
    results.push({ title: "Perplexity Search Result", url: "https://perplexity.ai", description: answer })
  }
  return { results, answer }
}

async function searchBing(
  query: string,
  count: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const response = await fetch(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${count}`, {
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
    },
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Bing search failed (${response.status}): ${text.slice(0, 200)}`)
  }
  const data = (await response.json()) as {
    webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> }
  }
  return (data.webPages?.value ?? []).slice(0, count).map((r) => ({
    title: r.name ?? "",
    url: r.url ?? "",
    description: r.snippet ?? "",
  }))
}

// ── Search Dispatcher ────────────────────────────────────────────────────────

export async function executeWebSearch(args: {
  query: string
  count?: number
  provider?: string
  apiKey?: string
  baseUrl?: string
  signal?: AbortSignal
}): Promise<WebSearchOutput> {
  const count = Math.max(1, Math.min(10, args.count ?? 5))
  const provider = (args.provider || "duckduckgo").toLowerCase() as WebSearchProvider
  const apiKey = args.apiKey || ""

  let results: SearchResultItem[] = []
  let answer: string | undefined

  try {
    switch (provider) {
      case "tavily": {
        if (!apiKey) throw new Error("Tavily API key is missing. Configure it in Settings → Tools.")
        const res = await searchTavily(args.query, count, apiKey, args.signal)
        results = res.results
        answer = res.answer
        break
      }
      case "brave": {
        const key = apiKey || getEnv().BRAVE_SEARCH_API_KEY
        if (!key) throw new Error("Brave Search API key is missing. Configure it in Settings → Tools.")
        results = await searchBrave(args.query, count, key, args.signal)
        break
      }
      case "searxng": {
        results = await searchSearXNG(args.query, count, args.baseUrl, apiKey, args.signal)
        break
      }
      case "serper": {
        if (!apiKey) throw new Error("Serper API key is missing. Configure it in Settings → Tools.")
        results = await searchSerper(args.query, count, apiKey, args.signal)
        break
      }
      case "exa": {
        if (!apiKey) throw new Error("Exa API key is missing. Configure it in Settings → Tools.")
        results = await searchExa(args.query, count, apiKey, args.signal)
        break
      }
      case "tinyfish": {
        if (!apiKey) throw new Error("TinyFish API key is missing. Configure it in Settings → Tools.")
        results = await searchTinyFish(args.query, count, apiKey, args.signal)
        break
      }
      case "firecrawl": {
        if (!apiKey) throw new Error("Firecrawl API key is missing. Configure it in Settings → Tools.")
        results = await searchFirecrawl(args.query, count, apiKey, args.signal)
        break
      }
      case "perplexity": {
        if (!apiKey) throw new Error("Perplexity API key is missing. Configure it in Settings → Tools.")
        const res = await searchPerplexity(args.query, count, apiKey, args.signal)
        results = res.results
        answer = res.answer
        break
      }
      case "bing": {
        if (!apiKey) throw new Error("Bing API key is missing. Configure it in Settings → Tools.")
        results = await searchBing(args.query, count, apiKey, args.signal)
        break
      }
      case "duckduckgo":
      default: {
        results = await searchDuckDuckGo(args.query, count, args.signal)
        break
      }
    }
  } catch (err) {
    // If a configured paid provider fails, try falling back to DuckDuckGo so agents aren't stranded
    if (provider !== "duckduckgo") {
      try {
        console.warn(`[web_search] provider ${provider} failed, falling back to DuckDuckGo:`, (err as Error).message)
        results = await searchDuckDuckGo(args.query, count, args.signal)
        return {
          provider: `${provider} (fell back to DuckDuckGo)`,
          fallback: true,
          warning: `Configured search provider "${provider}" encountered an error: ${(err as Error).message}. Automatically fell back to DuckDuckGo.`,
          query: args.query,
          results,
        }
      } catch {}
    }
    throw err
  }

  return {
    provider,
    query: args.query,
    results,
    ...(answer ? { answer } : {}),
  }
}

// ── Web Search Tool Definition ──────────────────────────────────────────────

export function webSearchTool(
  optionsOrOrgId?: { orgId?: string; agentId?: string } | string,
  maybeAgentId?: string,
): ToolSpec {
  const orgId = typeof optionsOrOrgId === "string" ? optionsOrOrgId : optionsOrOrgId?.orgId
  const agentId = typeof optionsOrOrgId === "string" ? maybeAgentId : optionsOrOrgId?.agentId

  return {
    name: "web_search",
    description:
      "Search the public web and return the top results (title, URL, snippet). Supports DuckDuckGo, Tavily, Brave, SearXNG, Serper, Exa, and more. Use whenever current or external information is needed.",
    schema: z.object({
      query: z.string().min(1).max(400),
      count: z.number().int().min(1).max(10).optional(),
    }),
    dangerous: false,
    execute: async (input: { query: string; count?: number }, signal?: AbortSignal) => {
      let config: OrgToolConfig | null = null
      if (orgId) {
        config = await resolveToolCredential({ orgId, agentId, tool: "web_search" }).catch(() => null)
      }

      const envBrave = getEnv().BRAVE_SEARCH_API_KEY
      const selectedProvider = config?.provider || (envBrave ? "brave" : "duckduckgo")
      const apiKey = config?.apiKey || (selectedProvider === "brave" ? envBrave : undefined)
      const baseUrl = config?.baseUrl

      const result = await executeWebSearch({
        query: input.query,
        count: input.count ?? 5,
        provider: selectedProvider,
        apiKey,
        baseUrl,
        signal,
      })

      return result
    },
  }
}
