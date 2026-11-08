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
      {/* The Sleek Model Pill Button matching the screenshot */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-8 items-center gap-2 rounded-full border border-[#232b25] bg-[#151b17] px-3 text-xs font-medium text-[#e9e5d8] transition-colors hover:border-[#354037] hover:bg-[#1a211c] focus:outline-none"
      >
        <ProviderIcon provider={config.provider} size={13} className="text-[#ff7a45]" />
        <span className="max-w-[150px] truncate">{config.modelLabel}</span>
        <ChevronDown className="h-3 w-3 text-[#7a857c]" aria-hidden="true" />
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
