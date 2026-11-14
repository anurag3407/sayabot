"use client"

import { useEffect, useState, useTransition } from "react"
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
import { approvalMsLeft, describeToolCall, formatCountdown } from "@/lib/tool-summary"
import type { ToolCallView } from "@/lib/types"

const URGENT_MS = 60_000

function useCountdown(createdAt: string, active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active])
  return active && now !== null ? approvalMsLeft(createdAt, now) : null
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
  const msLeft = useCountdown(call.createdAt, isPending)
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

export function ToolCallCard({ call }: { call: ToolCallView }) {
  const resultText = call.result === null || call.result === undefined ? "" : pretty(call.result)
  return (
    <details
      className="group rounded-sm border border-line bg-panel/60"
      data-testid="tool-call"
      data-tool-call-id={call.id}
      data-status={call.status}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 hover:bg-raised md:py-1.5">
        {readMacMarker(call.args) ? (
          <span className="min-w-0 truncate text-[12.5px] text-text">
            {describeMacStep(call.toolName, call.args)}
          </span>
        ) : (
          <span className="font-mono text-[12px] text-text">{call.toolName}</span>
        )}
        <StatusBadge status={call.status} />
        <span className="ml-auto font-mono text-[11px] text-faint">
          {clockTime(call.createdAt)}
        </span>
      </summary>
      <div className="border-t border-line px-3 py-2.5">
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

export function ToolCallsList({
  calls,
  orgSlug,
  canApprove,
  agentName,
  viewerId,
}: {
  calls: ToolCallView[]
  orgSlug: string
  canApprove: boolean
  agentName?: string | null
  viewerId?: string | null
}) {
  if (!calls.length) return null
  return (
    <div className="mt-3 space-y-2">
      {calls.map((call) =>
        call.status === "pending_approval" ? (
          <ApprovalCard
            key={call.id}
            call={call}
            orgSlug={orgSlug}
            canApprove={canApprove}
            agentName={agentName}
            viewerId={viewerId}
          />
        ) : (
          <ToolCallCard key={call.id} call={call} />
        ),
      )}
    </div>
  )
}
