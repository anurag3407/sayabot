"use client"

import { useState, useTransition } from "react"
import { saveOrgToolConfig, testWebSearchAction } from "@/lib/actions/mcp"
import { ActionForm } from "@/components/ui/action-form"
import { Field, HelpText, Input, Select } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/ui/empty"
import type { OrgToolConfigView } from "@/lib/types"

export interface SearchProviderOption {
  id: string
  name: string
  tag: "Free / Keyless" | "AI Search" | "Search API"
  description: string
  requiresKey: boolean
  requiresUrl?: boolean
  urlPlaceholder?: string
  defaultUrl?: string
  docsUrl?: string
}

export const SEARCH_PROVIDERS: SearchProviderOption[] = [
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    tag: "Free / Keyless",
    description: "Built-in web scraping with URL decoding. 100% free, zero keys or setup needed.",
    requiresKey: false,
  },
  {
    id: "tinyfish",
    name: "TinyFish Search",
    tag: "Free / Keyless",
    description: "Zero-cost developer search & extraction engine (inspired by Monid).",
    requiresKey: false,
    docsUrl: "https://tinyfish.ai",
  },
  {
    id: "tavily",
    name: "Tavily AI",
    tag: "AI Search",
    description: "Purpose-built AI search & extraction engine designed specifically for LLMs and agent grounding.",
    requiresKey: true,
    docsUrl: "https://tavily.com",
  },
  {
    id: "brave",
    name: "Brave Search",
    tag: "Search API",
    description: "Independent global search index with high accuracy and low latency.",
    requiresKey: true,
    docsUrl: "https://brave.com/search/api/",
  },
  {
    id: "searxng",
    name: "SearXNG (Self-Hosted / Public)",
    tag: "Free / Keyless",
    description: "Privacy-respecting open-source metasearch aggregator. Connect your own instance or a public node.",
    requiresKey: false,
    requiresUrl: true,
    urlPlaceholder: "https://searx.be",
    defaultUrl: "https://searx.be",
    docsUrl: "https://docs.searxng.org",
  },
  {
    id: "serper",
    name: "Serper (Google Search)",
    tag: "Search API",
    description: "Fast Google Search API returning rich organic snippets, knowledge graphs, and links.",
    requiresKey: true,
    docsUrl: "https://serper.dev",
  },
  {
    id: "exa",
    name: "Exa (Metaphor)",
    tag: "AI Search",
    description: "Neural embeddings-based semantic web search built for AI agents and LLMs.",
    requiresKey: true,
    docsUrl: "https://exa.ai",
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    tag: "AI Search",
    description: "Advanced search & web crawler that extracts clean LLM-ready markdown from web pages.",
    requiresKey: true,
    docsUrl: "https://firecrawl.dev",
  },
  {
    id: "perplexity",
    name: "Perplexity Sonar",
    tag: "AI Search",
    description: "Sonar online reasoning LLM with real-time web search citations and direct answers.",
    requiresKey: true,
    docsUrl: "https://perplexity.ai",
  },
  {
    id: "bing",
    name: "Microsoft Bing",
    tag: "Search API",
    description: "Microsoft Bing Web Search API v7 with worldwide web coverage.",
    requiresKey: true,
    docsUrl: "https://www.microsoft.com/en-us/bing/apis/bing-web-search-api",
  },
]

const DEFAULT_PROVIDER: SearchProviderOption = SEARCH_PROVIDERS[0]!

interface SearchResultItem {
  title: string
  url: string
  snippet: string
}

