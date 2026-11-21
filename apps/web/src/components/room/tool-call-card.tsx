"use client"

import { useEffect, useId, useRef, useState, useTransition } from "react"
import { ChevronRight } from "lucide-react"
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
import type { ToolCallView } from "@/lib/types"

const URGENT_MS = 60_000
/** Below this, a duration is noise: half a second of work still reads as "Worked". */
const MIN_REPORTED_MS = 5_000

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

/** Ticks once a second while work is in progress, so "Working for 40 sec" stays true. */
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

/** 43_000 → "43 sec", 132_000 → "2 min", 3_900_000 → "1 hr 5 min". */
function workedDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${Math.max(seconds, 1)} sec`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}

function timeOf(iso: string | null): number | null {
  if (!iso) return null
  const value = Date.parse(iso)
  return Number.isFinite(value) ? value : null
}

/** Every step of one reply, folded into a single quiet line the reader can open. */
function WorkedGroup({
  calls,
  thinking,
  thinkingStreaming = false,
}: {
  calls: ToolCallView[]
  thinking?: string | null
  thinkingStreaming?: boolean
}) {
  const panelId = useId()
  const running = calls.some((call) => call.status === "running")
  const [open, setOpen] = useState(running)
  // Opening and closing follow the work itself until the reader takes over.
  const readerTouched = useRef(false)
  useEffect(() => {
    if (!readerTouched.current) setOpen(running)
  }, [running])

  const now = useNow(running)
  const starts = calls.map((call) => timeOf(call.createdAt)).filter((value) => value !== null)
  const ends = calls
    .map((call) => timeOf(call.resolvedAt) ?? timeOf(call.createdAt))
    .filter((value) => value !== null)
  const startedAt = starts.length ? Math.min(...starts) : null
  const finishedAt = ends.length ? Math.max(...ends) : null
  const elapsed =
    startedAt === null
      ? null
      : running
        ? Math.max(0, (now ?? Date.now()) - startedAt)
        : finishedAt === null
          ? null
          : Math.max(0, finishedAt - startedAt)

  const failed = calls.filter((call) => call.status === "error").length
  const label = !calls.length
    ? thinkingStreaming
      ? "Thinking"
      : "Thought"
    : running
      ? "Working"
      : "Worked"
  const duration = elapsed !== null && elapsed >= MIN_REPORTED_MS ? workedDuration(elapsed) : null

  return (
    <div className="min-w-0 max-w-full" data-testid="worked">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="worked-group"
        onClick={() => {
          readerTouched.current = true
          setOpen((value) => !value)
        }}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[13px] text-faint transition-colors hover:text-text"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-90")}
        />
        <span className="shrink-0">
          {label}
          {duration ? ` for ${duration}` : ""}
        </span>
        {calls.length ? (
          <span className="shrink-0 text-[11px] text-faint/80">
            · {calls.length} {calls.length === 1 ? "step" : "steps"}
          </span>
        ) : null}
        {failed ? (
          <span className="shrink-0 text-[11px] text-danger">· {failed} failed</span>
        ) : null}
        {running ? (
          <span className="inline-flex items-center gap-1" aria-hidden="true">
            <span className="thinking-dot" />
            <span className="thinking-dot [animation-delay:150ms]" />
            <span className="thinking-dot [animation-delay:300ms]" />
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Steps"
          className="mt-1.5 min-w-0 space-y-0.5 border-l border-line pl-2"
        >
          {thinking ? (
            <div className="pb-1.5">
              <p className="font-mono text-[11px] text-faint">thinking</p>
              <div className="mt-0.5 max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted">
                {thinking}
              </div>
            </div>
          ) : null}
          {calls.map((call) => (
            <ToolCallRow key={call.id} call={call} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

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
  /** The signed-in person; a step on someone's Mac is only theirs to answer. */
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
      className="rounded-sm border border-line border-l-2 border-l-[var(--color-accent)] bg-panel"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <span className="font-mono text-[12px] text-accent">approval needed</span>
        {isPending ? null : <StatusBadge status={call.status} />}
        {isPending && msLeft !== null ? (
          <span
            className={cn(
              "ml-auto font-mono text-[12px]",
              expired ? "text-danger" : msLeft < URGENT_MS ? "text-warn" : "text-muted",
            )}
            title="An unanswered request is rejected automatically"
          >
            {expired ? "expired" : `${formatCountdown(msLeft)} left`}
          </span>
        ) : (
          <span className="ml-auto font-mono text-[11px] text-faint">
            {clockTime(call.createdAt)}
          </span>
        )}
      </div>
      <div className="space-y-3 px-3 py-3">
        <p className="text-[13px] leading-relaxed text-text">
          {mac
            ? `${agentName ?? "The agent"} wants to: ${describeMacStep(call.toolName, call.args)}`
            : describeToolCall({ toolName: call.toolName, input: call.args, agentName })}
        </p>
        <div>
          <p className="mb-1 font-mono text-[11px] text-faint">
            exact request · <span className="text-muted">{call.toolName}</span>
          </p>
          <pre className="max-h-44 overflow-auto rounded-sm border border-line bg-ink p-2 font-mono text-[12px] leading-relaxed text-muted">
            {pretty(shownArgs)}
          </pre>
        </div>
        {isPending ? (
          expired ? (
            <p className="font-mono text-[12px] text-muted">
              This request timed out and was rejected.
            </p>
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
            <p className="font-mono text-[12px] text-warn">
              {mac
                ? `Waiting for the owner of ${mac.hostName} to decide.`
                : "Waiting for a room or workspace admin to decide."}
            </p>
          )
        ) : (
          <p className="font-mono text-[12px] text-muted">
            decision: {call.status}
            {call.resolvedAt ? ` · ${clockTime(call.resolvedAt)}` : ""}
          </p>
        )}
        {error ? (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  )
}

/** One step inside a worked group: the name and outcome on the line, the detail on a click. */
function ToolCallRow({ call, boxed = false }: { call: ToolCallView; boxed?: boolean }) {
  const resultText = call.result === null || call.result === undefined ? "" : pretty(call.result)
  return (
    <details
      className={cn("group/step min-w-0 rounded-md", boxed && "border border-line bg-panel/60")}
      data-testid="tool-call"
      data-tool-call-id={call.id}
      data-status={call.status}
    >
      <summary
        className={cn(
          "flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-md px-1.5 py-1 hover:bg-raised/70 md:py-0.5",
          boxed && "px-3 py-2 md:py-1.5",
        )}
      >
        {readMacMarker(call.args) ? (
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">
            {describeMacStep(call.toolName, call.args)}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted group-hover/step:text-text">
            {call.toolName}
          </span>
        )}
        <span className="flex shrink-0 items-center gap-2">
          <StatusBadge status={call.status} className="rounded-full" />
          <span className="font-mono text-[11px] text-faint">{clockTime(call.createdAt)}</span>
        </span>
      </summary>
      <div className={cn("pb-2 pt-1", boxed ? "px-3" : "pl-1.5")}>
        <p className="mb-1 font-mono text-[11px] text-faint">arguments</p>
        <pre className="max-h-40 overflow-auto rounded-sm border border-line bg-ink p-2 font-mono text-[12px] leading-relaxed text-muted">
          {pretty(withoutMacMarker(call.args))}
        </pre>
        {call.error ? (
          <p role="alert" className="mt-2 text-[12px] text-danger">
            {call.error}
          </p>
        ) : null}
        {call.liveOutput ? (
          <div className="mt-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] text-faint">
                live output {call.status === "running" ? "· streaming…" : ""}
              </p>
              <CopyButton text={call.liveOutput} />
            </div>
            <pre
              data-testid="tool-live-output"
              className="mt-1 max-h-64 overflow-auto rounded-sm border border-line bg-ink p-2 font-mono text-[12px] leading-relaxed text-muted whitespace-pre-wrap"
            >
              {call.liveOutput}
            </pre>
          </div>
        ) : null}
        {resultText ? (
          <>
            <div className="mt-3 flex items-center justify-between">
              <p className="font-mono text-[11px] text-faint">result</p>
              <CopyButton text={resultText} />
            </div>
            <pre className="mt-1 max-h-64 overflow-auto rounded-sm border border-line bg-ink p-2 font-mono text-[12px] leading-relaxed text-muted">
              {resultText}
            </pre>
          </>
        ) : null}
      </div>
    </details>
  )
}

/**
 * A reply's steps. Anything waiting on a person stays a card of its own; everything else folds
 * into one "Worked for 2 min" line so the answer is what a reader sees first.
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
}: {
  calls: ToolCallView[]
  orgSlug: string
  canApprove: boolean
  agentName?: string | null
  viewerId?: string | null
  /** Reasoning folded out of the reply; it opens with the steps. */
  thinking?: string | null
  thinkingStreaming?: boolean
  /** One group per reply in the chat; `false` lists every step on its own (activity panel). */
  grouped?: boolean
}) {
  const waiting = calls.filter((call) => call.status === "pending_approval")
  const rest = calls.filter((call) => call.status !== "pending_approval")
  const hasThinking = Boolean(thinking || thinkingStreaming)
  if (!waiting.length && !rest.length && !hasThinking) return null
  return (
    <div className="mt-3 min-w-0 max-w-full space-y-2">
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
          <WorkedGroup calls={rest} thinking={thinking} thinkingStreaming={thinkingStreaming} />
        ) : null
      ) : (
        rest.map((call) => <ToolCallRow key={call.id} call={call} boxed />)
      )}
    </div>
  )
}
