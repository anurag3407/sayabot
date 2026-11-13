"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown, Monitor, Plus, RefreshCw, Search } from "lucide-react"
import { EFFORT_LABELS, type EffortLevel } from "@sayabot/llm/models/effort"
import { refreshModelListsAction, setAgentModelAction } from "@/lib/actions/agents"
import { ProviderIcon } from "@/components/room/model-picker/provider-icons"
import { showToast } from "@/components/ui/toast"
import { SayabotMark } from "@/components/landing/sayabot-mark"
import { cn } from "@/lib/format"
import type { PickerGroup, PickerModel, PickerSection } from "@/lib/model-catalog"

export type { PickerGroup, PickerModel }

const SECTION_TITLE: Record<PickerSection, string> = {
  server: "Server",
  subscription: "Plans",
  key: "API keys",
  computer: "Computers",
}
const SECTION_ORDER: PickerSection[] = ["server", "subscription", "key", "computer"]

const SOURCE_BADGE: Partial<Record<NonNullable<PickerGroup["source"]>, { text: string; live: boolean }>> = {
  live: { text: "Live models", live: true },
  cache: { text: "Saved list", live: false },
  manifest: { text: "Sayabot list", live: false },
  catalog: { text: "models.dev list", live: false },
}

/** Chip text for the server's own provider (Saya AI): the picked model, or "Saya AI · Automatic". */
function sayaChipLabel(group: PickerGroup, model: string | null): string {
  if (!group.models.length) return "Sayabot default"
  if (!model) return `${group.label} · Automatic`
  return group.models.find((m) => m.id === model)?.label ?? `${group.label} · Automatic`
}

function RailIcon({ group, size = 18 }: { group: PickerGroup; size?: number }) {
  if (group.keyId === null) return <SayabotMark className="h-[18px] w-[18px]" />
  if (group.keyId.startsWith("host:")) return <Monitor style={{ width: size, height: size }} />
  return <ProviderIcon provider={group.provider} size={size} />
}

function money(value: number): string {
  if (value === 0) return "0"
  if (value < 0.1) return value.toFixed(3).replace(/0+$/, "")
  if (value < 10) return value.toFixed(2).replace(/\.?0+$/, "")
  return Math.round(value).toString()
}

function contextLabel(tokens: number | undefined): string | null {
  if (!tokens) return null
  if (tokens >= 1_000_000) return `${Math.round((tokens / 1_000_000) * 10) / 10}M`
  return `${Math.round(tokens / 1000)}K`
}

function resetLabel(iso: string | null): string {
  if (!iso) return ""
  const ms = Date.parse(iso) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return ""
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 24) return ` · resets in ${Math.round(hours / 24)}d`
  if (hours >= 1) return ` · resets in ${hours}h`
  return ` · resets in ${Math.max(1, Math.round(ms / 60_000))}m`
}

/** The levels a model takes in its group; [] means only Default. */
function effortOptions(group: PickerGroup | undefined, model: PickerModel | undefined): EffortLevel[] {
  if (!group) return []
  return model?.effort ?? group.effortLevels
}

