"use client"

import { useState, useTransition } from "react"
import { Check, Copy, Cpu, HardDrive, Layers, Server, Sparkles, Zap } from "lucide-react"
import { saveOrgToolConfig, testDocumentOcrAction } from "@/lib/actions/mcp"
import { ActionForm } from "@/components/ui/action-form"
import { Field, Input, Select } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/ui/empty"
import type { OrgToolConfigView } from "@/lib/types"

export interface OcrProviderOption {
  id: string
  name: string
  tag: "Free / Self-Hosted" | "Cloud / BYOK"
  badge: string
  description: string
  tableAccuracy: string
  costEstimate: string
  hardware: {
    cpu: string
    ram: string
    gpu: string
    disk: string
  }
  requiresKey: boolean
  requiresUrl: boolean
  defaultUrl?: string
  dockerSnippet?: string
  docsUrl?: string
}

export const OCR_PROVIDERS: OcrProviderOption[] = [
  {
    id: "docling",
    name: "Docling (IBM Research)",
    tag: "Free / Self-Hosted",
    badge: "Free (SOTA Tables)",
    description:
      "Deep layout analysis (DocLayNet) and neural table reconstruction (TableFormer). Extracts complex multi-page PDFs, bank statements, tax forms, and nested tables into lossless Markdown and structured JSON.",
    tableAccuracy: "99% (SOTA TableFormer)",
    costEstimate: "$0.00 (100% Free & Open Source)",
    hardware: {
      cpu: "4+ Cores recommended",
      ram: "4–8 GB RAM",
      gpu: "Optional (CUDA / Apple Metal MPS)",
      disk: "~2.5 GB model weights",
    },
    requiresKey: false,
    requiresUrl: true,
    defaultUrl: "http://localhost:5001",
    dockerSnippet: "docker run -d -p 5001:5001 quay.io/ds4sd/docling-serve:latest",
    docsUrl: "https://github.com/DS4SD/docling",
  },
  {
    id: "marker",
    name: "Marker (Vik Paruchuri)",
    tag: "Free / Self-Hosted",
    badge: "Free (Books & Papers)",
    description:
      "High-speed deep learning PDF to Markdown converter using Surya OCR. Highly optimized for academic whitepapers, textbooks, and multi-column publications with LaTeX formulas.",
    tableAccuracy: "92% (High fidelity)",
    costEstimate: "$0.00 (100% Free & Open Source)",
    hardware: {
      cpu: "4 Cores",
      ram: "4–6 GB RAM",
      gpu: "Strongly Recommended (CUDA)",
      disk: "~3.0 GB models",
    },
    requiresKey: false,
    requiresUrl: true,
    defaultUrl: "http://localhost:5002",
    dockerSnippet: "docker run -d -p 5002:5002 vikp/marker_api:latest",
    docsUrl: "https://github.com/VikParuchuri/marker",
  },
  {
    id: "tesseract",
    name: "Tesseract / RapidOCR",
    tag: "Free / Self-Hosted",
    badge: "Free (Lightweight)",
    description:
      "Ultra-lightweight optical character recognition for plain text, clean receipts, and single-column scans. Runs easily on minimal 1-core VPS setups.",
    tableAccuracy: "65% (Basic OCR, no deep table hierarchy)",
    costEstimate: "$0.00 (Local / Container)",
    hardware: {
      cpu: "1–2 Cores",
      ram: "< 1 GB RAM",
      gpu: "None needed",
      disk: "~150 MB",
    },
    requiresKey: false,
    requiresUrl: true,
    defaultUrl: "http://localhost:5003",
    dockerSnippet: "docker run -d -p 5003:5003 tesseract-ocr-service",
    docsUrl: "https://github.com/tesseract-ocr/tesseract",
  },
  {
    id: "vision_llm",
    name: "Multimodal AI Vision (Gemini / GPT-4o)",
    tag: "Cloud / BYOK",
    badge: "Cloud AI (BYOK)",
    description:
      "Zero server memory or CPU usage. High-resolution document reading processed through your connected Google Gemini, OpenAI, or Anthropic provider API keys.",
    tableAccuracy: "88% (Stochastic vision)",
    costEstimate: "~$0.005 – $0.02 / page (Billed to your provider key)",
    hardware: {
      cpu: "0 Cores (100% Cloud Serverless)",
      ram: "0 MB local RAM",
      gpu: "None needed",
      disk: "0 MB",
    },
    requiresKey: true,
    requiresUrl: false,
    docsUrl: "https://ai.google.dev",
  },
  {
    id: "mistral_ocr",
    name: "Mistral OCR API",
    tag: "Cloud / BYOK",
    badge: "Cloud API (BYOK)",
    description:
      "Mistral AI's dedicated document understanding API. Purpose-built for multi-page PDF processing with markdown table rendering and fast page throughput.",
    tableAccuracy: "96% (State-of-the-art vision)",
    costEstimate: "~$1.00 / 1,000 pages ($0.001/page)",
    hardware: {
      cpu: "0 Cores (Cloud)",
      ram: "0 MB local RAM",
      gpu: "None",
      disk: "0 MB",
    },
    requiresKey: true,
    requiresUrl: false,
    docsUrl: "https://docs.mistral.ai/capabilities/document/",
  },
  {
    id: "aws_textract",
    name: "AWS Textract",
    tag: "Cloud / BYOK",
    badge: "Enterprise OCR (BYOK)",
    description:
      "Amazon Web Services managed enterprise document extraction service with dedicated Table and Form key-value analysis modules.",
    tableAccuracy: "95% (AWS AnalyzeDocument)",
    costEstimate: "$1.50 – $15.00 / 1,000 pages",
    hardware: {
      cpu: "0 Cores (Cloud)",
      ram: "0 MB local RAM",
      gpu: "None",
      disk: "0 MB",
    },
    requiresKey: true,
    requiresUrl: false,
    docsUrl: "https://aws.amazon.com/textract/",
  },
]

