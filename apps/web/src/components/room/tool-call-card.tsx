"use client"

import { useEffect, useId, useRef, useState, useTransition } from "react"
import {
  Brain,
  ChevronRight,
  FileCode,
  FileText,
  Globe,
  Search,
  Terminal,
  Wrench,
} from "lucide-react"
import { resolveToolCall } from "@/lib/actions/messages"
import { Button } from "@/components/ui/button"
import { CopyButton } from "@/components/copy-button"
import { StatusBadge } from "@/components/ui/status"
import { clockTime, cn, pretty } from "@/lib/format"
import { CheckIcon, CloseIcon } from "@/components/ui/icons"
import {
  describeMacStep,
  macAllowLabel,
  readMacMarker,
  withoutMacMarker,
} from "@/lib/mac-runner-shared"
import {
  APPROVAL_WINDOW_MS,
  approvalMsLeft,
  describeToolCall,
  formatCountdown,
  MAC_APPROVAL_WINDOW_MS,
} from "@/lib/tool-summary"
import {
  buildActionSummarySentence,
  classifyToolKind,
  extractSearchQuery,
  extractToolCommand,
  extractToolPath,
  formatActionDuration,
} from "@/lib/chat-tool-presenter"
import type { ToolCallView } from "@/lib/types"

const URGENT_MS = 60_000

function useCountdown(createdAt: string, active: boolean, windowMs: number): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active])
  return active && now !== null ? approvalMsLeft(createdAt, now, windowMs) : null
}

/** Ticks once a second while work is in progress. */
function useNow(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active])
  return active ? now : null
}

function timeOf(iso: string | null): number | null {
  if (!iso) return null
  const value = Date.parse(iso)
  return Number.isFinite(value) ? value : null
}

/** Returns the icon corresponding to a tool action category. */
function ActionIcon({ kind, className }: { kind: string; className?: string }) {
  switch (kind) {
    case "command":
      return <Terminal className={className} />
    case "code-search":
      return <Search className={className} />
    case "search":
      return <Globe className={className} />
    case "read":
      return <FileText className={className} />
    case "edit":
      return <FileCode className={className} />
    default:
      return <Wrench className={className} />
  }
}

/**
 * A sleek collapsible action bar summarizing tool executions and reasoning.
 */
