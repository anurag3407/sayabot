"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronsUpDown, Loader2, Plus, Search, SlidersHorizontal, X } from "lucide-react"
import { ProviderIcon } from "./provider-icons"
import type { ModelOption, SelectedModelConfig, ThinkingEffort } from "@/lib/connectors/types"
import {
  DEFAULT_MODEL_CONFIG,
  getAllGroupedModels,
  saveStoredModelSelection,
  saveStoredThinkingEffort,
} from "@/lib/connectors/registry"
import type { ProviderGroupData } from "@/lib/connectors/registry"
import { cn } from "@/lib/format"

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

/** The first few of each provider are the ones people pick; the rest fold away. */
const SUGGESTED = 4

const railButton =
  "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-text"

function ModelRow({
  model,
  groupLabel,
  showGroup,
  selected,
  onPick,
}: {
  model: ModelOption
  groupLabel: string
  showGroup: boolean
  selected: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
        selected ? "bg-raised" : "hover:bg-raised/60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-[1.5px]",
          selected ? "border-text" : "border-line-strong",
        )}
      >
        {selected ? <span className="h-2 w-2 rounded-full bg-text" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("truncate text-[14px]", selected ? "font-medium text-text" : "text-text/90")}>
            {model.label}
          </span>
          {model.route ? (
            <span className="shrink-0 rounded-md bg-raised px-1.5 py-px text-[11px] lowercase text-muted">
              {model.route}
            </span>
          ) : null}
        </span>
        {showGroup ? <span className="block truncate text-[11.5px] text-faint">{groupLabel}</span> : null}
      </span>
    </button>
  )
}

