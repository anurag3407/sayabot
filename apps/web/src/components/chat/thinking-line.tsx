"use client"

import { useId, useState } from "react"
import { cn } from "@/lib/format"

/**
 * One quiet line above an agent reply. The reasoning stays folded until the line is clicked,
 * the same way Claude shows a thought you can open.
 */
export function ThinkingLine({
  text,
  streaming = false,
}: {
  text: string
  /** The model is still writing this thought. */
  streaming?: boolean
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const label = streaming ? "Thinking" : "Thought"

  return (
    <div className="mb-1.5 min-w-0 max-w-full">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[13px] text-faint hover:text-muted"
      >
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          aria-hidden="true"
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        >
          <path
            d="M6 3.5 11 8 6 12.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{label}</span>
        {streaming ? (
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
          aria-label={label}
          className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap break-words border-l border-line pl-3 text-[13px] leading-relaxed text-muted"
        >
          {text || (streaming ? "…" : "")}
        </div>
      ) : null}
    </div>
  )
}
