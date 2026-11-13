"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { GroupIcon, ModelPickerDropdown } from "./model-picker-dropdown"
import { ManageAccountsModal } from "./manage-accounts-modal"
import {
  AUTO_SELECTION,
  MODEL_SELECTION_EVENT,
  readModelSelection,
  saveModelSelection,
  type ModelSelection,
} from "@/lib/model-selection"
import { cn } from "@/lib/format"

/** What the old browser-only accounts dialog left behind, a real OpenRouter key among it. */
const LEGACY_KEYS = [
  "saaya:openrouter-key",
  "saaya:openrouter-tier",
  "saaya:openrouter_code_verifier",
  "saaya:chatgpt-plan",
  "saaya:chatgpt_code_verifier",
  "saaya:copilot-plan",
  "saaya:opencode-sub",
  "saaya:deepseek-sub",
  "saaya:minimax-sub",
  "saaya:grok-sub",
  "saaya:kimi-sub",
  "saaya:qwen-sub",
  "saaya:cursor-sub",
  "saaya:model-selection",
]

function forgetLegacyAccounts() {
  try {
    for (const key of LEGACY_KEYS) {
      window.localStorage.removeItem(key)
      window.sessionStorage.removeItem(key)
    }
  } catch {
    // Storage blocked: nothing was saved there either.
  }
}

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
  const [accounts, setAccounts] = useState<{ open: boolean; provider?: string }>({ open: false })
  const [selection, setSelection] = useState<ModelSelection>(AUTO_SELECTION)

  useEffect(() => {
    forgetLegacyAccounts()
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
          onManageAccounts={(provider) => setAccounts({ open: true, provider })}
          onClose={() => setOpen(false)}
        />
      ) : null}

      <ManageAccountsModal
        orgSlug={orgSlug}
        isOpen={accounts.open}
        initialProvider={accounts.provider}
        onClose={() => setAccounts({ open: false })}
      />
    </div>
  )
}
