"use client"

import { useState, useTransition } from "react"
import { Coins, ExternalLink, Eye, EyeOff, Loader2, Play, Search, Zap } from "lucide-react"
import {
  saveOrgToolConfig,
  testWebSearchAction,
  fetchSearchProviderCreditsAction,
} from "@/lib/actions/mcp"
import { ActionForm } from "@/components/ui/action-form"
import { Field, Input } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/ui/empty"
import { cn } from "@/lib/format"
import type { OrgToolConfigView } from "@/lib/types"

export interface SearchProviderOption {
  id: string
  name: string
  tag: "Free / Keyless" | "AI Search" | "Search API" | "Self-Hosted"
  description: string
  requiresKey: boolean
  requiresUrl?: boolean
  urlPlaceholder?: string
  defaultUrl?: string
  keyPlaceholder?: string
  docsUrl?: string
  featured?: boolean
}

export const SEARCH_PROVIDERS: SearchProviderOption[] = [
  {
    id: "tinyfish",
    name: "TinyFish",
    tag: "Free / Keyless",
    description:
      "Fast browser-rendered web, news, and research search API. Free tier with API key.",
    requiresKey: true,
    keyPlaceholder: "tf_… (get free key at tinyfish.ai)",
    docsUrl: "https://tinyfish.ai",
    featured: true,
  },
  {
    id: "context",
    name: "Context.dev",
    tag: "AI Search",
    description:
      "Live web search, citation extraction, and markdown conversion designed for AI agents.",
    requiresKey: true,
    keyPlaceholder: "ctx_… (from context.dev)",
    docsUrl: "https://context.dev",
    featured: true,
  },
  {
    id: "tavily",
    name: "Tavily AI",
    tag: "AI Search",
    description:
      "Purpose-built AI search & extraction engine designed specifically for LLMs and agent grounding.",
    requiresKey: true,
    keyPlaceholder: "tvly-…",
    docsUrl: "https://tavily.com",
    featured: true,
  },
  {
    id: "brave",
    name: "Brave Search",
    tag: "Search API",
    description:
      "Independent global search index with high accuracy, privacy, and 2,000 free queries/mo.",
    requiresKey: true,
    keyPlaceholder: "BSA…",
    docsUrl: "https://brave.com/search/api/",
    featured: true,
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    tag: "Free / Keyless",
    description: "Built-in web search. 100% free, zero keys or external setup needed.",
    requiresKey: false,
  },
  {
    id: "searxng",
    name: "SearXNG",
    tag: "Self-Hosted",
    description:
      "Privacy-respecting open-source metasearch aggregator. Connect your own instance or a public node.",
    requiresKey: false,
    requiresUrl: true,
    urlPlaceholder: "https://searx.be",
    defaultUrl: "https://searx.be",
    docsUrl: "https://docs.searxng.org",
  },
  {
    id: "whoogle",
    name: "Whoogle Search",
    tag: "Self-Hosted",
    description:
      "Self-hosted private Google search proxy with zero ads or tracking. Run locally: docker run -p 5000:5000 benbusby/whoogle-search",
    requiresKey: false,
    requiresUrl: true,
    urlPlaceholder: "http://localhost:5000",
    defaultUrl: "http://localhost:5000",
    docsUrl: "https://github.com/benbusby/whoogle-search",
  },
  {
    id: "serper",
    name: "Serper (Google)",
    tag: "Search API",
    description:
      "Fast Google Search API returning rich organic snippets, knowledge graphs, and links.",
    requiresKey: true,
    keyPlaceholder: "Your Serper API key",
    docsUrl: "https://serper.dev",
  },
  {
    id: "exa",
    name: "Exa (Metaphor)",
    tag: "AI Search",
    description: "Neural embeddings-based semantic web search built for AI agents and LLMs.",
    requiresKey: true,
    keyPlaceholder: "Your Exa API key",
    docsUrl: "https://exa.ai",
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    tag: "AI Search",
    description:
      "Advanced search & web crawler that extracts clean LLM-ready markdown from web pages.",
    requiresKey: true,
    keyPlaceholder: "fc-…",
    docsUrl: "https://firecrawl.dev",
  },
  {
    id: "perplexity",
    name: "Perplexity Sonar",
    tag: "AI Search",
    description:
      "Sonar online reasoning LLM with real-time web search citations and direct answers.",
    requiresKey: true,
    keyPlaceholder: "pplx-…",
    docsUrl: "https://perplexity.ai",
  },
  {
    id: "bing",
    name: "Microsoft Bing",
    tag: "Search API",
    description: "Microsoft Bing Web Search API v7 with worldwide web coverage.",
    requiresKey: true,
    keyPlaceholder: "Your Bing API key",
    docsUrl: "https://www.microsoft.com/en-us/bing/apis/bing-web-search-api",
  },
]