function PlanPanel({ group }: { group: PickerGroup }) {
  const plan = group.plan
  if (!plan) return null
  if (plan.error) return <p className="px-4 pb-1 text-[12px] text-faint">{plan.error}</p>
  return (
    <div className="mx-4 mb-1 rounded-lg bg-raised px-3 py-2">
      <p className="text-[12px] font-medium text-text">
        {plan.plan ? `${plan.plan.charAt(0).toUpperCase()}${plan.plan.slice(1)} plan` : "Your plan"}
      </p>
      {plan.windows.slice(0, 4).map((w) => (
        <div key={w.label} className="mt-1.5">
          <div className="flex justify-between text-[11px] text-muted">
            <span>{w.label}</span>
            <span>
              {Math.round(w.usedPercent)}% used{resetLabel(w.resetsAt)}
            </span>
          </div>
          <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-line">
            <div
              className={cn("h-full rounded-full", w.usedPercent >= 90 ? "bg-danger" : w.usedPercent >= 70 ? "bg-warn" : "bg-ok")}
              style={{ width: `${Math.min(100, Math.max(2, w.usedPercent))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * OpenMausBot-style model picker for one agent: provider accounts on a rail (plans, API keys,
 * computers), that account's live models on the right with price and context window, plan usage
 * for subscriptions, and the effort levels the chosen model takes. Saves on click.
 */
export function AgentModelPicker({
  orgSlug,
  agentId,
  groups,
  currentKeyId,
  currentModel,
  currentEffort,
  disabled,
}: {
  orgSlug: string
  agentId: string
  groups: PickerGroup[]
  currentKeyId: string | null
  currentModel: string | null
  currentEffort: string | null
  disabled?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [keyId, setKeyId] = useState<string | null>(currentKeyId)
  const [model, setModel] = useState<string | null>(currentModel)
  const [effort, setEffort] = useState<string>(currentEffort ?? "")
  const [railKey, setRailKey] = useState<string | null>(currentKeyId ?? groups[0]?.keyId ?? null)
  const [query, setQuery] = useState("")
  const [custom, setCustom] = useState("")
  const [pending, startTransition] = useTransition()
  const [refreshing, startRefresh] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const active = groups.find((g) => g.keyId === railKey) ?? groups[0]
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = active?.models ?? []
    return q ? list.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)) : list
  }, [active, query])
  const sections = [
    { title: "Free", list: visible.filter((m) => m.free) },
    { title: "Models", list: visible.filter((m) => !m.free && !m.custom) },
    { title: "Your providers", list: visible.filter((m) => !m.free && m.custom) },
  ].filter((s) => s.list.length)
  const railSections = SECTION_ORDER.map((section) => ({ section, list: groups.filter((g) => g.section === section) })).filter(
    (s) => s.list.length,
  )
  const currentGroup = groups.find((g) => g.keyId === keyId)
  const currentPicked = currentGroup?.models.find((m) => m.id === model)
  const offered = effortOptions(currentGroup, currentPicked)
  const chipLabel =
    keyId === null
      ? currentGroup
        ? sayaChipLabel(currentGroup, model)
        : "Choose a model"
      : keyId.startsWith("host:")
        ? `${currentPicked?.label.split(" ·")[0] ?? model} on ${currentGroup?.label ?? "your computer"}`
        : keyId.startsWith("cli:")
          ? `${currentPicked?.label ?? model ?? "Default"} · ${keyId === "cli:codex" ? "Codex" : keyId === "cli:cursor" ? "Cursor" : "Claude Code"}`
          : (currentPicked?.label ?? model ?? "Choose a model")

  function save(nextKey: string | null, nextModel: string | null, nextEffort = effort) {
    // A level the new model does not take falls back to Default instead of failing its first turn.
    const group = groups.find((g) => g.keyId === nextKey)
    const levels = effortOptions(group, group?.models.find((m) => m.id === nextModel))
    const effortToSave = nextEffort && (levels as string[]).includes(nextEffort) ? nextEffort : ""
    const prev = { keyId, model, effort }
    setKeyId(nextKey)
    setModel(nextModel)
    setEffort(effortToSave)
    startTransition(async () => {
      const result = await setAgentModelAction({
        orgSlug,
        agentId,
        providerKeyId: nextKey,
        model: nextModel,
        effort: effortToSave || null,
      })
      if (!result.ok) {
        setKeyId(prev.keyId)
        setModel(prev.model)
        setEffort(prev.effort)
        showToast({ tone: "danger", message: result.error ?? "Could not change the model" })
        return
      }
      showToast({ tone: "success", message: result.message ?? "Saved" })
    })
  }

  function refresh() {
    startRefresh(async () => {
      const result = await refreshModelListsAction(orgSlug)
      if (!result.ok) {
        showToast({ tone: "danger", message: result.error ?? "Could not refresh the model lists" })
        return
      }
      router.refresh()
    })
  }

  const badge = active?.source ? SOURCE_BADGE[active.source] : undefined

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 text-[12px] text-text transition-colors hover:border-line-strong disabled:cursor-default disabled:opacity-70"
      >
        {currentGroup ? <RailIcon group={currentGroup} size={13} /> : null}
        <span className="truncate">{chipLabel}</span>
        {effort ? <span className="text-faint">· {EFFORT_LABELS[effort as EffortLevel] ?? effort}</span> : null}
        {!disabled ? <ChevronDown className="h-3 w-3 shrink-0 text-faint" /> : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a model"
          className="absolute left-0 top-10 z-40 flex h-[540px] max-h-[80vh] w-[min(92vw,520px)] overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl"
        >
          <nav aria-label="Providers" className="flex w-16 shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-line bg-ink py-3">
            {railSections.map(({ section, list }) => (
              <div key={section} className="flex flex-col items-center gap-1.5">
                <p className="px-1 pt-1 text-center text-[10px] leading-tight text-faint">{SECTION_TITLE[section]}</p>
                {list.map((group) => (
                  <button
                    key={group.keyId ?? "default"}
                    type="button"
                    title={group.label}
                    aria-label={group.label}
                    aria-pressed={railKey === group.keyId}
                    onClick={() => {
                      setRailKey(group.keyId)
                      setQuery("")
                    }}
                    className={cn(
                      "relative grid h-10 w-10 place-items-center rounded-xl transition-colors",
                      railKey === group.keyId ? "bg-raised ring-2 ring-line-strong" : "hover:bg-raised",
                    )}
                  >
                    <RailIcon group={group} />
                    {group.plan?.windows.some((w) => w.usedPercent >= 80) ? (
                      <span className="absolute bottom-1 right-1 h-2 w-2 rounded-full bg-warn" aria-label="Near its limit" />
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
            <Link
              href={`/${orgSlug}/settings/keys`}
              title="Add API keys"
              aria-label="Add API keys"
              className="mt-auto grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-dashed border-line-strong text-muted hover:bg-raised hover:text-text"
            >
              <Plus className="h-4 w-4" />
            </Link>
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            {active ? (
              <>
                <div className="flex items-start justify-between gap-2 px-4 pb-2 pt-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-text">{active.label}</p>
                    <p className="text-[12px] text-faint">{active.detail}</p>
                  </div>
                  {active.source && active.source !== "static" ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={refresh}
                        disabled={refreshing}
                        title="Read the model lists again"
                        aria-label="Refresh model lists"
                        className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-raised hover:text-text disabled:opacity-60"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                      </button>
                      {badge ? (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px]",
                            badge.live ? "bg-ok/15 text-ok" : "bg-raised text-muted",
                          )}
                        >
                          {badge.text}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <PlanPanel group={active} />
                {active.notice ? <p className="px-4 pb-1 text-[11px] text-faint">{active.notice}</p> : null}
                {active.keyId === null && active.models.length ? (
                  <div className="flex-1 overflow-y-auto px-2 py-2">
                    {active.models.map((m) => {
                      // "" is Automatic: the agent follows whatever default the server sets.
                      const selected = keyId === null && (model ?? "") === m.id
                      return (
                        <button
                          key={m.id || "automatic"}
                          type="button"
                          onClick={() => save(null, m.id || null)}
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-raised"
                        >
                          <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border", selected ? "border-text bg-text text-void" : "border-line-strong")}>
                            {selected ? <Check className="h-3 w-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[14px] text-text">{m.label}</span>
                        </button>
                      )
                    })}
                    <p className="px-2 pt-2 text-[12px] text-faint">
                      Your server keeps these up to date. Nothing to change when it upgrades a model.
                    </p>
                  </div>
                ) : active.keyId === null ? (
                  <div className="flex-1 px-4 py-4">
                    <button
                      type="button"
                      onClick={() => save(null, null)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-[14px] text-text hover:bg-raised"
                    >
                      <span className={cn("grid h-5 w-5 place-items-center rounded-full border", keyId === null ? "border-text bg-text text-void" : "border-line-strong")}>
                        {keyId === null ? <Check className="h-3 w-3" /> : null}
                      </span>
                      Use the server&apos;s default model
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="px-4 py-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="Search models"
                          className="h-9 w-full rounded-lg bg-raised pl-8 pr-3 text-[13px] text-text outline-none placeholder:text-faint focus:ring-1 focus:ring-line-strong"
                          autoFocus
                        />
                      </div>
                    </div>
                    {active.keyId?.startsWith("host:") && !active.models.length ? (
                      <p className="px-4 py-3 text-[13px] text-muted">
                        No signed-in app found on this computer yet. Open Claude Code or Codex there once and sign in.
                      </p>
                    ) : null}
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                      {sections.map((section) => (
                        <div key={section.title} className="mb-1">
                          {sections.length > 1 ? <p className="px-2 pb-1 pt-2 text-[12px] text-faint">{section.title}</p> : null}
                          {section.list.map((m) => {
                            const selected = keyId === active.keyId && model === m.id
                            const unusable = m.orgBlocked || Boolean(m.needsCliUpdate)
                            const ctx = contextLabel(m.contextWindow)
                            return (
                              <button
                                key={m.id}
                                type="button"
                                disabled={unusable}
                                onClick={() => save(active.keyId, m.id)}
                                title={
                                  m.orgBlocked
                                    ? "Your organization does not allow this model"
                                    : m.needsCliUpdate
                                      ? `Needs version ${m.needsCliUpdate} or newer of the app. Update it, then refresh.`
                                      : m.id
                                }
                                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border", selected ? "border-text bg-text text-void" : "border-line-strong")}>
                                  {selected ? <Check className="h-3 w-3" /> : null}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[14px] text-text">{m.label}</span>
                                {m.orgBlocked ? (
                                  <span className="shrink-0 text-[11px] text-faint">Blocked by org</span>
                                ) : m.needsCliUpdate ? (
                                  <span className="shrink-0 text-[11px] text-faint">Update app</span>
                                ) : (
                                  <span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-faint">
                                    {ctx ? <span>{ctx}</span> : null}
                                    {m.free ? (
                                      <span className="rounded-full bg-raised px-2 py-0.5 text-muted">Free</span>
                                    ) : m.price ? (
                                      <span title="US dollars per million tokens: input / output">
                                        ${money(m.price.inputPerMillion)} / ${money(m.price.outputPerMillion)}
                                      </span>
                                    ) : null}
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      ))}
                      {!visible.length ? <p className="px-2 py-6 text-center text-[13px] text-faint">No model matches.</p> : null}
                      {active.keyId?.startsWith("host:") ? null : (
                        <form
                          className="mt-2 flex gap-2 px-2"
                          onSubmit={(event) => {
                            event.preventDefault()
                            if (custom.trim()) save(active.keyId, custom.trim())
                            setCustom("")
                          }}
                        >
                          <input
                            value={custom}
                            onChange={(event) => setCustom(event.target.value)}
                            placeholder="Other model id…"
                            className="h-8 min-w-0 flex-1 rounded-lg bg-raised px-2.5 text-[12px] text-text outline-none placeholder:text-faint"
                          />
                          <button type="submit" className="rounded-lg px-2 text-[12px] text-muted hover:text-text">
                            Use
                          </button>
                        </form>
                      )}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                <p className="text-[14px] text-text">No AI provider connected yet</p>
                <Link href={`/${orgSlug}/settings/keys`} className="text-[13px] font-medium text-accent hover:underline">
                  Connect one →
                </Link>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
              <span className="text-[13px] text-muted">Effort</span>
              <select
                value={effort}
                disabled={pending || !currentGroup || !offered.length}
                onChange={(event) => save(keyId, model, event.target.value)}
                className="h-9 rounded-lg border border-line bg-raised px-3 text-[13px] text-text disabled:opacity-60"
                aria-label="Thinking effort"
                title={!offered.length && currentGroup ? "This model has no effort setting" : undefined}
              >
                <option value="">
                  Default{currentPicked?.defaultEffort ? ` (${EFFORT_LABELS[currentPicked.defaultEffort]})` : ""}
                </option>
                {offered.map((level) => (
                  <option key={level} value={level}>
                    {EFFORT_LABELS[level]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[12px] text-faint">
              <span>Model providers and accounts</span>
              <Link href={`/${orgSlug}/settings/keys`} className="text-muted hover:text-text">
                Add API keys
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
