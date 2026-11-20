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
  | "whoogle"
  | "serper"
  | "exa"
  | "tinyfish"
  | "context"
  | "context_dev"
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
    description:
      "Keyless, zero-cost web search via DuckDuckGo. Works out of the box with zero configuration.",
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
    id: "context",
    name: "Context.dev",
    description:
      "Live web search, citation extraction, and markdown conversion designed for AI agents.",
    badge: "AI Search",
    requiresKey: true,
    keyPlaceholder: "ctx_… (from context.dev)",
    docsUrl: "https://context.dev",
  },
  {
    id: "tavily",
    name: "Tavily",
    description:
      "AI-native search engine built for agents with synthesis and clean extracted context.",
    badge: "AI Search",
    requiresKey: true,
    keyPlaceholder: "tvly-…",
    docsUrl: "https://tavily.com",
  },
  {
    id: "brave",
    name: "Brave Search",
    description:
      "Independent, privacy-focused search index with fast results and 2,000 free queries/mo.",
    badge: "Search API",
    requiresKey: true,
    keyPlaceholder: "BSA…",
    docsUrl: "https://brave.com/search/api",
  },
  {
    id: "searxng",
    name: "SearXNG",
    description:
      "Open-source privacy metasearch engine. Connect to any public or self-hosted instance.",
    badge: "Self-Hosted",
    requiresKey: false,
    requiresUrl: true,
    keyPlaceholder: "Optional API token",
    docsUrl: "https://docs.searxng.org",
  },
  {
    id: "whoogle",
    name: "Whoogle Search",
    description:
      "Self-hosted private Google search proxy with zero ads or tracking. Run via Docker.",
    badge: "Self-Hosted",
    requiresKey: false,
    requiresUrl: true,
    keyPlaceholder: "Optional Basic Auth",
    docsUrl: "https://github.com/benbusby/whoogle-search",
  },
  {
    id: "serper",
    name: "Serper (Google Search)",
    description:
      "Fast Google Search API returning organic results, knowledge graphs, and snippets.",
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

async function searchDuckDuckGo(
  query: string,
  count: number,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
      block.match(
        /<a class="result__url"[^>]*href="([^"]+)"[\s\S]*?<h2 class="result__title">([\s\S]*?)<\/h2>/i,
      ) ||
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

async function searchWhoogle(
  query: string,
  count: number,
  baseUrl?: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const base = (baseUrl || "http://localhost:5000").replace(/\/+$/, "")
  await assertSafeWebhookUrl(base, false)
  const url = `${base}/search?q=${encodeURIComponent(query)}`
  const headers: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  }
  if (apiKey) headers.Authorization = apiKey.startsWith("Basic ") ? apiKey : `Bearer ${apiKey}`
  const response = await fetch(url, { headers, signal })
  if (!response.ok) {
    throw new Error(`Whoogle instance returned HTTP ${response.status} at ${base}`)
  }
  const text = await response.text()
  try {
    const json = JSON.parse(text)
    if (Array.isArray(json.results)) {
      return json.results.slice(0, count).map((r: any) => ({
        title: r.title || "",
        url: r.url || r.link || "",
        description: r.content || r.snippet || "",
      }))
    }
  } catch {}

  const results: SearchResultItem[] = []
  const linkRegex =
    /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>[\s\S]*?(?:<div[^>]*class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/div>|<p[^>]*>([\s\S]*?)<\/p>)?/gi
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(text)) !== null && results.length < count) {
    let href = match[1] || ""
    const title = decodeHtmlEntities((match[2] || "").replace(/<[^>]+>/g, "").trim())
    const snippet = decodeHtmlEntities((match[3] || match[4] || "").replace(/<[^>]+>/g, "").trim())
    if (href.startsWith("/url?q=")) {
      try {
        const parsed = new URL(href, "http://localhost")
        href = parsed.searchParams.get("q") || href
      } catch {}
    }
    if (href.startsWith("http://") || href.startsWith("https://")) {
      results.push({
        title,
        url: href,
        description: snippet,
      })
    }
  }

  if (results.length === 0) {
    const simpleRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    while ((match = simpleRegex.exec(text)) !== null && results.length < count) {
      const href = match[1] || ""
      const title = decodeHtmlEntities((match[2] || "").replace(/<[^>]+>/g, "").trim())
      if (title.length > 5 && !href.includes("google.com") && !href.includes("whoogle")) {
        results.push({
          title,
          url: href,
          description: "",
        })
      }
    }
  }

  return results
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

