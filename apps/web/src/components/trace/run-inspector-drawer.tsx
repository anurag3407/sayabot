"use client"

import { useEffect, useState } from "react"
import { getRunTraceAction } from "@/lib/actions/trace"
import type { RunStepKind, RunStepView, RunTraceView } from "@/lib/types"
import { CloseIcon, CopyIcon, TraceIcon, CheckIcon } from "@/components/ui/icons"
import { StatusBadge } from "@/components/ui/status"
import { clockTime, cn } from "@/lib/format"

export interface RunInspectorDrawerProps {
  open: boolean
  onClose: () => void
  orgSlug: string
  runId?: string | null
  messageId?: string | null
  agentName?: string | null
}

export function RunInspectorDrawer({
  open,
  onClose,
  orgSlug,
  runId,
  messageId,
  agentName,
}: RunInspectorDrawerProps) {
  const [trace, setTrace] = useState<RunTraceView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<"all" | RunStepKind>("all")
  const [viewTab, setViewTab] = useState<"timeline" | "raw">("timeline")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open || (!runId && !messageId)) {
      setTrace(null)
      setError(null)
      return
    }

    let active = true
    setLoading(true)
    setError(null)

    getRunTraceAction({ orgSlug, runId, messageId })
      .then((res) => {
        if (!active) return
        if (res.ok && res.trace) {
          setTrace(res.trace)
        } else {
          setError(res.error ?? "Could not load run trace")
        }
      })
      .catch((err) => {
        if (!active) return
        setError(err instanceof Error ? err.message : "Failed to load trace")
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [open, runId, messageId, orgSlug])

  if (!open) return null

  function handleCopyTrace() {
    if (!trace) return
    navigator.clipboard.writeText(JSON.stringify(trace, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const filteredSteps = (trace?.steps ?? []).filter((s) => {
    if (filter === "all") return true
    return s.kind === filter
  })

  const allCount = trace?.steps.length ?? 0
  const modelCount = trace?.steps.filter((s) => s.kind === "model").length ?? 0
  const toolCount = trace?.steps.filter((s) => s.kind === "tool").length ?? 0
  const subagentCount = trace?.steps.filter((s) => s.kind === "subagent").length ?? 0
  const verifyCount = trace?.steps.filter((s) => s.kind === "verify").length ?? 0
  const compactionCount = trace?.steps.filter((s) => s.kind === "compaction").length ?? 0

  const durationStr =
    trace?.latencyMs !== null && trace?.latencyMs !== undefined
      ? trace.latencyMs > 1000
        ? `${(trace.latencyMs / 1000).toFixed(2)}s`
        : `${trace.latencyMs}ms`
      : "—"

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-opacity"
      role="dialog"
      aria-label="Run Trace Inspector"
    >
      <div
        className="relative flex h-full w-full max-w-2xl flex-col border-l border-line bg-base text-text shadow-2xl animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <TraceIcon width={16} height={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[14px] font-semibold tracking-tight text-text">
                  {trace?.agentName || agentName || "Run Trace Inspector"}
                </h2>
                {trace ? <StatusBadge status={trace.status} /> : null}
              </div>
              <p className="font-mono text-[11px] text-faint">
                ID: {trace?.id ?? runId ?? messageId ?? "—"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {trace ? (
              <button
                type="button"
                onClick={handleCopyTrace}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[12px] text-muted hover:bg-raised hover:text-text"
                title="Copy trace JSON"
              >
                {copied ? <CheckIcon width={13} height={13} /> : <CopyIcon width={13} height={13} />}
                <span>{copied ? "Copied" : "Copy JSON"}</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel text-muted hover:bg-raised hover:text-text"
              aria-label="Close drawer"
            >
              <CloseIcon width={14} height={14} />
            </button>
          </div>
        </header>

        {/* Content */}
        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-faint">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />
            <p className="text-[13px]">Loading execution trace and step telemetry…</p>
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
              {error}
            </div>
          </div>
        ) : !trace ? (
          <div className="flex flex-1 items-center justify-center p-8 text-faint">
            No trace found for this execution.
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* KPI Summary Bar */}
            <div className="grid grid-cols-4 gap-2 border-b border-line bg-panel/50 px-5 py-3">
              <div className="flex flex-col">
                <span className="text-[11px] font-medium text-faint uppercase">Duration</span>
                <span className="font-mono text-[13px] font-semibold text-text">{durationStr}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] font-medium text-faint uppercase">Est. Cost</span>
                <span className="font-mono text-[13px] font-semibold text-accent">
                  ${trace.costUsd > 0 ? trace.costUsd.toFixed(4) : "0.0000"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] font-medium text-faint uppercase">Steps</span>
                <span className="font-mono text-[13px] font-semibold text-text">
                  {trace.steps.length} {trace.subagentRuns?.length ? `(+${trace.subagentRuns.length} sub)` : ""}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] font-medium text-faint uppercase">Tokens</span>
                <span className="font-mono text-[12px] font-semibold text-muted">
                  {trace.inputTokens ?? 0} in / {trace.outputTokens ?? 0} out
                </span>
              </div>
            </div>

            {/* View & Filter Tabs */}
            <div className="flex items-center justify-between border-b border-line px-5 py-2">
              <div className="flex flex-wrap items-center gap-1 text-[12px]">
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className={cn(
                    "rounded-md px-2 py-1 font-mono transition-colors",
                    filter === "all" ? "bg-accent text-white" : "text-muted hover:text-text",
                  )}
                >
                  All ({allCount})
                </button>
                {modelCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setFilter("model")}
                    className={cn(
                      "rounded-md px-2 py-1 font-mono transition-colors",
                      filter === "model" ? "bg-accent text-white" : "text-muted hover:text-text",
                    )}
                  >
                    Model ({modelCount})
                  </button>
                ) : null}
                {toolCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setFilter("tool")}
                    className={cn(
                      "rounded-md px-2 py-1 font-mono transition-colors",
                      filter === "tool" ? "bg-accent text-white" : "text-muted hover:text-text",
                    )}
                  >
                    Tools ({toolCount})
                  </button>
                ) : null}
                {subagentCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setFilter("subagent")}
                    className={cn(
                      "rounded-md px-2 py-1 font-mono transition-colors",
                      filter === "subagent" ? "bg-accent text-white" : "text-muted hover:text-text",
                    )}
                  >
                    Subagents ({subagentCount})
                  </button>
                ) : null}
                {verifyCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setFilter("verify")}
                    className={cn(
                      "rounded-md px-2 py-1 font-mono transition-colors",
                      filter === "verify" ? "bg-accent text-white" : "text-muted hover:text-text",
                    )}
                  >
                    Critic ({verifyCount})
                  </button>
                ) : null}
                {compactionCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setFilter("compaction")}
                    className={cn(
                      "rounded-md px-2 py-1 font-mono transition-colors",
                      filter === "compaction" ? "bg-accent text-white" : "text-muted hover:text-text",
                    )}
                  >
                    Compaction ({compactionCount})
                  </button>
                ) : null}
              </div>

              <div className="flex items-center gap-1 border-l border-line pl-3 text-[12px]">
                <button
                  type="button"
                  onClick={() => setViewTab("timeline")}
                  className={cn(
                    "rounded px-2 py-1",
                    viewTab === "timeline" ? "bg-panel text-text font-medium" : "text-faint hover:text-text",
                  )}
                >
                  Timeline
                </button>
                <button
                  type="button"
                  onClick={() => setViewTab("raw")}
                  className={cn(
                    "rounded px-2 py-1",
                    viewTab === "raw" ? "bg-panel text-text font-medium" : "text-faint hover:text-text",
                  )}
                >
                  Raw JSON
                </button>
              </div>
            </div>

            {/* Main Body */}
            <div className="flex-1 overflow-y-auto p-5">
              {viewTab === "raw" ? (
                <pre className="overflow-auto rounded-xl border border-line bg-panel p-4 font-mono text-[11px] leading-relaxed text-muted">
                  {JSON.stringify(trace, null, 2)}
                </pre>
              ) : (
                <div className="space-y-3">
                  {trace.error ? (
                    <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger">
                      <span className="font-semibold">Terminal Error: </span>
                      {trace.error}
                    </div>
                  ) : null}

                  {filteredSteps.length === 0 ? (
                    <div className="rounded-xl border border-line bg-panel/30 p-8 text-center text-[13px] text-faint">
                      No steps match the active filter.
                    </div>
                  ) : (
                    filteredSteps.map((step) => (
                      <StepCard
                        key={step.id || step.idx}
                        step={step}
                        subagentRun={trace.subagentRuns?.find((r) => r.step === step.idx)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StepCard({
  step,
  subagentRun,
}: {
  step: RunStepView
  subagentRun?: RunTraceView
}) {
  const [expanded, setExpanded] = useState(false)
  const [copiedPayload, setCopiedPayload] = useState(false)

  const kindMeta = getKindBadge(step.kind)
  const durationStr =
    step.durationMs !== null
      ? step.durationMs > 1000
        ? `${(step.durationMs / 1000).toFixed(2)}s`
        : `${step.durationMs}ms`
      : null

  const outputObj = step.output as Record<string, unknown> | null
  const textOutput = typeof outputObj?.text === "string" ? outputObj.text : null
  const toolCalls = Array.isArray(outputObj?.toolCalls) ? outputObj.toolCalls : []
  const toolResults = Array.isArray(outputObj?.toolResults) ? outputObj.toolResults : []

  function copyStep() {
    navigator.clipboard.writeText(JSON.stringify(step, null, 2))
    setCopiedPayload(true)
    setTimeout(() => setCopiedPayload(false), 1500)
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-panel/40 transition-colors hover:border-line-strong",
        expanded && "bg-panel border-line-strong",
      )}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex cursor-pointer items-center gap-3 px-4 py-3 select-none"
      >
        <span className="font-mono text-[11px] font-bold text-faint">#{step.idx}</span>

        <span
          className={cn(
            "rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
            kindMeta.badgeClass,
          )}
        >
          {step.kind}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-text">
            {step.inputRef || kindMeta.label}
          </p>
          {textOutput && !expanded ? (
            <p className="truncate font-mono text-[11px] text-faint">
              {textOutput.slice(0, 100)}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {durationStr ? (
            <span className="font-mono text-[11px] text-faint">{durationStr}</span>
          ) : (
            <span className="font-mono text-[11px] text-faint">{clockTime(step.startedAt)}</span>
          )}
          <span className="text-[12px] text-faint">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-line/50 p-4 space-y-3 bg-ink/20 rounded-b-xl">
          {/* Token Usage if available */}
          {step.usage ? (
            <div className="flex items-center gap-4 text-[11px] font-mono text-muted bg-panel px-3 py-1.5 rounded-lg border border-line/40">
              <span>Input: {step.usage.inputTokens ?? 0}</span>
              <span>Output: {step.usage.outputTokens ?? 0}</span>
              <span>Total: {step.usage.totalTokens ?? 0}</span>
            </div>
          ) : null}

          {/* Subagent Child Steps if nested */}
          {subagentRun && subagentRun.steps.length > 0 ? (
            <div className="rounded-lg border border-purple-500/20 bg-purple-950/10 p-3 space-y-2">
              <p className="text-[12px] font-semibold text-purple-300">
                Subagent Run: @{subagentRun.agentHandle || "worker"} ({subagentRun.steps.length} child steps)
              </p>
              <div className="space-y-1.5">
                {subagentRun.steps.map((childStep) => (
                  <div
                    key={childStep.id || childStep.idx}
                    className="flex items-center gap-2 text-[11px] font-mono text-muted"
                  >
                    <span className="text-faint">↳ #{childStep.idx}</span>
                    <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] uppercase">
                      {childStep.kind}
                    </span>
                    <span className="truncate">{childStep.inputRef || "execution"}</span>
                    {childStep.durationMs ? (
                      <span className="ml-auto text-faint">{childStep.durationMs}ms</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Output text or tool details */}
          {textOutput ? (
            <div>
              <p className="text-[11px] font-mono text-faint mb-1">Generated Output:</p>
              <div className="rounded-lg border border-line bg-panel p-3 text-[12px] leading-relaxed text-text whitespace-pre-wrap max-h-60 overflow-y-auto">
                {textOutput}
              </div>
            </div>
          ) : null}

          {toolCalls.length > 0 ? (
            <div>
              <p className="text-[11px] font-mono text-faint mb-1">Tool Invocations:</p>
              <pre className="rounded-lg border border-line bg-panel p-3 font-mono text-[11px] leading-relaxed text-muted max-h-48 overflow-auto">
                {JSON.stringify(toolCalls, null, 2)}
              </pre>
            </div>
          ) : null}

          {toolResults.length > 0 ? (
            <div>
              <p className="text-[11px] font-mono text-faint mb-1">Tool Results:</p>
              <pre className="rounded-lg border border-line bg-panel p-3 font-mono text-[11px] leading-relaxed text-muted max-h-48 overflow-auto">
                {JSON.stringify(toolResults, null, 2)}
              </pre>
            </div>
          ) : null}

          {/* Raw step payload with copy button */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] font-mono text-faint">Full Step Payload</span>
            <button
              type="button"
              onClick={copyStep}
              className="inline-flex items-center gap-1 text-[11px] font-mono text-accent hover:underline"
            >
              {copiedPayload ? "Copied!" : "Copy Step JSON"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function getKindBadge(kind: RunStepKind): { badgeClass: string; label: string } {
  switch (kind) {
    case "model":
      return {
        badgeClass: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
        label: "AI Reasoning & Generation",
      }
    case "tool":
      return {
        badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/20",
        label: "Tool Execution",
      }
    case "subagent":
      return {
        badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/20",
        label: "Subagent Delegation",
      }
    case "verify":
      return {
        badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        label: "Critic Verification",
      }
    case "compaction":
      return {
        badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        label: "Memory Compaction",
      }
    case "recall":
      return {
        badgeClass: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
        label: "Memory Recall",
      }
    case "plan":
      return {
        badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/20",
        label: "Execution Plan Update",
      }
    default:
      return {
        badgeClass: "bg-panel text-muted border-line",
        label: "Execution Step",
      }
  }
}
