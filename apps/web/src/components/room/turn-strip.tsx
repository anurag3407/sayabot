"use client"

import { useState, useTransition } from "react"
import { stopGeneration } from "@/lib/actions/messages"
import { Button } from "@/components/ui/button"
import { StopIcon } from "@/components/ui/icons"
import { Mascot } from "@/components/ui/mascot"
import type { RoomAgentView, TurnStateView } from "@/lib/types"

export function TurnStrip({
  turnState,
  agents,
  streamingRunId,
  orgSlug,
  roomId,
  runActivity,
}: {
  turnState: TurnStateView | null
  agents: RoomAgentView[]
  streamingRunId: string | null
  orgSlug: string
  roomId: string
  runActivity?: {
    runId: string
    step?: number
    label?: string
    status?: string
    plan?: Array<{ id: string; title: string; status: string; note?: string }>
  } | null
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const byId = new Map(agents.map(({ agent }) => [agent.id, agent]))
  const active = turnState?.activeAgentId ? byId.get(turnState.activeAgentId) : null
  const queue = (turnState?.queue ?? []).map((id) => byId.get(id)).filter(Boolean)
  const visible = Boolean(turnState?.activeAgentId) || queue.length > 0 || Boolean(streamingRunId) || Boolean(runActivity)
  if (!visible) return null

  function stop() {
    if (!streamingRunId) return
    setError(null)
    startTransition(async () => {
      const result = await stopGeneration({ orgSlug, roomId, runId: streamingRunId })
      if (!result.ok) setError(result.error ?? "Could not stop the agent")
    })
  }

  const completedPlanItems = runActivity?.plan ? runActivity.plan.filter((i) => i.status === "done").length : 0

  return (
    <div
      className="mx-auto flex w-full max-w-[780px] flex-wrap items-center gap-x-2.5 gap-y-1 px-5 py-1.5 md:px-6"
      aria-label="Agent activity"
    >
      {active ? (
        <Mascot seed={active.displayName} mood="busy" lit className="h-6 w-6 shrink-0" />
      ) : null}
      <span className="text-[13px] text-text">
        {active ? active.displayName : streamingRunId ? "Your agent" : "Your agent"}
        <span className="text-muted"> is working on it</span>
      </span>
      {runActivity?.label || runActivity?.status ? (
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
          <span className="truncate">{runActivity.label ?? runActivity.status}</span>
        </span>
      ) : null}
      {runActivity?.plan && runActivity.plan.length > 0 ? (
        <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] text-faint">
          {completedPlanItems} of {runActivity.plan.length} done
        </span>
      ) : null}
      {queue.length ? (
        <span className="text-[12px] text-faint">
          then {queue.map((agent) => agent!.displayName).join(", ")}
        </span>
      ) : null}
      {streamingRunId ? (
        <Button
          size="sm"
          variant="outline"
          className="ml-auto rounded-full md:h-7 md:px-3 md:text-[12px]"
          onClick={stop}
          disabled={pending}
        >
          <StopIcon width={11} height={11} />
          {pending ? "Stopping…" : "Stop"}
        </Button>
      ) : null}
      {error ? (
        <span role="alert" className="w-full text-[12px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  )
}
