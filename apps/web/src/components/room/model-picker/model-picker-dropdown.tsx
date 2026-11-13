"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronsUpDown,
  Loader2,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { EFFORT_LABELS, type EffortLevel } from "@sayabot/llm/models/effort"
import { ProviderIcon } from "./provider-icons"
import { SayabotMark } from "@/components/landing/sayabot-mark"
import { cn } from "@/lib/format"
import type { PickerGroup, PickerModel } from "@/lib/model-catalog"
import { AUTO_SELECTION, type ModelSelection } from "@/lib/model-selection"

interface ModelList {
  groups: PickerGroup[]
  canManage: boolean
}

/** The last list per workspace, shown at once while a fresh one loads. */
const lastLists = new Map<string, ModelList>()

/** When the server has no models of its own, Auto still needs a home in the rail. */
const AUTO_GROUP: PickerGroup = {
  keyId: null,
  provider: "saya",
  label: "Auto",
  detail: "Each agent answers with the model it is set to",
  section: "server",
  models: [{ id: "", label: "Auto" }],
  effortLevels: [],
}

export function useModelList(orgSlug: string) {
  const [list, setList] = useState<ModelList | null>(() => lastLists.get(orgSlug) ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true)
      setError(null)
      try {
        const query = new URLSearchParams({ org: orgSlug, ...(refresh ? { refresh: "1" } : {}) })
        const response = await fetch(`/api/connectors/models?${query}`, { cache: "no-store" })
        const body = (await response.json().catch(() => null)) as
          (ModelList & { error?: string }) | null
        if (!response.ok || !body || !Array.isArray(body.groups)) {
          throw new Error(body?.error ?? `HTTP ${response.status}`)
        }
        const next = { groups: body.groups, canManage: Boolean(body.canManage) }
        lastLists.set(orgSlug, next)
        setList(next)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load the model list")
      } finally {
        setLoading(false)
      }
    },
    [orgSlug],
  )

  useEffect(() => {
    void load()
  }, [load])

  return { list, loading, error, reload: load }
}

export function GroupIcon({ provider, size = 20 }: { provider: string; size?: 16 | 20 }) {
  const box = size === 16 ? "h-4 w-4" : "h-5 w-5"
  if (provider === "saya") return <SayabotMark className={box} />
  if (provider === "computer") return <Monitor className={box} />
  return <ProviderIcon provider={provider} size={size} />
}

const railButton =
  "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-raised hover:text-text"

function planLine(group: PickerGroup): string | null {
  const plan = group.plan
  if (!plan) return null
  const tightest = [...plan.windows].sort((a, b) => b.usedPercent - a.usedPercent)[0]
  const name = plan.plan ? `${plan.plan.charAt(0).toUpperCase()}${plan.plan.slice(1)} plan` : null
  const used = tightest ? `${tightest.label} ${Math.round(tightest.usedPercent)}% used` : null
  return [name, used].filter(Boolean).join(" · ") || null
}

function ModelRow({
  model,
  groupLabel,
  showGroup,
  selected,
  onPick,
}: {
  model: PickerModel
  groupLabel: string
  showGroup: boolean
  selected: boolean
  onPick: () => void
}) {
  const blocked = Boolean(model.orgBlocked)
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onPick}
      disabled={blocked}
      title={
        blocked
          ? "Your organization does not allow this model"
          : model.needsCliUpdate
            ? `Needs version ${model.needsCliUpdate} or newer of the app`
            : model.releaseDate
              ? `Released ${model.releaseDate}`
              : undefined
      }
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45",
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
          <span
            className={cn(
              "truncate text-[14px]",
              selected ? "font-medium text-text" : "text-text/90",
            )}
          >
            {model.label}
          </span>
          {model.listing === "new" ? (
            <span className="shrink-0 rounded-md bg-ok/15 px-1.5 py-px text-[11px] text-ok">
              new
            </span>
          ) : null}
          {model.free ? (
            <span className="shrink-0 rounded-md bg-raised px-1.5 py-px text-[11px] text-muted">
              free
            </span>
          ) : null}
          {model.needsCliUpdate ? (
            <span className="shrink-0 rounded-md bg-warn/15 px-1.5 py-px text-[11px] text-warn">
              update app
            </span>
          ) : null}
        </span>
        {showGroup ? (
          <span className="block truncate text-[11.5px] text-faint">{groupLabel}</span>
        ) : null}
      </span>
    </button>
  )
}