const DEFAULT_PROVIDER: OcrProviderOption = OCR_PROVIDERS[0]!

export function DocumentOcrConfig({
  orgSlug,
  savedConfig,
}: {
  orgSlug: string
  savedConfig?: OrgToolConfigView | null
}) {
  const [filterTab, setFilterTab] = useState<"all" | "free" | "cloud">("all")
  const [selectedProvider, setSelectedProvider] = useState<string>(
    savedConfig?.provider || "docling",
  )
  const [apiKeyInput, setApiKeyInput] = useState<string>("")
  const [baseUrlInput, setBaseUrlInput] = useState<string>(
    savedConfig?.baseUrl || (selectedProvider === "docling" ? "http://localhost:5001" : ""),
  )
  const [fallbackToVision, setFallbackToVision] = useState<boolean>(true)
  const [copiedSnippet, setCopiedSnippet] = useState(false)

  // Testing state
  const [testSource, setTestSource] = useState(
    "https://raw.githubusercontent.com/DS4SD/docling/main/tests/data/2206.01062.pdf",
  )
  const [isTesting, startTest] = useTransition()
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message?: string
    error?: string
    provider?: string
    tablesCount?: number
    pageCount?: number
    latencyMs?: number
    preview?: string
    fallback?: boolean
    warning?: string
  } | null>(null)

  const activeProvider: OcrProviderOption =
    OCR_PROVIDERS.find((p) => p.id === selectedProvider) ?? DEFAULT_PROVIDER

  const isSavedProvider = savedConfig?.provider === selectedProvider
  const hasSavedKey = isSavedProvider && Boolean(savedConfig?.last4)

  const filteredProviders = OCR_PROVIDERS.filter((p) => {
    if (filterTab === "free") return p.tag === "Free / Self-Hosted"
    if (filterTab === "cloud") return p.tag === "Cloud / BYOK"
    return true
  })

  function copyDockerSnippet(snippet: string) {
    navigator.clipboard.writeText(snippet)
    setCopiedSnippet(true)
    setTimeout(() => setCopiedSnippet(false), 2000)
  }

  function runTest() {
    setTestResult(null)
    startTest(async () => {
      const formData = new FormData()
      formData.set("orgSlug", orgSlug)
      formData.set("provider", selectedProvider)
      if (apiKeyInput.trim()) formData.set("apiKey", apiKeyInput.trim())
      if (baseUrlInput.trim()) formData.set("baseUrl", baseUrlInput.trim())
      formData.set("source", testSource.trim())

      const res = await testDocumentOcrAction(null, formData)
      if (!res.ok) {
        setTestResult({
          ok: false,
          error: res.error || "Document extraction test failed",
        })
      } else {
        const d = res.data as {
          provider?: string
          tablesCount?: number
          pageCount?: number
          processingTimeMs?: number
          markdownPreview?: string
          fallback?: boolean
          warning?: string
        }
        setTestResult({
          ok: true,
          message: res.message,
          provider: d?.provider ?? selectedProvider,
          tablesCount: d?.tablesCount ?? 0,
          pageCount: d?.pageCount,
          latencyMs: d?.processingTimeMs,
          preview: d?.markdownPreview,
          fallback: d?.fallback,
          warning: d?.warning,
        })
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Category Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b border-line pb-2">
        <button
          type="button"
          onClick={() => setFilterTab("all")}
          className={`px-2.5 py-1 text-[12px] font-medium rounded-sm transition-colors ${
            filterTab === "all"
              ? "bg-raised text-text font-semibold border border-line"
              : "text-muted hover:text-text"
          }`}
        >
          All Engines ({OCR_PROVIDERS.length})
        </button>
        <button
          type="button"
          onClick={() => setFilterTab("free")}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-sm transition-colors ${
            filterTab === "free"
              ? "bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20"
              : "text-muted hover:text-emerald-400"
          }`}
        >
          <Server className="h-3 w-3" />
          Free & Self-Hosted ({OCR_PROVIDERS.filter((p) => p.tag === "Free / Self-Hosted").length})
        </button>
        <button
          type="button"
          onClick={() => setFilterTab("cloud")}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-sm transition-colors ${
            filterTab === "cloud"
              ? "bg-amber-500/10 text-amber-400 font-semibold border border-amber-500/20"
              : "text-muted hover:text-amber-400"
          }`}
        >
          <Zap className="h-3 w-3" />
          Cloud / BYOK ({OCR_PROVIDERS.filter((p) => p.tag === "Cloud / BYOK").length})
        </button>
      </div>

      {/* Provider Selector Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredProviders.map((provider) => {
          const isSelected = selectedProvider === provider.id
          const isFree = provider.tag === "Free / Self-Hosted"

          return (
            <div
              key={provider.id}
              onClick={() => {
                setSelectedProvider(provider.id)
                if (provider.defaultUrl && !baseUrlInput) {
                  setBaseUrlInput(provider.defaultUrl)
                }
              }}
              className={`cursor-pointer rounded-lg border p-3.5 transition-all text-left flex flex-col justify-between ${
                isSelected
                  ? "border-accent bg-accent/5 ring-1 ring-accent"
                  : "border-line bg-raised/30 hover:border-line-strong hover:bg-raised/60"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-[13px] font-semibold text-text">{provider.name}</h4>
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase font-medium ${
                      isFree
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                        : "bg-amber-500/15 text-amber-400 border border-amber-500/25"
                    }`}
                  >
                    {isFree ? "Free (Local)" : "Paid (BYOK)"}
                  </span>
                </div>

                <p className="mt-1.5 line-clamp-2 text-[11px] text-muted leading-relaxed">
                  {provider.description}
                </p>

                {/* Table Precision Badge */}
                <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-text">
                  <Layers className="h-3.5 w-3.5 text-accent shrink-0" />
                  <span>Table Precision: {provider.tableAccuracy}</span>
                </div>
              </div>

              {/* Hardware / Pricing Specs Footer */}
              <div className="mt-3 pt-2.5 border-t border-line/60">
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px] text-faint">
                  <span className="flex items-center gap-1">
                    <Cpu className="h-3 w-3 text-muted shrink-0" />
                    {provider.hardware.cpu}
                  </span>
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3 text-muted shrink-0" />
                    {provider.hardware.ram}
                  </span>
                </div>
                <div className="mt-1.5 font-mono text-[10px] text-accent/90">
                  {provider.costEstimate}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Configuration Form */}
      <ActionForm action={saveOrgToolConfig} submitLabel="Save Document & OCR Settings">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <input type="hidden" name="tool" value="document_extract" />
        <input type="hidden" name="provider" value={selectedProvider} />
        <input type="hidden" name="fallbackToVision" value={fallbackToVision ? "true" : "false"} />

        <div className="rounded-lg border border-line bg-raised/40 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <div>
              <h3 className="text-[13px] font-semibold text-text flex items-center gap-2">
                Configure {activeProvider.name}
                <span className="rounded bg-panel px-2 py-0.5 font-mono text-[10px] text-muted border border-line">
                  {activeProvider.badge}
                </span>
              </h3>
              <p className="mt-0.5 text-[11px] text-muted">
                {activeProvider.requiresUrl
                  ? "Connect to your local container or internal microservice."
                  : "Bring your own API key to process documents with zero local CPU/memory usage."}
              </p>
            </div>
            {activeProvider.docsUrl && (
              <a
                href={activeProvider.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] text-accent hover:underline flex items-center gap-1"
              >
                Documentation ↗
              </a>
            )}
          </div>

          {/* Docker Run Copy Snippet for Local Engines */}
          {activeProvider.dockerSnippet && (
            <div className="rounded-md border border-line bg-void/70 p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono font-medium text-text flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5 text-accent" />
                  1-Click Docker Command (Zero Python installation required):
                </span>
                <button
                  type="button"
                  onClick={() => copyDockerSnippet(activeProvider.dockerSnippet!)}
                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono rounded bg-raised text-text hover:bg-hover border border-line transition-colors"
                >
                  {copiedSnippet ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy Command
                    </>
                  )}
                </button>
              </div>
              <pre className="font-mono text-[11px] text-emerald-400/90 overflow-x-auto whitespace-pre-wrap select-all">
                {activeProvider.dockerSnippet}
              </pre>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {activeProvider.requiresUrl && (
              <Field label="Engine Service URL" htmlFor="doc-base-url" hint="Local or internal URL">
                <Input
                  id="doc-base-url"
                  name="baseUrl"
                  value={baseUrlInput}
                  onChange={(e) => setBaseUrlInput(e.target.value)}
                  placeholder={activeProvider.defaultUrl || "http://localhost:5001"}
                />
              </Field>
            )}

            {activeProvider.requiresKey && (
              <Field
                label="API Key (BYOK)"
                htmlFor="doc-api-key"
                hint={hasSavedKey ? `Saved: •••• ${savedConfig?.last4}` : "Encrypted with AES-256-GCM"}
              >
                <Input
                  id="doc-api-key"
                  name="apiKey"
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={hasSavedKey ? "Leave blank to keep saved key" : "Paste your API key"}
                />
              </Field>
            )}

            <Field label="Tool State" htmlFor="doc-enabled">
              <Select
                id="doc-enabled"
                name="enabled"
                defaultValue={savedConfig?.enabled === false ? "false" : "true"}
              >
                <option value="true">Enabled (Agents can extract documents)</option>
                <option value="false">Disabled</option>
              </Select>
            </Field>
          </div>

          {/* Auto-Fallback to Cloud Vision Checkbox */}
          <div className="flex items-start gap-2.5 pt-2">
            <input
              id="fallback-vision"
              type="checkbox"
              checked={fallbackToVision}
              onChange={(e) => setFallbackToVision(e.target.checked)}
              className="mt-0.5 rounded border-line bg-raised text-accent focus:ring-accent"
            />
            <label htmlFor="fallback-vision" className="text-[12px] text-text cursor-pointer select-none">
              <span className="font-medium">Auto-Fallback to Multimodal AI Vision</span>
              <p className="text-faint text-[11px]">
                If your local {activeProvider.name} container restarts, experiences high load, or is
                offline, Sayabot will automatically fall back to Cloud AI Vision so agent tasks are never
                blocked.
              </p>
            </label>
          </div>
        </div>
      </ActionForm>

      {/* Live Engine Diagnostic Tester */}
      <div className="rounded-lg border border-line bg-raised/20 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="text-[13px] font-semibold text-text">Test Document Extraction Engine</span>
          </div>
          <span className="font-mono text-[11px] text-faint">
            Testing against: <b className="text-text">{activeProvider.name}</b>
          </span>
        </div>

        <p className="text-[11px] text-muted">
          Validate your connection and table detection accuracy in real time before enabling it for
          multiplayer rooms.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={testSource}
            onChange={(e) => setTestSource(e.target.value)}
            placeholder="https://example.com/sample.pdf"
            className="flex-1 font-mono text-[12px]"
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={runTest}
            disabled={isTesting}
            className="shrink-0"
          >
            {isTesting ? "Testing Extraction..." : "Run Test"}
          </Button>
        </div>

        {testResult && (
          <div className="mt-3">
            {testResult.ok ? (
              <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 p-3 text-[12px] space-y-2">
                <div className="flex items-center justify-between text-emerald-400 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Check className="h-4 w-4" />
                    Engine Active & Connected ({testResult.latencyMs}ms)
                  </span>
                  <span className="font-mono text-[11px]">
                    Tables Found: {testResult.tablesCount}
                  </span>
                </div>

                {testResult.fallback && (
                  <div className="rounded bg-amber-500/15 border border-amber-500/30 p-2 text-amber-300 text-[11px]">
                    ⚠️ {testResult.warning}
                  </div>
                )}

                {testResult.preview && (
                  <div className="mt-2 pt-2 border-t border-emerald-500/20">
                    <span className="font-mono text-[10px] text-muted uppercase">Extracted Markdown Preview:</span>
                    <pre className="mt-1 font-mono text-[11px] text-text bg-void/60 p-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {testResult.preview}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <InlineAlert tone="danger">
                <b>Extraction Failed:</b> {testResult.error}
              </InlineAlert>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