async function searchContextDev(
  query: string,
  count: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ results: SearchResultItem[]; answer?: string }> {
  let response = await fetch("https://api.context.dev/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query,
      numResults: count,
      responseMode: "compact",
    }),
    signal,
  }).catch(() => null)

  if (!response || !response.ok) {
    response = await fetch(
      `https://api.context.dev/v1/search?query=${encodeURIComponent(query)}&limit=${count}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-API-Key": apiKey,
          Accept: "application/json",
        },
        signal,
      },
    )
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Context.dev search failed (${response.status}): ${text.slice(0, 200)}`)
  }

  const data = (await response.json()) as any
  const rawResults: any[] = data.results ?? data.data ?? (Array.isArray(data) ? data : [])
  const results: SearchResultItem[] = rawResults.slice(0, count).map((r: any) => ({
    title: r.title ?? r.name ?? "",
    url: r.url ?? r.link ?? "",
    description:
      r.description ?? r.snippet ?? r.markdown?.slice(0, 300) ?? r.text?.slice(0, 300) ?? "",
  }))

  return {
    results,
    answer: data.answer ?? data.summary,
  }
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
      messages: [
        {
          role: "user",
          content: `Search the web and provide concise findings with source URLs for: ${query}`,
        },
      ],
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
    results.push({
      title: "Perplexity Search Result",
      url: "https://perplexity.ai",
      description: answer,
    })
  }
  return { results, answer }
}

