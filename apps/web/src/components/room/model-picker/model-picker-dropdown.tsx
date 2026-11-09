"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, ChevronRight, ChevronUp, Loader2, Search, Settings, X } from "lucide-react"
import { ProviderIcon } from "./provider-icons"
import type { ModelOption, SelectedModelConfig, ThinkingEffort } from "@/lib/connectors/types"
import {
  DEFAULT_MODEL_CONFIG,
  getAllGroupedModels,
  saveStoredModelSelection,
  saveStoredThinkingEffort,
} from "@/lib/connectors/registry"
import type { ProviderGroupData } from "@/lib/connectors/registry"

interface ModelPickerDropdownProps {
  currentModel?: SelectedModelConfig
  onSelectModel?: (config: SelectedModelConfig) => void
  onOpenManageAccounts: () => void
  onClose: () => void
}

const THINKING_LEVELS: { id: ThinkingEffort; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "x-high", label: "X-High" },
  { id: "max", label: "Max" },
]

export function ModelPickerDropdown({
  currentModel = DEFAULT_MODEL_CONFIG,
  onSelectModel,
  onOpenManageAccounts,
  onClose,
}: ModelPickerDropdownProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [groups, setGroups] = useState<ProviderGroupData[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<SelectedModelConfig>(currentModel)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelected(currentModel)
  }, [currentModel])

  // Load models from API or registry
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const savedKey =
          typeof window !== "undefined" ? window.localStorage.getItem("saaya:openrouter-key") : null
        const res = await fetch("/api/connectors/models", {
          headers: savedKey ? { "x-openrouter-key": savedKey } : undefined,
        })
        if (!res.ok) throw new Error("Failed to fetch")
        const data = (await res.json()) as { groups: ProviderGroupData[] }
        if (!cancelled && Array.isArray(data.groups)) {
          setGroups(data.groups)
        }
      } catch {
        if (!cancelled) {
          const fallback = await getAllGroupedModels()
          setGroups(fallback.groups)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Close on outside click
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    window.addEventListener("pointerdown", handlePointerDown)
    return () => window.removeEventListener("pointerdown", handlePointerDown)
  }, [onClose])

  const toggleGroupExpand = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }))
  }

  const handlePickModel = (group: ProviderGroupData, model: ModelOption) => {
    const nextConfig: SelectedModelConfig = {
      instanceId: group.id,
      modelId: model.id,
      modelLabel: model.label,
      provider: model.provider,
      providerGroup: group.label,
      thinkingEffort: selected.thinkingEffort,
    }
    setSelected(nextConfig)
    saveStoredModelSelection(nextConfig)
    onSelectModel?.(nextConfig)
    onClose()
  }

  const handlePickThinking = (effort?: ThinkingEffort) => {
    const nextConfig: SelectedModelConfig = {
      ...selected,
      thinkingEffort: effort,
    }
    setSelected(nextConfig)
    saveStoredThinkingEffort(effort)
    onSelectModel?.(nextConfig)
  }

  // Filter groups and models based on search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groups
    const q = searchQuery.toLowerCase().trim()

    return groups
      .map((group) => {
        const matchingModels = group.models.filter(
          (m) =>
            m.label.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q) ||
            group.label.toLowerCase().includes(q),
        )
        return {
          ...group,
          models: matchingModels,
        }
      })
      .filter((group) => group.models.length > 0)
  }, [groups, searchQuery])

  return (
    <div
      ref={dropdownRef}
      className="absolute top-full right-0 z-50 mt-1.5 flex w-[320px] max-h-[580px] flex-col overflow-hidden rounded-2xl border border-[#232b25] bg-[#101411] text-[#e9e5d8] shadow-2xl backdrop-blur-md"
      role="menu"
      aria-label="Model selector"
    >
      {/* 1. Search Bar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[#232b25] px-3.5">
        <Search className="h-4 w-4 shrink-0 text-[#7a857c]" aria-hidden="true" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search models"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[#e9e5d8] outline-none placeholder:text-[#7a857c]"
          autoFocus
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="flex h-5 w-5 items-center justify-center rounded-full text-[#7a857c] hover:bg-[#1a211c] hover:text-[#e9e5d8]"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* 2. Scrollable Models List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-1">
        {/* Current Active Model */}
        <div
          onClick={() => onClose()}
          className="group flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 hover:bg-[#1a211c] transition-colors"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1a211c] text-[#ff7a45]">
              <ProviderIcon provider={selected.provider} size={14} />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium text-[#e9e5d8]">
                {selected.modelLabel}
              </span>
              <span className="truncate text-[11px] text-[#7a857c]">
                Saaya's model
              </span>
            </div>
          </div>
          <Check className="h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
        </div>

        <div className="my-1 h-[1px] bg-[#232b25]" />

        {/* Loading Indicator */}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-[#7a857c]">
            <Loader2 className="h-4 w-4 animate-spin text-[#ff7a45]" />
            Loading catalog...
          </div>
        )}

        {/* Groups */}
        {!loading &&
          filteredGroups.map((group) => {
            const isExpanded = Boolean(expandedGroups[group.id]) || Boolean(searchQuery.trim())
            // Show top 4 models by default unless expanded or searching
            const displayModels = isExpanded ? group.models : group.models.slice(0, 4)

            return (
              <div key={group.id} className="space-y-0.5 pt-1">
                {/* Group Header */}
                <div className="flex items-center gap-2 px-2.5 py-1 text-[11px] font-medium text-[#7a857c]">
                  <ProviderIcon provider={group.provider} size={13} className="text-[#9aa39b]" />
                  <span className="truncate">{group.label}</span>
                </div>

                {/* Models Rows */}
                {displayModels.map((m) => {
                  const isCurrent = selected.modelId === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handlePickModel(group, m)}
                      className={`group flex w-full cursor-pointer items-center justify-between rounded-xl px-2.5 py-1.5 text-left transition-colors ${
                        isCurrent ? "bg-[#1a211c]" : "hover:bg-[#151b17]"
                      }`}
                    >
                      <div className="flex min-w-0 flex-col pl-6">
                        <span
                          className={`truncate text-[13px] ${
                            isCurrent ? "font-medium text-[#e9e5d8]" : "text-[#9aa39b] group-hover:text-[#e9e5d8]"
                          }`}
                        >
                          {m.label}
                        </span>
                        {m.route && (
                          <span className="text-[10px] text-[#7a857c]">{m.route}</span>
                        )}
                      </div>
                      {isCurrent && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-blue-500" aria-hidden="true" />
                      )}
                    </button>
                  )
                })}

                {/* Show All / Show Suggested Accordion Button */}
                {group.models.length > 4 && !searchQuery.trim() && (
                  <button
                    type="button"
                    onClick={() => toggleGroupExpand(group.id)}
                    className="flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 pl-8 text-xs text-[#9aa39b] hover:bg-[#151b17] hover:text-[#e9e5d8] transition-colors"
                  >
                    <span>
                      {isExpanded ? "Show suggested" : `Show all ${group.models.length} models`}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>
            )
          })}

        {!loading && filteredGroups.length === 0 && (
          <div className="py-6 text-center text-xs text-[#7a857c]">
            No models matching "{searchQuery}"
          </div>
        )}
      </div>

      {/* 3. Thinking Effort Controls */}
      <div className="shrink-0 border-t border-[#232b25] p-2 space-y-1.5 bg-[#101411]">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-medium text-[#7a857c]">Thinking</span>
          {selected.thinkingEffort ? (
            <button
              onClick={() => handlePickThinking(undefined)}
              className="text-[11px] text-[#ff7a45] hover:underline"
            >
              Reset to Default
            </button>
          ) : (
            <span className="text-[11px] text-[#7a857c]">Default</span>
          )}
        </div>

        {/* 5-pill track */}
        <div className="grid grid-cols-5 gap-0.5 rounded-full bg-[#151b17] p-1 border border-[#232b25]/60">
          {THINKING_LEVELS.map((level) => {
            const active = selected.thinkingEffort === level.id
            return (
              <button
                key={level.id}
                type="button"
                onClick={() => handlePickThinking(level.id)}
                className={`truncate rounded-full py-1 text-[11px] transition-all text-center ${
                  active
                    ? "bg-[#232b25] font-semibold text-[#e9e5d8] shadow-xs"
                    : "text-[#7a857c] hover:text-[#e9e5d8]"
                }`}
              >
                {level.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 4. Bottom Action: Manage AI accounts */}
      <div className="shrink-0 border-t border-[#232b25] p-1 bg-[#101411]">
        <button
          type="button"
          onClick={() => {
            onClose()
            onOpenManageAccounts()
          }}
          className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#1a211c] transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings className="h-3.5 w-3.5 text-[#9aa39b]" />
            <span>Manage AI accounts</span>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-[#7a857c]" />
        </button>
      </div>
    </div>
  )
}