const DEFAULT_PROVIDER: SearchProviderOption = SEARCH_PROVIDERS[0]!

interface SearchResultItem {
  title: string
  url: string
  snippet: string
}

const PRESET_QUERIES = [
  "latest artificial intelligence news",
  "Sayabot remote agent architecture",
  "Google deepmind updates",
]

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
  const [showPassword, setShowPassword] = useState(false)
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

  // Credits & Quota State
  const [isCheckingCredits, startCreditCheck] = useTransition()
  const [creditInfo, setCreditInfo] = useState<{
    ok: boolean
    provider: string
    credits?: string
    remaining?: number
    total?: number
    plan?: string
    details?: string
    error?: string
  } | null>(null)

  const activeProvider: SearchProviderOption =
    SEARCH_PROVIDERS.find((p) => p.id === selectedProvider) ?? DEFAULT_PROVIDER

  const isSavedProvider = savedConfig?.provider === selectedProvider
  const isProviderConfigured =
    (savedConfig?.configuredProviders &&
      savedConfig.configuredProviders.includes(selectedProvider)) ||
    (isSavedProvider && (Boolean(savedConfig?.last4) || !activeProvider.requiresKey))

  function checkCredits() {
    setCreditInfo(null)
    startCreditCheck(async () => {
      const formData = new FormData()
      formData.set("orgSlug", orgSlug)
      formData.set("provider", selectedProvider)
      if (apiKeyInput.trim()) formData.set("apiKey", apiKeyInput.trim())
      if (baseUrlInput.trim()) formData.set("baseUrl", baseUrlInput.trim())

      const res = await fetchSearchProviderCreditsAction(null, formData)
      if (!res.ok) {
        setCreditInfo({
          ok: false,
          provider: selectedProvider,
          error: res.error || "Failed to check credits",
        })
      } else {
        const d = res.data as {
          provider?: string
          credits?: string
          remaining?: number
          total?: number
          plan?: string
          details?: string
        }
        setCreditInfo({
          ok: true,
          provider: d?.provider ?? selectedProvider,
          credits: d?.credits,
          remaining: d?.remaining,
          total: d?.total,
          plan: d?.plan,
          details: d?.details ?? res.message,
        })
      }
    })
  }

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
    <div className="space-y-8">
      {/* Provider Selector Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[13px] font-medium text-text">Choose Search Engine</label>
          <span className="text-[11px] text-faint">
            Default workspace provider:{" "}
            <strong className="text-text font-mono font-medium">
              {savedConfig?.provider || "duckduckgo"}
            </strong>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {SEARCH_PROVIDERS.map((item) => {
            const isSelected = item.id === selectedProvider
            const isDefault = savedConfig?.provider === item.id
            const isConfigured =
              (savedConfig?.configuredProviders &&
                savedConfig.configuredProviders.includes(item.id)) ||
              (isDefault && (Boolean(savedConfig?.last4) || !item.requiresKey))

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedProvider(item.id)
                  if (item.id === "searxng" && !baseUrlInput) {
                    setBaseUrlInput("https://searx.be")
                  } else if (item.id === "whoogle" && !baseUrlInput) {
                    setBaseUrlInput("http://localhost:5000")
                  }
                  setTestResult(null)
                  setCreditInfo(null)
                }}
                className={cn(
                  "group relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all",
                  isSelected
                    ? "border-accent bg-accent/[0.08] shadow-[0_0_0_1px_rgba(157,140,255,0.4)]"
                    : "border-line bg-surface/40 hover:border-line-strong hover:bg-surface/80",
                )}
              >
                <div>
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[13.5px] font-semibold text-text group-hover:text-accent transition-colors">
                      {item.name}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide",
                        item.tag === "Free / Keyless"
                          ? "bg-ok/10 text-ok border border-ok/20"
                          : item.tag === "AI Search"
                            ? "bg-accent/15 text-accent border border-accent/25"
                            : "bg-surface text-muted border border-line",
                      )}
                    >
                      {item.tag}
                    </span>
                  </div>

                  <p className="mt-1.5 text-[11.5px] leading-snug text-muted line-clamp-2">
                    {item.description}
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-between pt-2 border-t border-line/40 text-[11px]">
                  <span className="font-mono text-faint">
                    {item.requiresKey ? "API key required" : "No key needed"}
                  </span>
                  {isDefault ? (
                    <span className="inline-flex items-center gap-1 font-medium text-accent">
                      <Zap className="h-3 w-3" /> Default
                    </span>
                  ) : isConfigured ? (
                    <span className="inline-flex items-center gap-1 text-ok">✓ Configured</span>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Configuration & Save Card */}
      <div className="rounded-2xl border border-line bg-surface/30 p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold text-text">
                Configure {activeProvider.name}
              </h3>
              <span className="rounded-md bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent font-medium">
                {activeProvider.tag}
              </span>
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted">{activeProvider.description}</p>
          </div>

          {activeProvider.docsUrl ? (
            <a
              href={activeProvider.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 font-mono text-[11.5px] text-accent hover:border-accent hover:bg-accent/5 transition-all"
            >
              Get API Key / Docs <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>

        <ActionForm
          action={saveOrgToolConfig}
          submitLabel={isSavedProvider ? "Update Settings" : `Set as Workspace Default`}
          className="space-y-4"
        >
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <input type="hidden" name="tool" value="web_search" />
          <input type="hidden" name="provider" value={selectedProvider} />
          <input type="hidden" name="enabled" value="true" />

          {activeProvider.requiresUrl ? (
            <Field
              label="Instance Base URL"
              htmlFor="search-base-url"
              hint={
                activeProvider.id === "whoogle"
                  ? "Local Whoogle instance URL (docker run -d -p 5000:5000 benbusby/whoogle-search)"
                  : "SearXNG endpoint host URL"
              }
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
              label={`${activeProvider.name} API Key`}
              htmlFor="search-api-key"
              hint={
                isProviderConfigured
                  ? "A key is already configured. Paste a new one to replace it, or leave blank to keep existing."
                  : "Encrypted at rest via AES-256-GCM envelope encryption"
              }
            >
              <div className="relative">
                <Input
                  id="search-api-key"
                  name="apiKey"
                  type={showPassword ? "text" : "password"}
                  autoComplete="off"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={
                    isProviderConfigured
                      ? `••••••••••••••••${savedConfig?.last4 ? ` (ends with ${savedConfig.last4})` : ""}`
                      : (activeProvider.keyPlaceholder ?? "Paste your API key")
                  }
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
          ) : (
            <div className="rounded-xl border border-ok/25 bg-ok/5 p-3.5 text-[12.5px] text-ok">
              ✓ <strong>Zero credentials required</strong>: {activeProvider.name} is ready for all
              bots in this workspace without an API key.
            </div>
          )}
        </ActionForm>

        {/* Credit / Balance & Quota Checker */}
        <div className="rounded-xl border border-line bg-raised/20 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-accent" />
                <span className="text-[13.5px] font-semibold text-text">
                  Available Credits & Balance
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-muted">
                Fetch remaining query balance, API quota, or status for {activeProvider.name}.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={checkCredits}
              disabled={isCheckingCredits}
              className="gap-2 text-[12px]"
            >
              {isCheckingCredits ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking Balance…
                </>
              ) : (
                <>
                  <Coins className="h-3.5 w-3.5" /> Check Available Credits
                </>
              )}
            </Button>
          </div>

          {creditInfo && !creditInfo.ok ? (
            <InlineAlert tone="danger">{creditInfo.error}</InlineAlert>
          ) : null}

          {creditInfo && creditInfo.ok ? (
            <div className="rounded-lg border border-accent/20 bg-accent/5 p-3.5 space-y-2 text-[12.5px]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/15 pb-2">
                <span className="font-semibold text-text">{creditInfo.plan || "Active Tier"}</span>
                <span className="rounded-full bg-accent/20 px-2.5 py-0.5 font-mono text-[11px] font-medium text-accent">
                  {creditInfo.credits || "Active"}
                </span>
              </div>
              {creditInfo.details ? (
                <p className="text-[12px] text-muted leading-relaxed">{creditInfo.details}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Live Search Tester */}
      <div className="rounded-2xl border border-line bg-surface/30 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[14.5px] font-semibold text-text flex items-center gap-2">
              <Search className="h-4 w-4 text-accent" /> Test {activeProvider.name} Live
            </h3>
            <p className="mt-0.5 text-[12px] text-muted">
              Execute a real query to test search connectivity and results latency before agents
              run.
            </p>
          </div>
          <span className="font-mono text-[11px] text-faint">
            Testing with: <span className="text-text font-medium">{activeProvider.name}</span>
          </span>
        </div>

        {/* Quick query chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-faint mr-1">Suggestions:</span>
          {PRESET_QUERIES.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setTestQuery(preset)}
              className="rounded-full border border-line bg-surface/60 px-2.5 py-0.5 text-[11px] text-muted hover:border-line-strong hover:text-text transition-colors"
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            placeholder="Type a query to search..."
            className="flex-1 min-w-[260px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                runTest()
              }
            }}
          />
          <Button
            type="button"
            variant="primary"
            onClick={runTest}
            disabled={isTesting}
            className="gap-2"
          >
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" /> Test Search
              </>
            )}
          </Button>
        </div>

        {testResult && !testResult.ok ? (
          <div className="mt-3">
            <InlineAlert tone="danger">{testResult.error}</InlineAlert>
          </div>
        ) : null}

        {testResult && testResult.ok ? (
          <div className="mt-4 space-y-3.5 rounded-xl border border-line bg-raised/30 p-4 text-[12.5px]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-text">Live Query Output</span>
                <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10.5px] font-medium text-accent">
                  {testResult.provider}
                </span>
                <span className="text-muted">
                  {testResult.count} {testResult.count === 1 ? "result" : "results"}
                </span>
              </div>
              {testResult.latencyMs !== undefined ? (
                <span className="font-mono text-[11px] text-faint">
                  ⏱ {testResult.latencyMs}ms latency
                </span>
              ) : null}
            </div>

            {testResult.answer ? (
              <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 text-text">
                <p className="font-mono text-[11px] font-semibold text-accent uppercase tracking-wider mb-1">
                  Synthesized Answer:
                </p>
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap">
                  {testResult.answer}
                </p>
              </div>
            ) : null}

            {testResult.results && testResult.results.length > 0 ? (
              <div className="space-y-3">
                {testResult.results.map((item, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-line/60 bg-surface/50 p-3 hover:border-line-strong transition-colors"
                  >
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-accent hover:underline text-[13.5px] block truncate"
                    >
                      {item.title || item.url}
                    </a>
                    <p className="font-mono text-[11px] text-faint truncate mt-0.5">{item.url}</p>
                    {item.snippet ? (
                      <p className="mt-1.5 text-[12px] text-muted leading-relaxed">
                        {item.snippet}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-faint py-2">No results returned for this query.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
