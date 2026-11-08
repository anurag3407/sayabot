"use client"

import { useState, useTransition } from "react"
import { stopGeneration } from "@/lib/actions/messages"
import { Button } from "@/components/ui/button"
import { StopIcon } from "@/components/ui/icons"
import { cn } from "@/lib/format"
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
      className="mx-auto flex w-full max-w-[820px] flex-wrap items-center gap-x-3 gap-y-1 px-5 py-1.5"
      aria-label="Agent activity"
    >
      <span className="text-[12px] text-accent">Replying</span>
      <span className={cn("text-[12px]", active || streamingRunId ? "text-text" : "text-faint")}>
        {active ? `@${active.handle}` : streamingRunId ? "an agent" : "next agent starting"}
      </span>
      {runActivity?.label || runActivity?.status ? (
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          {runActivity.step ? `step ${runActivity.step} · ` : ""}
          {runActivity.label ?? runActivity.status}
        </span>
      ) : null}
      {runActivity?.plan && runActivity.plan.length > 0 ? (
        <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] text-faint">
          plan {completedPlanItems}/{runActivity.plan.length}
        </span>
      ) : null}
      {queue.length ? (
        <>
          <span className="text-[12px] text-faint">Up next</span>
          <span className="flex flex-wrap gap-1.5">
            {queue.map((agent) => (
              <span key={agent!.id} className="font-mono text-[12px] text-muted">
                @{agent!.handle}
              </span>
            ))}
          </span>
        </>
      ) : null}
      {streamingRunId ? (
        <Button
          size="sm"
          variant="outline"
          className="ml-auto md:h-6 md:px-2 md:text-[12px]"
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