async function searchBing(
  query: string,
  count: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<SearchResultItem[]> {
  const response = await fetch(
    `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${count}`,
    {
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
      },
      signal,
    },
  )
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
        if (!key)
          throw new Error("Brave Search API key is missing. Configure it in Settings → Tools.")
        results = await searchBrave(args.query, count, key, args.signal)
        break
      }
      case "searxng": {
        results = await searchSearXNG(args.query, count, args.baseUrl, apiKey, args.signal)
        break
      }
      case "whoogle": {
        results = await searchWhoogle(args.query, count, args.baseUrl, apiKey, args.signal)
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
        if (!apiKey)
          throw new Error("TinyFish API key is missing. Configure it in Settings → Search.")
        results = await searchTinyFish(args.query, count, apiKey, args.signal)
        break
      }
      case "context":
      case "context_dev": {
        if (!apiKey)
          throw new Error("Context.dev API key is missing. Configure it in Settings → Search.")
        const res = await searchContextDev(args.query, count, apiKey, args.signal)
        results = res.results
        answer = res.answer
        break
      }
      case "firecrawl": {
        if (!apiKey)
          throw new Error("Firecrawl API key is missing. Configure it in Settings → Tools.")
        results = await searchFirecrawl(args.query, count, apiKey, args.signal)
        break
      }
      case "perplexity": {
        if (!apiKey)
          throw new Error("Perplexity API key is missing. Configure it in Settings → Tools.")
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
        console.warn(
          `[web_search] provider ${provider} failed, falling back to DuckDuckGo:`,
          (err as Error).message,
        )
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
        config = await resolveToolCredential({ orgId, agentId, tool: "web_search" }).catch(
          () => null,
        )
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

// ── Credit & Balance Checking ────────────────────────────────────────────────

export interface ProviderCreditInfo {
  ok: boolean
  provider: string
  credits?: string
  remaining?: number
  total?: number
  plan?: string
  resetDate?: string
  details?: string
  error?: string
}

export async function fetchProviderCredits(args: {
  provider: string
  apiKey?: string
  baseUrl?: string
  signal?: AbortSignal
}): Promise<ProviderCreditInfo> {
  const provider = (args.provider || "duckduckgo").toLowerCase()
  const apiKey = args.apiKey || ""
  const baseUrl = args.baseUrl

  switch (provider) {
    case "duckduckgo": {
      return {
        ok: true,
        provider: "duckduckgo",
        plan: "Free / Public",
        credits: "Unlimited",
        details: "Zero credentials required. Direct keyless web search access.",
      }
    }

    case "whoogle": {
      const base = (baseUrl || "http://localhost:5000").replace(/\/+$/, "")
      try {
        await assertSafeWebhookUrl(base, false)
        const res = await fetch(`${base}/`, {
          signal: args.signal || AbortSignal.timeout(5000),
          headers: { "User-Agent": "Sayabot/1.0" },
        })
        if (!res.ok && res.status !== 401 && res.status !== 403) {
          return {
            ok: false,
            provider: "whoogle",
            error: `Whoogle returned HTTP ${res.status} at ${base}`,
          }
        }
        return {
          ok: true,
          provider: "whoogle",
          plan: "Self-Hosted / Local Docker",
          credits: "Local (Unlimited)",
          details: `Connected to Whoogle instance at ${base}. Run with: docker run -d -p 5000:5000 benbusby/whoogle-search`,
        }
      } catch (e) {
        return {
          ok: false,
          provider: "whoogle",
          error: `Could not reach Whoogle instance at ${base}: ${(e as Error).message}`,
        }
      }
    }

    case "searxng": {
      const base = (baseUrl || "https://searx.be").replace(/\/+$/, "")
      try {
        await assertSafeWebhookUrl(base, false)
        const res = await fetch(`${base}/stats`, {
          signal: args.signal || AbortSignal.timeout(5000),
          headers: { Accept: "application/json" },
        }).catch(() => fetch(`${base}/`, { signal: args.signal || AbortSignal.timeout(5000) }))
        if (!res || !res.ok) {
          return {
            ok: false,
            provider: "searxng",
            error: `SearXNG instance at ${base} responded with error`,
          }
        }
        return {
          ok: true,
          provider: "searxng",
          plan: "Self-Hosted / Metasearch",
          credits: "Unlimited",
          details: `Connected to SearXNG instance at ${base}. Metasearch queries are unlimited.`,
        }
      } catch (e) {
        return {
          ok: false,
          provider: "searxng",
          error: `Could not reach SearXNG instance at ${base}: ${(e as Error).message}`,
        }
      }
    }

    case "serper": {
      if (!apiKey) return { ok: false, provider: "serper", error: "Missing Serper API key." }
      try {
        const res = await fetch("https://google.serper.dev/account", {
          method: "POST",
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
          signal: args.signal || AbortSignal.timeout(8000),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          return {
            ok: false,
            provider: "serper",
            error: `Serper error (${res.status}): ${errText.slice(0, 100)}`,
          }
        }
        const data = (await res.json()) as { credits?: number; rateLimit?: number }
        const credits = data.credits ?? 0
        return {
          ok: true,
          provider: "serper",
          plan: "Pay-as-you-go / Developer",
          credits: `${credits.toLocaleString()} queries remaining`,
          remaining: credits,
          details: `Rate limit: ${data.rateLimit ?? 50} req/sec`,
        }
      } catch (e) {
        return { ok: false, provider: "serper", error: (e as Error).message }
      }
    }

    case "firecrawl": {
      if (!apiKey) return { ok: false, provider: "firecrawl", error: "Missing Firecrawl API key." }
      try {
        const res = await fetch("https://api.firecrawl.dev/v1/team/credit-usage", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: args.signal || AbortSignal.timeout(8000),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          return {
            ok: false,
            provider: "firecrawl",
            error: `Firecrawl error (${res.status}): ${errText.slice(0, 100)}`,
          }
        }
        const data = (await res.json()) as {
          success?: boolean
          data?: { remaining_credits?: number; total_credits?: number }
        }
        const remaining = data.data?.remaining_credits ?? 0
        const total = data.data?.total_credits
        return {
          ok: true,
          provider: "firecrawl",
          plan: "Active Firecrawl Team",
          credits: total
            ? `${remaining.toLocaleString()} / ${total.toLocaleString()} credits`
            : `${remaining.toLocaleString()} credits remaining`,
          remaining,
          total,
          details: "Verified Firecrawl credentials & credit balance",
        }
      } catch (e) {
        return { ok: false, provider: "firecrawl", error: (e as Error).message }
      }
    }

    case "brave": {
      const key = apiKey || getEnv().BRAVE_SEARCH_API_KEY
      if (!key) return { ok: false, provider: "brave", error: "Missing Brave Search API key." }
      try {
        const res = await fetch("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
          headers: {
            Accept: "application/json",
            "x-subscription-token": key,
          },
          signal: args.signal || AbortSignal.timeout(8000),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          return {
            ok: false,
            provider: "brave",
            error: `Brave Search error (${res.status}): ${errText.slice(0, 100)}`,
          }
        }
        const remainingHeader = res.headers.get("x-ratelimit-remaining")
        const limitHeader = res.headers.get("x-ratelimit-limit")
        const remaining = remainingHeader ? parseInt(remainingHeader, 10) : undefined
        return {
          ok: true,
          provider: "brave",
          plan: "Brave Search (2,000 free/mo)",
          credits:
            remaining !== undefined
              ? `${remaining.toLocaleString()} queries remaining in window`
              : "Active (2,000 queries/mo free)",
          remaining,
          details: limitHeader
            ? `Rate limit: ${limitHeader}`
            : "Verified active Brave subscription token",
        }
      } catch (e) {
        return { ok: false, provider: "brave", error: (e as Error).message }
      }
    }

    case "context":
    case "context_dev": {
      if (!apiKey) return { ok: false, provider: "context", error: "Missing Context.dev API key." }
      try {
        const res = await fetch("https://api.context.dev/v1/usage", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "X-API-Key": apiKey,
          },
          signal: args.signal || AbortSignal.timeout(8000),
        }).catch(() => null)

        if (res && res.ok) {
          const data = (await res.json().catch(() => ({}))) as any
          const remaining = data.remaining ?? data.credits ?? data.balance
          return {
            ok: true,
            provider: "context",
            plan: data.plan ?? "Context.dev Agent Search",
            credits: remaining ? `${remaining} credits` : "Active (Standard Tier)",
            remaining: typeof remaining === "number" ? remaining : undefined,
            details: "Verified Context.dev API key and active quota",
          }
        }

        const testRes = await fetch("https://api.context.dev/v1/search?query=test&limit=1", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "X-API-Key": apiKey,
          },
          signal: args.signal || AbortSignal.timeout(8000),
        })
        if (!testRes.ok) {
          const errText = await testRes.text().catch(() => "")
          return {
            ok: false,
            provider: "context",
            error: `Context.dev returned (${testRes.status}): ${errText.slice(0, 100)}`,
          }
        }
        const remHeader =
          testRes.headers.get("x-ratelimit-remaining") || testRes.headers.get("x-credits-remaining")
        return {
          ok: true,
          provider: "context",
          plan: "Context.dev AI Search",
          credits: remHeader ? `${remHeader} credits remaining` : "Active API Key",
          details: "Verified active Context.dev key for AI web search and citations",
        }
      } catch (e) {
        return { ok: false, provider: "context", error: (e as Error).message }
      }
    }

    case "tinyfish": {
      if (!apiKey) return { ok: false, provider: "tinyfish", error: "Missing TinyFish API key." }
      try {
        const res = await fetch("https://api.search.tinyfish.ai/?q=test", {
          headers: {
            "X-API-Key": apiKey,
            Accept: "application/json",
          },
          signal: args.signal || AbortSignal.timeout(8000),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          return {
            ok: false,
            provider: "tinyfish",
            error: `TinyFish error (${res.status}): ${errText.slice(0, 100)}`,
          }
        }
        const remHeader = res.headers.get("x-ratelimit-remaining")
        return {
          ok: true,
          provider: "tinyfish",
          plan: "TinyFish Community / Developer",
          credits: remHeader ? `${remHeader} requests remaining in window` : "Active (Free Tier)",
          details: "Verified active TinyFish browser-rendered search key",
        }
      } catch (e) {
        return { ok: false, provider: "tinyfish", error: (e as Error).message }
      }
    }

    case "tavily": {
      if (!apiKey) return { ok: false, provider: "tavily", error: "Missing Tavily API key." }
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey, query: "ping", max_results: 1 }),
          signal: args.signal || AbortSignal.timeout(8000),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          return {
            ok: false,
            provider: "tavily",
            error: `Tavily error (${res.status}): ${errText.slice(0, 100)}`,
          }
        }
        return {
          ok: true,
          provider: "tavily",
          plan: "Tavily AI Search (1,000 free/mo on Free tier)",
          credits: "Active API Key",
          details: "Verified Tavily AI search key is working and operational",
        }
      } catch (e) {
        return { ok: false, provider: "tavily", error: (e as Error).message }
      }
    }

    case "exa": {
      if (!apiKey) return { ok: false, provider: "exa", error: "Missing Exa API key." }
      try {
        const res = await fetch("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: "ping", num_results: 1 }),
          signal: args.signal || AbortSignal.timeout(8000),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          return {
            ok: false,
            provider: "exa",
            error: `Exa error (${res.status}): ${errText.slice(0, 100)}`,
          }
        }
        return {
          ok: true,
          provider: "exa",
          plan: "Exa Neural Search (1,000 free/mo)",
          credits: "Active API Key",
          details: "Verified Exa neural semantic search API key is active",
        }
      } catch (e) {
        return { ok: false, provider: "exa", error: (e as Error).message }
      }
    }

    case "perplexity": {
      if (!apiKey)
        return { ok: false, provider: "perplexity", error: "Missing Perplexity API key." }
      try {
        const res = await fetch("https://api.perplexity.ai/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: args.signal || AbortSignal.timeout(8000),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          return {
            ok: false,
            provider: "perplexity",
            error: `Perplexity error (${res.status}): ${errText.slice(0, 100)}`,
          }
        }
        return {
          ok: true,
          provider: "perplexity",
          plan: "Perplexity Sonar Online",
          credits: "Active Account",
          details: "Verified Perplexity API key with access to Sonar search models",
        }
      } catch (e) {
        return { ok: false, provider: "perplexity", error: (e as Error).message }
      }
    }

    case "bing": {
      if (!apiKey) return { ok: false, provider: "bing", error: "Missing Bing API key." }
      try {
        const res = await fetch("https://api.bing.microsoft.com/v7.0/search?q=test&count=1", {
          headers: { "Ocp-Apim-Subscription-Key": apiKey },
          signal: args.signal || AbortSignal.timeout(8000),
        })
        if (!res.ok) {
          const errText = await res.text().catch(() => "")
          return {
            ok: false,
            provider: "bing",
            error: `Bing error (${res.status}): ${errText.slice(0, 100)}`,
          }
        }
        return {
          ok: true,
          provider: "bing",
          plan: "Microsoft Azure Cognitive Services",
          credits: "Active Key",
          details: "Verified Bing Web Search v7 subscription key",
        }
      } catch (e) {
        return { ok: false, provider: "bing", error: (e as Error).message }
      }
    }

    default: {
      return {
        ok: false,
        provider,
        error: `Unknown search provider: ${provider}`,
      }
    }
  }
}
