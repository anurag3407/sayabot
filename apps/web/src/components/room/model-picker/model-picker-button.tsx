"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { GroupIcon, ModelPickerDropdown } from "./model-picker-dropdown"
import {
  AUTO_SELECTION,
  MODEL_SELECTION_EVENT,
  readModelSelection,
  saveModelSelection,
  type ModelSelection,
} from "@/lib/model-selection"
import { cn } from "@/lib/format"

export function ModelPickerButton({
  orgSlug,
  className = "",
  variant = "pill",
}: {
  orgSlug: string
  className?: string
  /** "titlebar" is the quieter square-cornered button in the workspace title bar. */
  variant?: "pill" | "titlebar"
}) {
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState<ModelSelection>(AUTO_SELECTION)

  useEffect(() => {
    setSelection(readModelSelection(orgSlug))
    function onChanged(event: Event) {
      const detail = (event as CustomEvent<{ orgSlug: string; selection: ModelSelection }>).detail
      if (detail?.orgSlug === orgSlug) setSelection(detail.selection)
    }
    window.addEventListener(MODEL_SELECTION_EVENT, onChanged)
    return () => window.removeEventListener(MODEL_SELECTION_EVENT, onChanged)
  }, [orgSlug])

  return (
    <div className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Model: ${selection.label}`}
        className={cn(
          "flex items-center gap-2 text-[13.5px] font-medium text-text transition-colors",
          variant === "titlebar"
            ? "h-9 rounded-xl px-3 hover:bg-panel aria-expanded:bg-panel"
            : "h-10 rounded-full bg-panel px-3.5 text-[13px] hover:bg-raised",
        )}
      >
        <GroupIcon provider={selection.provider} size={16} />
        <span className="max-w-[150px] truncate">{selection.label}</span>
        {variant === "titlebar" && open ? (
          <ChevronUp className="h-3.5 w-3.5 text-faint" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-faint" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <ModelPickerDropdown
          orgSlug={orgSlug}
          selection={selection}
          onSelect={(next) => {
            setSelection(next)
            saveModelSelection(orgSlug, next)
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}