export function ModelPickerDropdown({
  currentModel = DEFAULT_MODEL_CONFIG,
  onSelectModel,
  onOpenManageAccounts,
  onClose,
}: ModelPickerDropdownProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [groups, setGroups] = useState<ProviderGroupData[]>([])
  const [loading, setLoading] = useState(true)
  const [activeGroupId, setActiveGroupId] = useState<string>(currentModel.instanceId)
  const [olderOpen, setOlderOpen] = useState(false)
  const [selected, setSelected] = useState<SelectedModelConfig>(currentModel)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelected(currentModel)
  }, [currentModel])

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
        if (!cancelled && Array.isArray(data.groups)) setGroups(data.groups)
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

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) onClose()
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? null

  function pick(group: ProviderGroupData, model: ModelOption) {
    const next: SelectedModelConfig = {
      instanceId: group.id,
      modelId: model.id,
      modelLabel: model.label,
      provider: model.provider,
      providerGroup: group.label,
      thinkingEffort: selected.thinkingEffort,
    }
    setSelected(next)
    saveStoredModelSelection(next)
    onSelectModel?.(next)
    onClose()
  }

  function pickEffort(effort?: ThinkingEffort) {
    const next: SelectedModelConfig = { ...selected, thinkingEffort: effort }
    setSelected(next)
    saveStoredThinkingEffort(effort)
    onSelectModel?.(next)
  }

  const needle = searchQuery.trim().toLowerCase()
  const results = useMemo(() => {
    if (!needle) return []
    return groups.flatMap((group) =>
      group.models
        .filter(
          (model) =>
            model.label.toLowerCase().includes(needle) ||
            model.id.toLowerCase().includes(needle) ||
            group.label.toLowerCase().includes(needle),
        )
        .map((model) => ({ group, model })),
    )
  }, [groups, needle])

  const isSelected = (group: ProviderGroupData, model: ModelOption) =>
    selected.modelId === model.id && (selected.instanceId === group.id || !selected.instanceId)

  const suggested = activeGroup?.models.slice(0, SUGGESTED) ?? []
  const older = activeGroup?.models.slice(SUGGESTED) ?? []

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-full z-50 mt-2 flex h-[min(460px,calc(100dvh-80px))] w-[min(500px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-line-strong bg-panel text-text shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      role="menu"
      aria-label="Choose a model"
    >
      {/* Providers */}
      <div className="flex w-[60px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-void/50 py-2.5">
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto [scrollbar-width:none]">
          {groups.map((group) => {
            const active = activeGroup?.id === group.id && !needle
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => {
                  setActiveGroupId(group.id)
                  setOlderOpen(false)
                  setSearchQuery("")
                }}
                aria-pressed={active}
                aria-label={group.label}
                title={group.label}
                className={cn(
                  railButton,
                  "relative",
                  active && "bg-raised text-text ring-1 ring-line-strong",
                  group.status === "needs_setup" && !active && "opacity-50",
                )}
              >
                <ProviderIcon provider={group.provider} size={20} />
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => {
            onClose()
            onOpenManageAccounts()
          }}
          aria-label="Manage AI accounts"
          title="Manage AI accounts"
          className={railButton}
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => {
            onClose()
            onOpenManageAccounts()
          }}
          aria-label="Connect another AI account"
          title="Connect another AI account"
          className={railButton}
        >
          <Plus className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* Models */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 px-4 pb-2 pt-3.5">
          <p className="truncate text-[16px] font-semibold tracking-[-0.01em]">
            {needle ? "All models" : activeGroup?.label ?? "Models"}
          </p>
          <p className="mt-0.5 truncate text-[12.5px] text-faint">
            {needle
              ? `${results.length} ${results.length === 1 ? "match" : "matches"}`
              : activeGroup
                ? [activeGroup.account, activeGroup.status === "needs_setup" ? "needs setup" : null]
                    .filter(Boolean)
                    .join(" · ") || `${activeGroup.totalCount} models`
                : ""}
          </p>
        </div>

        <div className="shrink-0 px-3 pb-2">
          <label className="flex h-10 items-center gap-2 rounded-xl bg-raised px-3">
            <Search className="h-4 w-4 shrink-0 text-faint" aria-hidden="true" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search models"
              aria-label="Search models"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
              autoFocus
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="grid h-5 w-5 place-items-center rounded-full text-faint hover:bg-hover hover:text-text"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
        </div>

        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading models…
            </div>
          ) : needle ? (
            results.length ? (
              results.map(({ group, model }) => (
                <ModelRow
                  key={`${group.id}:${model.id}`}
                  model={model}
                  groupLabel={group.label}
                  showGroup
                  selected={isSelected(group, model)}
                  onPick={() => pick(group, model)}
                />
              ))
            ) : (
              <p className="py-8 text-center text-[13px] text-faint">No models match “{searchQuery}”</p>
            )
          ) : activeGroup ? (
            <>
              {suggested.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  groupLabel={activeGroup.label}
                  showGroup={false}
                  selected={isSelected(activeGroup, model)}
                  onPick={() => pick(activeGroup, model)}
                />
              ))}
              {older.length ? (
                <>
                  <button
                    type="button"
                    onClick={() => setOlderOpen((open) => !open)}
                    aria-expanded={olderOpen}
                    className="flex w-full items-center gap-2 rounded-xl bg-raised/60 py-2 pl-[42px] pr-3 text-left text-[14px] text-text/90 transition-colors hover:bg-raised"
                  >
                    <span>Older models</span>
                    <span className="rounded-full bg-hover px-1.5 text-[11px] text-muted">{older.length}</span>
                    <ChevronDown
                      className={cn("ml-auto h-4 w-4 text-faint transition-transform", olderOpen && "rotate-180")}
                    />
                  </button>
                  {olderOpen
                    ? older.map((model) => (
                        <ModelRow
                          key={model.id}
                          model={model}
                          groupLabel={activeGroup.label}
                          showGroup={false}
                          selected={isSelected(activeGroup, model)}
                          onPick={() => pick(activeGroup, model)}
                        />
                      ))
                    : null}
                </>
              ) : null}
            </>
          ) : (
            <p className="py-8 text-center text-[13px] text-faint">No AI accounts connected yet.</p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-2.5">
          <label htmlFor="model-picker-effort" className="text-[13px] text-faint">
            Effort
          </label>
          <span className="relative">
            <select
              id="model-picker-effort"
              value={selected.thinkingEffort ?? ""}
              onChange={(event) =>
                pickEffort((event.target.value || undefined) as ThinkingEffort | undefined)
              }
              className="h-9 w-[150px] cursor-pointer appearance-none rounded-xl bg-raised pl-3 pr-8 text-[13.5px] text-text outline-none hover:bg-hover"
            >
              <option value="">Default</option>
              {THINKING_LEVELS.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.label}
                </option>
              ))}
            </select>
            <ChevronsUpDown
              className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
              aria-hidden="true"
            />
          </span>
        </div>
      </div>
    </div>
  )
}