export function WorkedGroup({
  calls,
  thinking,
  thinkingStreaming = false,
  timestamp,
}: {
  calls: ToolCallView[]
  thinking?: string | null
  thinkingStreaming?: boolean
  timestamp?: string
}) {
  const panelId = useId()
  const hasRunning = calls.some((call) => call.status === "running")
  const isWorking = hasRunning || Boolean(thinkingStreaming)
  const [open, setOpen] = useState(isWorking)
  const [thoughtOpen, setThoughtOpen] = useState(true)
  const readerTouched = useRef(false)

  useEffect(() => {
    if (!readerTouched.current && isWorking) {
      setOpen(true)
    }
  }, [isWorking])

  const now = useNow(isWorking)
  const starts = calls.map((call) => timeOf(call.createdAt)).filter((v): v is number => v !== null)
  const ends = calls
    .map((call) => timeOf(call.resolvedAt) ?? timeOf(call.createdAt))
    .filter((v): v is number => v !== null)
  const startedAt = starts.length ? Math.min(...starts) : null
  const finishedAt = ends.length ? Math.max(...ends) : null
  const elapsed =
    startedAt === null
      ? null
      : isWorking
        ? Math.max(0, (now ?? Date.now()) - startedAt)
        : finishedAt === null
          ? null
          : Math.max(0, finishedAt - startedAt)

  const hasThinking = Boolean(thinking || thinkingStreaming)
  const { summary, hasFailure, failedCount } = buildActionSummarySentence(
    calls,
    hasThinking,
    Boolean(thinkingStreaming || hasRunning),
  )

  const durationStr = elapsed !== null ? formatActionDuration(elapsed) : ""
  const displayTime = timestamp ? clockTime(timestamp) : calls[0]?.createdAt ? clockTime(calls[0].createdAt) : null

  return (
    <div className="min-w-0 max-w-full my-2 space-y-1.5" data-testid="worked">
      {/* Top Status Line: Working for 47s / Worked for 3.5s > */}
      <div className="flex items-center gap-1.5 text-xs text-muted font-normal">
        <button
          type="button"
          data-testid="worked-group"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            readerTouched.current = true
            setOpen((v) => !v)
          }}
          className="inline-flex items-center gap-1.5 py-0.5 text-left text-faint transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500 rounded"
        >
          <span>
            {isWorking ? "Working" : "Worked"}
            {durationStr ? ` for ${durationStr}` : ""}
          </span>
          <ChevronRight
            className={cn("h-3 w-3 shrink-0 text-faint transition-transform duration-200", open && "rotate-90")}
          />
          {isWorking ? (
            <span className="inline-flex items-center gap-1 ml-1" aria-hidden="true">
              <span className="thinking-dot" />
              <span className="thinking-dot [animation-delay:150ms]" />
              <span className="thinking-dot [animation-delay:300ms]" />
            </span>
          ) : null}
        </button>
      </div>

      {/* Sleek Tool Summary Bar */}
      <div
        className={cn(
          "overflow-hidden rounded-lg border transition-all duration-200",
          hasFailure
            ? "border-danger/40 bg-danger/[0.04]"
            : "border-border/70 bg-panel/60 hover:border-line-strong",
        )}
      >
        <button
          type="button"
          onClick={() => {
            readerTouched.current = true
            setOpen((v) => !v)
          }}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-raised/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500 rounded"
        >
          <div className="flex min-w-0 items-center gap-2">
            <ActionIcon
              kind={calls[0] ? classifyToolKind(calls[0].toolName, calls[0].args) : "other"}
              className="h-3.5 w-3.5 shrink-0 text-muted"
            />
            <span className="truncate font-normal text-text">{summary}</span>
            {failedCount > 0 ? (
              <span className="shrink-0 text-2xs font-medium text-danger">· {failedCount} failed</span>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2 text-faint">
            {displayTime ? <span className="font-mono text-2xs">{displayTime}</span> : null}
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-90")}
            />
          </div>
        </button>

        {/* Expanded Steps List */}
        {open ? (
          <div id={panelId} className="border-t border-border/50 bg-ink/30 px-3 py-2.5 space-y-2">
            {/* Thought / Reasoning Block */}
            {hasThinking ? (
              <div className="rounded-md border border-border/40 bg-panel/40 p-2.5 text-xs">
                <button
                  type="button"
                  onClick={() => setThoughtOpen(!thoughtOpen)}
                  aria-expanded={thoughtOpen}
                  className="flex w-full items-center justify-between gap-2 text-left text-muted hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500 rounded"
                >
                  <div className="flex items-center gap-1.5 font-medium">
                    <Brain className="h-3.5 w-3.5 text-accent" />
                    <span>{thinkingStreaming ? "Thinking" : "Thought"}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-faint">
                    {displayTime ? <span className="font-mono text-2xs">{displayTime}</span> : null}
                    <ChevronRight
                      className={cn("h-3 w-3 transition-transform duration-200", thoughtOpen && "rotate-90")}
                    />
                  </div>
                </button>

                {thoughtOpen && thinking ? (
                  <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted pl-5 border-l border-border/50">
                    {thinking}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Individual Tool Call Steps */}
            {calls.map((call) => (
              <ToolCallRow key={call.id} call={call} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** A single tool step inside the expanded action group. */
export function ToolCallRow({ call, boxed = false }: { call: ToolCallView; boxed?: boolean }) {
  const [open, setOpen] = useState(false)
  const kind = classifyToolKind(call.toolName, call.args)
  const cmd = extractToolCommand(call.args)
  const searchQuery = extractSearchQuery(call.args)
  const filePath = extractToolPath(call.args)
  const resultText = call.result === null || call.result === undefined ? "" : pretty(call.result)

  let label = call.toolName
  if (readMacMarker(call.args)) {
    label = describeMacStep(call.toolName, call.args)
  } else if (kind === "command" && cmd) {
    label = `>_ ${cmd}`
  } else if (kind === "code-search") {
    label = searchQuery.target
      ? `Searched ${searchQuery.query || "code"} in ${searchQuery.target}`
      : `Searched ${searchQuery.query || "code"}`
  } else if (kind === "search") {
    label = searchQuery.query ? `Searched the web for "${searchQuery.query}"` : "Searched the web"
  } else if (kind === "read" && filePath) {
    label = `Read ${filePath}`
  } else if (kind === "edit" && filePath) {
    label = `Changed ${filePath}`
  }

  return (
    <div
      data-testid="tool-call"
      data-tool-call-id={call.id}
      data-status={call.status}
      className={cn("group/step rounded-md transition-colors", boxed && "border border-border/60 bg-panel/50 p-2")}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 py-1 text-left text-xs hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500 rounded"
      >
        <div className="flex min-w-0 items-center gap-2">
          <ActionIcon kind={kind} className="h-3 w-3 shrink-0 text-muted" />
          <span className="truncate font-mono text-2xs text-muted group-hover/step:text-text">{label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={call.status} className="rounded-full" />
          <span className="font-mono text-2xs text-faint">{clockTime(call.createdAt)}</span>
          <ChevronRight
            className={cn("h-3 w-3 text-faint transition-transform duration-200", open && "rotate-90")}
          />
        </div>
      </button>

      {open ? (
        <div className="mt-2 space-y-2 pl-5 text-2xs">
          {call.args && Object.keys(call.args).length > 0 ? (
            <div>
              <p className="mb-0.5 font-mono text-faint">arguments</p>
              <pre className="max-h-40 overflow-auto rounded border border-border/50 bg-ink p-2 font-mono leading-relaxed text-muted whitespace-pre-wrap">
                {pretty(withoutMacMarker(call.args))}
              </pre>
            </div>
          ) : null}

          {call.error ? (
            <div className="rounded border border-danger/30 bg-danger/[0.06] p-2 text-danger">
              {call.error}
            </div>
          ) : null}

          {call.liveOutput ? (
            <div>
              <div className="flex items-center justify-between">
                <p className="font-mono text-faint">
                  live output {call.status === "running" ? "· streaming…" : ""}
                </p>
                <CopyButton text={call.liveOutput} />
              </div>
              <pre
                data-testid="tool-live-output"
                className="mt-1 max-h-60 overflow-auto rounded border border-border/50 bg-ink p-2 font-mono leading-relaxed text-muted whitespace-pre-wrap"
              >
                {call.liveOutput}
              </pre>
            </div>
          ) : null}

          {resultText ? (
            <div>
              <div className="flex items-center justify-between">
                <p className="font-mono text-faint">result</p>
                <CopyButton text={resultText} />
              </div>
              <pre className="mt-1 max-h-60 overflow-auto rounded border border-border/50 bg-ink p-2 font-mono leading-relaxed text-muted whitespace-pre-wrap">
                {resultText}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Human-in-the-loop approval gate. */
export function ApprovalCard({
  call,
  orgSlug,
  canApprove,
  onResolved,
  agentName,
  viewerId,
}: {
  call: ToolCallView
  orgSlug: string
  canApprove: boolean
  onResolved?: () => void
  agentName?: string | null
  viewerId?: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const isPending = call.status === "pending_approval"
  const msLeft = useCountdown(
    call.createdAt,
    isPending,
    readMacMarker(call.args) ? MAC_APPROVAL_WINDOW_MS : APPROVAL_WINDOW_MS,
  )
  const expired = msLeft !== null && msLeft <= 0
  const mac = readMacMarker(call.args)
  const shownArgs = withoutMacMarker(call.args)
  const allowLabel = mac ? macAllowLabel(call.toolName, call.args) : null
  const mayDecide = mac
    ? viewerId && mac.ownerId
      ? viewerId === mac.ownerId
      : canApprove
    : canApprove

  function decide(decision: "approved" | "rejected", remember = false) {
    setError(null)
    startTransition(async () => {
      const result = await resolveToolCall({
        orgSlug,
        toolCallId: call.id,
        decision,
        remember,
      })
      if (!result.ok) setError(result.error ?? "Could not save your decision")
      else onResolved?.()
    })
  }

  return (
    <section
      aria-label={`Approval required for ${call.toolName}`}
      data-testid="approval-card"
      data-tool-call-id={call.id}
      data-status={call.status}
      className="rounded-lg border border-line border-l-2 border-l-[var(--color-accent)] bg-panel p-3"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
        <span className="font-mono text-xs text-accent">approval needed</span>
        {isPending ? null : <StatusBadge status={call.status} />}
        {isPending && msLeft !== null ? (
          <span
            className={cn(
              "ml-auto font-mono text-xs",
              expired ? "text-danger" : msLeft < URGENT_MS ? "text-warn" : "text-muted",
            )}
            title="An unanswered request is rejected automatically"
          >
            {expired ? "expired" : `${formatCountdown(msLeft)} left`}
          </span>
        ) : (
          <span className="ml-auto font-mono text-2xs text-faint">{clockTime(call.createdAt)}</span>
        )}
      </div>

      <div className="space-y-3 pt-2">
        <p className="text-xs leading-relaxed text-text">
          {mac
            ? `${agentName ?? "The agent"} wants to: ${describeMacStep(call.toolName, call.args)}`
            : describeToolCall({ toolName: call.toolName, input: call.args, agentName })}
        </p>
        <div>
          <p className="mb-1 font-mono text-2xs text-faint">
            exact request · <span className="text-muted">{call.toolName}</span>
          </p>
          <pre className="max-h-40 overflow-auto rounded border border-line bg-ink p-2 font-mono text-2xs leading-relaxed text-muted">
            {pretty(shownArgs)}
          </pre>
        </div>

        {isPending ? (
          expired ? (
            <p className="font-mono text-xs text-muted">This request timed out and was rejected.</p>
          ) : mayDecide ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                data-testid="approve-tool"
                disabled={pending}
                onClick={() => decide("approved")}
              >
                <CheckIcon width={14} height={14} />
                {pending ? "Saving…" : mac ? "Allow" : "Approve"}
              </Button>
              {allowLabel ? (
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="always-allow-tool"
                  disabled={pending}
                  onClick={() => decide("approved", true)}
                >
                  {allowLabel}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="danger"
                data-testid="reject-tool"
                disabled={pending}
                onClick={() => decide("rejected")}
              >
                <CloseIcon width={14} height={14} />
                {mac ? "Deny" : "Reject"}
              </Button>
            </div>
          ) : (
            <p className="font-mono text-xs text-warn">
              {mac
                ? `Waiting for the owner of ${mac.hostName} to decide.`
                : "Waiting for a room or workspace admin to decide."}
            </p>
          )
        ) : (
          <p className="font-mono text-xs text-muted">
            decision: {call.status}
            {call.resolvedAt ? ` · ${clockTime(call.resolvedAt)}` : ""}
          </p>
        )}

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  )
}

/**
 * Renders tool calls: pending approvals on top, completed actions in a sleek folded bar.
 */
export function ToolCallsList({
  calls,
  orgSlug,
  canApprove,
  agentName,
  viewerId,
  thinking,
  thinkingStreaming = false,
  grouped = true,
  timestamp,
}: {
  calls: ToolCallView[]
  orgSlug: string
  canApprove: boolean
  agentName?: string | null
  viewerId?: string | null
  thinking?: string | null
  thinkingStreaming?: boolean
  grouped?: boolean
  timestamp?: string
}) {
  const waiting = calls.filter((call) => call.status === "pending_approval")
  const rest = calls.filter((call) => call.status !== "pending_approval")
  const hasThinking = Boolean(thinking || thinkingStreaming)
  if (!waiting.length && !rest.length && !hasThinking) return null

  return (
    <div className="mt-2 min-w-0 max-w-full space-y-2">
      {waiting.map((call) => (
        <ApprovalCard
          key={call.id}
          call={call}
          orgSlug={orgSlug}
          canApprove={canApprove}
          agentName={agentName}
          viewerId={viewerId}
        />
      ))}
      {grouped ? (
        rest.length || hasThinking ? (
          <WorkedGroup
            calls={rest}
            thinking={thinking}
            thinkingStreaming={thinkingStreaming}
            timestamp={timestamp}
          />
        ) : null
      ) : (
        rest.map((call) => <ToolCallRow key={call.id} call={call} boxed />)
      )}
    </div>
  )
}
