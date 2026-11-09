"use client"

import { useState } from "react"
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Check, RotateCcw } from "lucide-react"

export interface MermaidErrorProps {
  chart: string
  error: string
  retry: () => void
  isStreaming?: boolean
}

export function MermaidErrorFallback({
  chart,
  error,
  retry,
  isStreaming = false,
}: MermaidErrorProps) {
  const [showCode, setShowCode] = useState(false)
  const [copied, setCopied] = useState(false)

  // If streaming, diagram is usually still in-flight
  if (isStreaming) {
    return (
      <div className="my-3 flex items-center justify-center gap-2.5 rounded-xl border border-line bg-panel p-6 text-muted">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
        <span className="font-mono text-[12px]">Rendering diagram…</span>
      </div>
    )
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(chart)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  return (
    <div
      className="my-3 overflow-hidden rounded-xl border border-danger/30 bg-danger/10 text-text"
      role="alert"
      data-testid="mermaid-error"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-danger/20 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-danger" />
          <span className="text-[13px] font-medium text-danger">Mermaid Syntax Error</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={retry}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-raised px-2 font-mono text-[11px] text-text hover:bg-hover"
            title="Retry rendering diagram"
          >
            <RotateCcw className="h-3 w-3" /> Retry
          </button>
          <button
            type="button"
            onClick={() => setShowCode(!showCode)}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-raised px-2 font-mono text-[11px] text-muted hover:bg-hover hover:text-text"
          >
            {showCode ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showCode ? "Hide code" : "View code"}
          </button>
        </div>
      </div>

      <div className="px-3.5 py-2">
        <p className="font-mono text-[12px] text-danger/90">{error}</p>
      </div>

      {showCode && (
        <div className="relative border-t border-danger/20 bg-void/60 p-3">
          <button
            type="button"
            onClick={handleCopy}
            className="absolute right-3 top-3 inline-flex items-center gap-1 rounded bg-raised px-2 py-1 font-mono text-[10px] text-muted hover:text-text"
            title="Copy diagram code"
          >
            {copied ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <pre className="max-h-60 overflow-x-auto font-mono text-[12px] leading-relaxed text-muted">
            <code>{chart}</code>
          </pre>
        </div>
      )}
    </div>
  )
}
