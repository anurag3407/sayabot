"use client"

import { useState } from "react"
import { TraceIcon } from "@/components/ui/icons"
import { RunInspectorDrawer } from "./run-inspector-drawer"
import { cn } from "@/lib/format"

export interface InspectTraceButtonProps {
  orgSlug: string
  runId?: string | null
  messageId?: string | null
  agentName?: string | null
  label?: string
  className?: string
  variant?: "ghost" | "outline" | "danger"
  size?: "sm" | "xs"
}

export function InspectTraceButton({
  orgSlug,
  runId,
  messageId,
  agentName,
  label = "Inspect",
  className,
  variant = "ghost",
  size = "xs",
}: InspectTraceButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded transition-colors font-mono select-none",
          size === "xs" ? "h-6 px-1.5 text-[11px]" : "h-7 px-2 text-[12px]",
          variant === "ghost" && "text-faint hover:text-text hover:bg-panel",
          variant === "outline" && "border border-line bg-panel text-muted hover:text-text hover:bg-raised",
          variant === "danger" && "border border-danger/30 bg-danger/10 text-danger hover:bg-danger/20",
          className,
        )}
        title="Inspect run steps, latency, tokens & subagents"
      >
        <TraceIcon width={12} height={12} />
        <span>{label}</span>
      </button>

      <RunInspectorDrawer
        open={open}
        onClose={() => setOpen(false)}
        orgSlug={orgSlug}
        runId={runId}
        messageId={messageId}
        agentName={agentName}
      />
    </>
  )
}
