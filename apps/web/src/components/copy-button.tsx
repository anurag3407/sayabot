"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "@/components/ui/icons"
import { cn } from "@/lib/format"

export function CopyButton({
  text,
  label = "copy",
  className,
}: {
  text: string
  label?: string
  className?: string
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setState("copied")
      window.setTimeout(() => setState("idle"), 1_500)
    } catch {
      setState("failed")
      window.setTimeout(() => setState("idle"), 2_000)
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[11px] text-faint transition-colors hover:text-text",
        className,
      )}
      aria-live="polite"
    >
      {state === "copied" ? (
        <CheckIcon width={12} height={12} />
      ) : (
        <CopyIcon width={12} height={12} />
      )}
      {state === "copied" ? "copied" : state === "failed" ? "copy failed" : label}
    </button>
  )
}