export function WebSearchConfig({
  orgSlug,
  savedConfig,
}: {
  orgSlug: string
  savedConfig?: OrgToolConfigView | null
}) {
  const [selectedProvider, setSelectedProvider] = useState<string>(
    savedConfig?.provider || "duckduckgo",
  )
  const [apiKeyInput, setApiKeyInput] = useState<string>("")
  const [baseUrlInput, setBaseUrlInput] = useState<string>(
    savedConfig?.baseUrl || (selectedProvider === "searxng" ? "https://searx.be" : ""),
  )

  // Testing state
  const [testQuery, setTestQuery] = useState("latest artificial intelligence news")
  const [isTesting, startTest] = useTransition()
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message?: string
    error?: string
    provider?: string
    count?: number
    latencyMs?: number
    answer?: string
    results?: SearchResultItem[]
  } | null>(null)

  const activeProvider: SearchProviderOption =
    SEARCH_PROVIDERS.find((p) => p.id === selectedProvider) ?? DEFAULT_PROVIDER

  const isSavedProvider = savedConfig?.provider === selectedProvider
  const hasSavedKey = isSavedProvider && Boolean(savedConfig?.last4)

  function runTest() {
    setTestResult(null)
    startTest(async () => {
      const formData = new FormData()
      formData.set("orgSlug", orgSlug)
      formData.set("provider", selectedProvider)
      if (apiKeyInput.trim()) formData.set("apiKey", apiKeyInput.trim())
      if (baseUrlInput.trim()) formData.set("baseUrl", baseUrlInput.trim())
      formData.set("query", testQuery.trim() || "latest artificial intelligence news")

      const res = await testWebSearchAction(null, formData)
      if (!res.ok) {
        setTestResult({
          ok: false,
          error: res.error || "Search test failed",
        })
      } else {
        const d = res.data as {
          provider?: string
          count?: number
          latencyMs?: number
          answer?: string
          results?: SearchResultItem[]
        }
        setTestResult({
          ok: true,
          message: res.message,
          provider: d?.provider ?? selectedProvider,
          count: d?.count ?? 0,
          latencyMs: d?.latencyMs,
          answer: d?.answer,
          results: d?.results ?? [],
        })
      }
    })
  }

  return (
    <div className="space-y-6">
      <ActionForm action={saveOrgToolConfig} submitLabel="Save Web Search Settings">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="tool" value="web_search" />
        <input type="hidden" name="provider" value={selectedProvider} />

        <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
          <Field label="search provider" htmlFor="search-provider">
            <Select
              id="search-provider"
              value={selectedProvider}
              onChange={(e) => {
                const next = e.target.value
                setSelectedProvider(next)
                if (next === "searxng" && !baseUrlInput) {
                  setBaseUrlInput("https://searx.be")
                }
              }}
            >
              <optgroup label="Free / Zero-Cost Providers">
                {SEARCH_PROVIDERS.filter((p) => p.tag === "Free / Keyless").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="AI Search Engines">
                {SEARCH_PROVIDERS.filter((p) => p.tag === "AI Search").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Web Search APIs">
                {SEARCH_PROVIDERS.filter((p) => p.tag === "Search API").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>

          <Field label="state" htmlFor="search-enabled">
            <Select
              id="search-enabled"
              name="enabled"
              defaultValue={savedConfig?.enabled === false ? "false" : "true"}
            >
              <option value="true">enabled</option>
              <option value="false">disabled</option>
            </Select>
          </Field>
        </div>

        <div className="rounded-sm border border-line bg-raised/40 p-3 text-[12px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-medium text-text">{activeProvider.name}</span>
              <span className="rounded-sm bg-panel px-1.5 py-0.5 font-mono text-[10px] text-muted border border-line">
                {activeProvider.tag}
              </span>
            </div>
            {activeProvider.docsUrl ? (
              <a
                href={activeProvider.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] text-accent hover:underline"
              >
                Get API key / Docs ↗
              </a>
            ) : null}
          </div>
          <p className="mt-1 text-faint leading-relaxed">{activeProvider.description}</p>
        </div>

        {activeProvider.requiresUrl ? (
          <Field
            label="instance base url"
            htmlFor="search-base-url"
            hint="URL of your SearXNG instance"
          >
            <Input
              id="search-base-url"
              name="baseUrl"
              value={baseUrlInput}
              onChange={(e) => setBaseUrlInput(e.target.value)}
              placeholder={activeProvider.urlPlaceholder ?? "https://searx.be"}
            />
          </Field>
        ) : null}

        {activeProvider.requiresKey ? (
          <Field
            label="api key"
            htmlFor="search-api-key"
            hint={
              hasSavedKey
                ? `Saved key ends with ••••${savedConfig?.last4} (leave empty to keep)`
                : "Sealed with AES-256-GCM at rest"
            }
          >
            <Input
              id="search-api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={hasSavedKey ? "••••••••••••••••" : "Paste API key"}
            />
          </Field>
        ) : null}

        {!activeProvider.requiresKey && !activeProvider.requiresUrl ? (
          <div className="rounded-sm border border-ok/30 bg-ok/5 px-3 py-2 text-[12px] text-ok">
            ✓ <strong>No API key required</strong>: This provider works out-of-the-box for all agents in your workspace.
          </div>
        ) : null}
      </ActionForm>

      {/* Live Search Tester */}
      <div className="border-t border-line/60 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-medium text-text">Test Search Live</h3>
            <p className="text-[11px] text-muted">
              Verify your selected provider works before agents run tasks.
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            placeholder="Type a test query..."
            className="flex-1 min-w-[240px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                runTest()
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={runTest}
            disabled={isTesting}
          >
            {isTesting ? "Searching…" : "Test Search"}
          </Button>
        </div>

        {testResult && !testResult.ok ? (
          <div className="mt-3">
            <InlineAlert tone="danger">{testResult.error}</InlineAlert>
          </div>
        ) : null}

        {testResult && testResult.ok ? (
          <div className="mt-3 space-y-3 rounded-sm border border-line bg-raised/20 p-3 text-[12px]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-text">Live Results</span>
                <span className="rounded-sm bg-panel px-1.5 py-0.5 font-mono text-[10px] text-muted border border-line">
                  {testResult.provider}
                </span>
                <span className="text-[11px] text-muted">
                  {testResult.count} {testResult.count === 1 ? "result" : "results"}
                </span>
              </div>
              {testResult.latencyMs !== undefined ? (
                <span className="font-mono text-[10px] text-faint">
                  {testResult.latencyMs}ms
                </span>
              ) : null}
            </div>

            {testResult.answer ? (
              <div className="rounded-sm border border-line-strong bg-raised/80 p-2.5">
                <p className="font-mono text-[11px] font-medium text-text">Direct Answer:</p>
                <p className="mt-1 text-[12px] leading-relaxed text-text whitespace-pre-wrap">
                  {testResult.answer}
                </p>
              </div>
            ) : null}

            {testResult.results && testResult.results.length > 0 ? (
              <div className="space-y-2">
                {testResult.results.slice(0, 5).map((item, idx) => (
                  <div key={idx} className="border-b border-line/40 pb-2 last:border-0 last:pb-0">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-accent hover:underline block truncate"
                    >
                      {item.title || item.url}
                    </a>
                    <p className="font-mono text-[10px] text-faint truncate">{item.url}</p>
                    {item.snippet ? (
                      <p className="mt-0.5 text-[11px] text-muted line-clamp-2 leading-relaxed">
                        {item.snippet}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-faint">No search results returned for this query.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