export function ModelPickerDropdown({
  orgSlug,
  selection,
  onSelect,
  onManageAccounts,
  onClose,
}: {
  orgSlug: string
  selection: ModelSelection
  onSelect: (selection: ModelSelection) => void
  /** Opens Manage AI accounts on a provider, or on the first one. */
  onManageAccounts: (provider?: string) => void
  onClose: () => void
}) {
  const { list, loading, error, reload } = useModelList(orgSlug)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeKey, setActiveKey] = useState<string | null | undefined>(undefined)
  const [olderOpen, setOlderOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const base = `/${orgSlug}`

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

  const groups = useMemo(() => {
    const live = list?.groups ?? []
    return live.some((group) => group.keyId === null) ? live : [AUTO_GROUP, ...live]
  }, [list])

  // Open on the account of the current pick; fall back to the first one.
  const activeGroup =
    groups.find(
      (group) => group.keyId === (activeKey === undefined ? selection.keyId : activeKey),
    ) ??
    groups[0] ??
    null

  const isSelected = (group: PickerGroup, model: PickerModel) =>
    selection.keyId === group.keyId && selection.modelId === model.id

  const selectedModel = useMemo(() => {
    const group = groups.find((g) => g.keyId === selection.keyId)
    const model = group?.models.find((m) => m.id === selection.modelId)
    return group && model ? { group, model } : null
  }, [groups, selection])

  const effortChoices: EffortLevel[] = selectedModel
    ? (selectedModel.model.effort ?? selectedModel.group.effortLevels)
    : []

  function pick(group: PickerGroup, model: PickerModel) {
    const isAuto = group.keyId === null && model.id === ""
    const effort =
      selection.effort && (model.effort ?? group.effortLevels).includes(selection.effort)
        ? selection.effort
        : undefined
    onSelect(
      isAuto
        ? { ...AUTO_SELECTION, label: group === AUTO_GROUP ? "Auto" : model.label }
        : {
            keyId: group.keyId,
            modelId: model.id,
            label: model.label,
            provider: group.provider,
            groupLabel: group.label,
            ...(effort ? { effort } : {}),
          },
    )
    onClose()
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

  const leading = activeGroup?.models.filter((model) => model.listing !== "older") ?? []
  const older = activeGroup?.models.filter((model) => model.listing === "older") ?? []
  const subtitle = activeGroup
    ? [activeGroup.detail, planLine(activeGroup)].filter(Boolean).join(" · ")
    : ""

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-full z-50 mt-2 flex h-[min(480px,calc(100dvh-80px))] w-[min(520px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-line-strong bg-panel text-text shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      role="menu"
      aria-label="Choose a model"
    >
      {/* Accounts */}
      <div className="flex w-[60px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-void/50 py-2.5">
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto [scrollbar-width:none]">
          {groups.map((group) => {
            const active = activeGroup?.keyId === group.keyId && !needle
            return (
              <button
                key={group.keyId ?? "server"}
                type="button"
                onClick={() => {
                  setActiveKey(group.keyId)
                  setOlderOpen(false)
                  setSearchQuery("")
                }}
                aria-pressed={active}
                aria-label={group.label}
                title={`${group.label}\n${group.detail}`}
                className={cn(railButton, active && "bg-raised text-text ring-1 ring-line-strong")}
              >
                <GroupIcon provider={group.provider} />
              </button>
            )
          })}
        </div>
        <Link
          href={`${base}/agents`}
          onClick={onClose}
          aria-label="Choose each agent's model"
          title="Choose each agent's model"
          className={railButton}
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" />
        </Link>
        <button
          type="button"
          onClick={() => {
            onClose()
            onManageAccounts()
          }}
          aria-label="Manage AI accounts"
          title="Manage AI accounts"
          className={railButton}
        >
          <Plus className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* Models */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-start gap-2 px-4 pb-2 pt-3.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-semibold tracking-[-0.01em]">
              {needle ? "All models" : (activeGroup?.label ?? "Models")}
            </p>
            <p
              className="mt-0.5 truncate text-[12.5px] text-faint"
              title={needle ? undefined : subtitle}
            >
              {needle
                ? `${results.length} ${results.length === 1 ? "match" : "matches"}`
                : subtitle}
            </p>
          </div>
          {list?.canManage ? (
            <button
              type="button"
              onClick={() => void reload(true)}
              disabled={loading}
              aria-label="Check every provider for new models"
              title="Check every provider for new models"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-raised hover:text-text disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
          ) : null}
        </div>

        {!needle && activeGroup?.notice ? (
          <p className="mx-4 mb-2 rounded-lg bg-warn/10 px-2.5 py-1.5 text-[12px] leading-snug text-warn">
            {activeGroup.notice}
          </p>
        ) : null}

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
          {!list && loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
              Asking your providers for their models…
            </div>
          ) : !list && error ? (
            <div className="py-8 text-center text-[13px] text-faint">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => void reload()}
                className="mt-2 text-text underline"
              >
                Try again
              </button>
            </div>
          ) : needle ? (
            results.length ? (
              results.map(({ group, model }) => (
                <ModelRow
                  key={`${group.keyId ?? "server"}:${model.id}`}
                  model={model}
                  groupLabel={group.label}
                  showGroup
                  selected={isSelected(group, model)}
                  onPick={() => pick(group, model)}
                />
              ))
            ) : (
              <p className="py-8 text-center text-[13px] text-faint">
                No models match “{searchQuery}”
              </p>
            )
          ) : activeGroup ? (
            <>
              {leading.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  groupLabel={activeGroup.label}
                  showGroup={false}
                  selected={isSelected(activeGroup, model)}
                  onPick={() => pick(activeGroup, model)}
                />
              ))}
              {!activeGroup.models.length ? (
                <p className="px-2.5 py-6 text-center text-[13px] text-faint">
                  {activeGroup.section === "computer"
                    ? "No apps are signed in on this computer right now."
                    : "This account listed no models."}
                </p>
              ) : null}
              {older.length ? (
                <>
                  <button
                    type="button"
                    onClick={() => setOlderOpen((open) => !open)}
                    aria-expanded={olderOpen}
                    className="flex w-full items-center gap-2 rounded-xl bg-raised/60 py-2 pl-[42px] pr-3 text-left text-[14px] text-text/90 transition-colors hover:bg-raised"
                  >
                    <span>Older models</span>
                    <span className="rounded-full bg-hover px-1.5 text-[11px] text-muted">
                      {older.length}
                    </span>
                    <ChevronDown
                      className={cn(
                        "ml-auto h-4 w-4 text-faint transition-transform",
                        olderOpen && "rotate-180",
                      )}
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
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-2.5">
          <label htmlFor="model-picker-effort" className="text-[13px] text-faint">
            Effort
          </label>
          <span className="relative">
            <select
              id="model-picker-effort"
              value={selection.effort ?? ""}
              disabled={!effortChoices.length}
              onChange={(event) => {
                const value = event.target.value as EffortLevel | ""
                const { effort: _previous, ...rest } = selection
                onSelect(value ? { ...rest, effort: value } : rest)
              }}
              className="h-9 w-[150px] cursor-pointer appearance-none rounded-xl bg-raised pl-3 pr-8 text-[13.5px] text-text outline-none hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Default</option>
              {effortChoices.map((level) => (
                <option key={level} value={level}>
                  {EFFORT_LABELS[level]}
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
