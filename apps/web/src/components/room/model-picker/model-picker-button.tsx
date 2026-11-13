"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { ProviderIcon } from "./provider-icons"
import { ModelPickerDropdown } from "./model-picker-dropdown"
import { ManageAccountsModal } from "./manage-accounts-modal"
import { DEFAULT_MODEL_CONFIG, getStoredModelSelection } from "@/lib/connectors/registry"
import type { SelectedModelConfig } from "@/lib/connectors/types"
import { cn } from "@/lib/format"

export function ModelPickerButton({
  className = "",
  variant = "pill",
}: {
  className?: string
  /** "titlebar" is the quieter square-cornered button in the workspace title bar. */
  variant?: "pill" | "titlebar"
}) {
  const [open, setOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [config, setConfig] = useState<SelectedModelConfig>(DEFAULT_MODEL_CONFIG)

  useEffect(() => {
    setConfig(getStoredModelSelection())

    function handleModelChanged(event: Event) {
      const customEvent = event as CustomEvent<SelectedModelConfig>
      if (customEvent.detail) {
        setConfig(customEvent.detail)
      }
    }

    window.addEventListener("saaya:model-changed", handleModelChanged)
    return () => window.removeEventListener("saaya:model-changed", handleModelChanged)
  }, [])

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Model: ${config.modelLabel}`}
        className={cn(
          "flex items-center gap-2 text-[13.5px] font-medium text-text transition-colors",
          variant === "titlebar"
            ? "h-9 rounded-xl px-3 hover:bg-panel aria-expanded:bg-panel"
            : "h-10 rounded-full bg-panel px-3.5 text-[13px] hover:bg-raised",
        )}
      >
        <ProviderIcon
          provider={config.provider}
          size={variant === "titlebar" ? 16 : 13}
          className={variant === "titlebar" ? "text-text" : "text-[#ff7a45]"}
        />
        <span className="max-w-[150px] truncate">{config.modelLabel}</span>
        {variant === "titlebar" && open ? (
          <ChevronUp className="h-3.5 w-3.5 text-faint" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-faint" aria-hidden="true" />
        )}
      </button>

      {/* Floating Dropdown Popover */}
      {open && (
        <ModelPickerDropdown
          currentModel={config}
          onSelectModel={(next) => setConfig(next)}
          onOpenManageAccounts={() => setModalOpen(true)}
          onClose={() => setOpen(false)}
        />
      )}

      {/* Manage AI Accounts Modal */}
      <ManageAccountsModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onAccountsUpdated={() => {
          setConfig(getStoredModelSelection())
        }}
      />
    </div>
  )
}
