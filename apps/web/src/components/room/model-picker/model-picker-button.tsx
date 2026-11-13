"use client"

import { useEffect, useState } from "react"
import { ChevronDown } from "lucide-react"
import { ProviderIcon } from "./provider-icons"
import { ModelPickerDropdown } from "./model-picker-dropdown"
import { ManageAccountsModal } from "./manage-accounts-modal"
import { DEFAULT_MODEL_CONFIG, getStoredModelSelection } from "@/lib/connectors/registry"
import type { SelectedModelConfig } from "@/lib/connectors/types"

export function ModelPickerButton({ className = "" }: { className?: string }) {
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
        className="flex h-10 items-center gap-2 rounded-full bg-panel px-3.5 text-[13px] font-medium text-text transition-colors hover:bg-raised"
      >
        <ProviderIcon provider={config.provider} size={13} className="text-[#ff7a45]" />
        <span className="max-w-[150px] truncate">{config.modelLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 text-faint" aria-hidden="true" />
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
