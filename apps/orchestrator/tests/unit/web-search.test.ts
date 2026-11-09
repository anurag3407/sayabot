import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { executeWebSearch, SEARCH_PROVIDERS } from "../../src/tools/builtins/web-search"
import { cleanHtmlToMarkdown } from "../../src/tools/builtins/web-fetch"

describe("Multi-provider web search engine", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it("exposes all 10 supported providers with metadata", () => {
    const ids = SEARCH_PROVIDERS.map((p) => p.id)
    expect(ids).toContain("duckduckgo")
    expect(ids).toContain("tavily")
    expect(ids).toContain("brave")
    expect(ids).toContain("searxng")
    expect(ids).toContain("serper")
    expect(ids).toContain("exa")
    expect(ids).toContain("tinyfish")
    expect(ids).toContain("firecrawl")
    expect(ids).toContain("perplexity")
    expect(ids).toContain("bing")
    expect(SEARCH_PROVIDERS.length).toBe(10)
  })

  it("parses DuckDuckGo HTML results cleanly with URL unescaping", async () => {
    const mockHtml = `
      <html>
        <body>
          <div class="result results_links">
            <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fai-news">https://example.com/ai-news</a>
            <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fai-news">Latest AI <b>Breakthrough</b> &amp; Insights</a></h2>
            <a class="result__snippet">Scientists reveal new autonomous agent architectures for real-time collaboration.</a>
          </div>
        </body>
      </html>
    `

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockHtml,
    } as unknown as Response)

    const res = await executeWebSearch({
      query: "ai agents",
      count: 5,
      provider: "duckduckgo",
    })

    expect(res.provider).toBe("duckduckgo")
    expect(res.results.length).toBe(1)
    expect(res.results[0].title).toBe("Latest AI Breakthrough & Insights")
    expect(res.results[0].url).toBe("https://example.com/ai-news")
    expect(res.results[0].description).toContain("Scientists reveal new autonomous agent")
  })

  it("executes Tavily search and maps results", async () => {
    const mockTavily = {
      results: [
        {
          title: "Hermes Agent Documentation",
          url: "https://nousresearch.com/hermes",
          content: "Hermes agent with 100+ provider choices.",
        },
      ],
      answer: "Hermes is an autonomous AI agent framework.",
    }

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockTavily,
    } as unknown as Response)

    const res = await executeWebSearch({
      query: "hermes agent",
      count: 3,
      provider: "tavily",
      apiKey: "tvly-test-123",
    })

    expect(res.provider).toBe("tavily")
    expect(res.answer).toBe("Hermes is an autonomous AI agent framework.")
    expect(res.results.length).toBe(1)
    expect(res.results[0].url).toBe("https://nousresearch.com/hermes")
  })

  it("executes Brave search and maps web results", async () => {
    const mockBrave = {
      web: {
        results: [
          {
            title: "Brave Search Index",
            url: "https://search.brave.com",
            description: "Independent search engine.",
          },
        ],
      },
    }

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockBrave,
    } as unknown as Response)

    const res = await executeWebSearch({
      query: "brave",
      count: 2,
      provider: "brave",
      apiKey: "BSA-test",
    })

    expect(res.provider).toBe("brave")
    expect(res.results[0].title).toBe("Brave Search Index")
    expect(res.results[0].url).toBe("https://search.brave.com")
  })

  it("executes Serper (Google) search and maps organic results", async () => {
    const mockSerper = {
      organic: [
        {
          title: "Google Search Result",
          link: "https://google.com/test",
          snippet: "Fast organic snippets from Google index.",
        },
      ],
    }

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSerper,
    } as unknown as Response)

    const res = await executeWebSearch({
      query: "google search",
      count: 2,
      provider: "serper",
      apiKey: "serper-key",
    })

    expect(res.provider).toBe("serper")
    expect(res.results[0].title).toBe("Google Search Result")
    expect(res.results[0].url).toBe("https://google.com/test")
  })

  it("automatically falls back to DuckDuckGo if paid provider call fails", async () => {
    const mockDdHtml = `
      <div class="result results_links">
        <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffallback.org">https://fallback.org</a>
        <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffallback.org">Fallback Success</a></h2>
        <a class="result__snippet">DuckDuckGo rescued the query when Tavily was rate limited.</a>
      </div>
    `

    // First call (Tavily) fails, second call (DuckDuckGo fallback) succeeds
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Tavily 429 Rate limit exceeded"))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => mockDdHtml,
      } as unknown as Response)

    const res = await executeWebSearch({
      query: "fallback test",
      count: 2,
      provider: "tavily",
      apiKey: "tvly-expired",
    })

    expect(res.provider).toContain("fell back to DuckDuckGo")
    expect(res.results.length).toBe(1)
    expect(res.results[0].title).toBe("Fallback Success")
  })
})

describe("cleanHtmlToMarkdown extraction", () => {
  it("converts rich HTML to clean Markdown with entity decoding and link preservation", () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Agent Architecture &amp; Guide</title>
          <script>console.log("drop me")</script>
          <style>body { color: red; }</style>
        </head>
        <body>
          <header><nav><a href="/home">Home</a></nav></header>
          <h1>Understanding Autonomous Agents</h1>
          <p>Agents work best with <strong>clean</strong> context and <em>robust</em> tools.</p>
          <p>Read the <a href="https://example.com/docs">documentation</a> for full details.</p>
          <ul>
            <li>Step 1: Planning</li>
            <li>Step 2: Execution</li>
          </ul>
          <footer>Copyright 2026</footer>
        </body>
      </html>
    `

    const { title, content } = cleanHtmlToMarkdown(sampleHtml)
    expect(title).toBe("Agent Architecture & Guide")
    expect(content).toContain("# Understanding Autonomous Agents")
    expect(content).toContain("**clean**")
    expect(content).toContain("*robust*")
    expect(content).toContain("[documentation](https://example.com/docs)")
    expect(content).toContain("- Step 1: Planning")
    expect(content).toContain("- Step 2: Execution")
    expect(content).not.toContain("console.log")
    expect(content).not.toContain("Copyright 2026")
  })
})
