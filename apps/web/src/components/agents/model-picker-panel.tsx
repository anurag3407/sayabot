"use client"

import Link from "next/link"
import { useMemo, useState, type ReactNode } from "react"
import { Check, ChevronDown, ChevronRight, Cpu, Monitor, Plus, RefreshCw, Search } from "lucide-react"
import { EFFORT_LABELS, type EffortLevel } from "@sayabot/llm/models/effort"
import { ProviderIcon } from "@/components/room/model-picker/provider-icons"
import { SayabotMark } from "@/components/landing/sayabot-mark"
import { cn } from "@/lib/format"
import type { PickerGroup, PickerModel, PickerSection } from "@/lib/model-catalog"

/**
 * The model picker's body, shared by a bot's card and a chat's title bar: provider accounts on a
 * rail (the server's models, apps signed in on your Mac or the server, API keys, local models),
 * the chosen account's models on the right, and the effort the picked model takes. It only
 * reports picks; the caller saves them.
 */

export interface ModelValue {
  keyId: string | null
  model: string | null
  effort: string | null
}

const SECTION_TITLE: Record<PickerSection, string> = {
  server: "Cloud",
  subscription: "Server",
  mac: "Mac",
  key: "API keys",
  local: "Local",
  computer: "Computers",
}
const SECTION_ORDER: PickerSection[] = ["server", "subscription", "mac", "key", "local", "computer"]

const SOURCE_BADGE: Partial<Record<NonNullable<PickerGroup["source"]>, { text: string; live: boolean }>> = {
  live: { text: "Live models", live: true },
  cache: { text: "Saved list", live: false },
  manifest: { text: "Sayabot list", live: false },
  catalog: { text: "models.dev list", live: false },
}

const APP_NAME: Record<string, string> = {
  anthropic: "Claude Code",
  openai: "Codex",
  google: "Gemini CLI",
  opencode: "OpenCode",
  cursor: "Cursor",
}

/** How many models show before "Show all". */
const SUGGESTED = 6

export function RailIcon({ group, size = 18 }: { group: PickerGroup; size?: number }) {
  if (group.keyId === null) return <SayabotMark className="h-[18px] w-[18px]" />
  if (group.section === "local") return <Cpu style={{ width: size, height: size }} />
  if (group.section === "computer") return <Monitor style={{ width: size, height: size }} />
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
export function effortOptions(group: PickerGroup | undefined, model: PickerModel | undefined): EffortLevel[] {
  if (!group) return []
  return model?.effort ?? group.effortLevels
}

/** A level the new model does not take falls back to Default instead of failing its first turn. */
export function fitEffort(groups: PickerGroup[], keyId: string | null, model: string | null, effort: string | null): string | null {
  const group = groups.find((g) => g.keyId === keyId)
  const levels = effortOptions(group, group?.models.find((m) => m.id === model)) as string[]
  return effort && levels.includes(effort) ? effort : null
}

/** "Claude Opus 5.5 · Claude", "llama3.2 · Ollama", "Saya AI · Automatic". */
export function choiceLabel(groups: PickerGroup[], value: ModelValue): string {
  const group = groups.find((g) => g.keyId === value.keyId)
  if (!group) return value.model && value.model !== "default" ? value.model : "Choose a model"
  if (group.keyId === null) {
    if (!group.models.length) return "Sayabot default"
    return group.models.find((m) => m.id === (value.model ?? ""))?.label ?? `${group.label} · Automatic`
  }
  const picked = group.models.find((m) => m.id === value.model)
  return `${picked?.label ?? value.model ?? "Default"} · ${group.label}`
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

function Radio({ on }: { on: boolean }) {
  return (
    <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border", on ? "border-text bg-text text-void" : "border-line-strong")}>
      {on ? <Check className="h-3 w-3" /> : null}
    </span>
  )
}

export function ModelPickerPanel({
  orgSlug,
  groups,
  value,
  onPick,
  pending = false,
  disabled = false,
  header,
  onRefresh,
  refreshing = false,
  className,
}: {
  orgSlug: string
  groups: PickerGroup[]
  /** What is picked now, or null when nothing here is (the chat follows the bot). */
  value: ModelValue | null
  onPick: (next: ModelValue) => void
  pending?: boolean
  disabled?: boolean
  /** Shown above the rail and list (the chat picker's "Use @bot's model" and scope). */
  header?: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  className?: string
}) {
  const firstKey = value && groups.some((g) => g.keyId === value.keyId) ? value.keyId : (groups[0]?.keyId ?? null)
  const [railKey, setRailKey] = useState<string | null>(firstKey)
  const [query, setQuery] = useState("")
  const [custom, setCustom] = useState("")
  const [showAll, setShowAll] = useState(false)

  const active = groups.find((g) => g.keyId === railKey) ?? groups[0]
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = active?.models ?? []
    return q ? list.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)) : list
  }, [active, query])
  // Search and the picked model always show; otherwise the first few lead and the rest fold away.
  const pickedIndex = visible.findIndex((m) => value?.keyId === active?.keyId && value?.model === m.id)
  const folded = !query && !showAll && visible.length > SUGGESTED + 2 && pickedIndex < SUGGESTED
  const shown = folded ? visible.slice(0, SUGGESTED) : visible
  const railSections = SECTION_ORDER.map((section) => ({ section, list: groups.filter((g) => g.section === section) })).filter(
    (s) => s.list.length,
  )
  const firstLocal = groups.find((g) => g.section === "local")
  const currentGroup = value ? groups.find((g) => g.keyId === value.keyId) : undefined
  const currentPicked = currentGroup?.models.find((m) => m.id === value?.model)
  const offered = effortOptions(currentGroup, currentPicked)
  const badge = active?.source ? SOURCE_BADGE[active.source] : undefined
  const locked = disabled || pending

  function pick(keyId: string | null, model: string | null, effort = value?.effort ?? null) {
    if (locked) return
    onPick({ keyId, model, effort: fitEffort(groups, keyId, model, effort) })
  }

  function openRail(keyId: string | null) {
    setRailKey(keyId)
    setQuery("")
    setShowAll(false)
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {header}
      <div className="flex min-h-0 flex-1">
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
                  onClick={() => openRail(group.keyId)}
                  className={cn(
                    "relative grid h-10 w-10 place-items-center rounded-xl transition-colors",
                    railKey === group.keyId ? "bg-raised ring-2 ring-line-strong" : "hover:bg-raised",
                  )}
                >
                  <RailIcon group={group} />
                  {group.plan?.windows.some((w) => w.usedPercent >= 80) ? (
                    <span className="absolute bottom-1 right-1 h-2 w-2 rounded-full bg-warn" aria-label="Near its limit" />
                  ) : value?.keyId === group.keyId ? (
                    <span className="absolute bottom-1 right-1 h-2 w-2 rounded-full bg-ok" aria-label="In use" />
                  ) : null}
                </button>
              ))}
              {section === "key" ? (
                <Link
                  href={`/${orgSlug}/settings/keys`}
                  title="Add API keys"
                  aria-label="Add API keys"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-dashed border-line-strong text-muted hover:bg-raised hover:text-text"
                >
                  <Plus className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          ))}
          {!groups.some((g) => g.section === "key") ? (
            <div className="flex flex-col items-center gap-1.5">
              <p className="px-1 pt-1 text-center text-[10px] leading-tight text-faint">API keys</p>
              <Link
                href={`/${orgSlug}/settings/keys`}
                title="Add API keys"
                aria-label="Add API keys"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-dashed border-line-strong text-muted hover:bg-raised hover:text-text"
              >
                <Plus className="h-4 w-4" />
              </Link>
            </div>
          ) : null}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          {active ? (
            <>
              <div className="flex items-start justify-between gap-2 px-4 pb-2 pt-3">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-text">{active.label}</p>
                  <p className="truncate text-[12px] text-faint">{active.account ?? active.detail}</p>
                  {active.account ? <p className="truncate text-[11px] text-faint">{active.detail}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {onRefresh && active.source && active.source !== "static" ? (
                    <button
                      type="button"
                      onClick={onRefresh}
                      disabled={refreshing}
                      title="Read the model lists again"
                      aria-label="Refresh model lists"
                      className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-raised hover:text-text disabled:opacity-60"
                    >
                      <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                    </button>
                  ) : null}
                  {active.version ? (
                    <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[11px] tabular-nums text-ok">
                      {active.version}
                      {APP_NAME[active.provider] ? ` (${APP_NAME[active.provider]})` : ""}
                    </span>
                  ) : badge ? (
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px]", badge.live ? "bg-ok/15 text-ok" : "bg-raised text-muted")}>
                      {badge.text}
                    </span>
                  ) : null}
                </div>
              </div>
              {active.runnerEnabled === false && (active.section === "mac" || active.section === "local") ? (
                <p className="mx-4 mb-1 rounded-lg bg-warn/10 px-3 py-2 text-[12px] text-warn">
                  Turn on “Run agents on this computer” in{" "}
                  <Link href={`/${orgSlug}/settings/computers`} className="underline">
                    Settings → Computers
                  </Link>{" "}
                  so bots can run here.
                </p>
              ) : null}
              <PlanPanel group={active} />
              {active.notice ? <p className="px-4 pb-1 text-[11px] text-faint">{active.notice}</p> : null}

              {active.keyId === null ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  {(active.models.length ? active.models : [{ id: "", label: "Use the server's default model" }]).map((m) => {
                    // "" is Automatic: the bot follows whatever default the server sets.
                    const selected = value?.keyId === null && (value.model ?? "") === m.id
                    return (
                      <button
                        key={m.id || "automatic"}
                        type="button"
                        disabled={locked}
                        onClick={() => pick(null, m.id || null)}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-raised disabled:opacity-60"
                      >
                        <Radio on={selected} />
                        <span className="min-w-0 flex-1 truncate text-[14px] text-text">{m.label}</span>
                      </button>
                    )
                  })}
                  <p className="px-2 pt-2 text-[12px] text-faint">
                    Your server keeps these up to date. Nothing to change when it upgrades a model.
                  </p>
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
                        aria-label="Search models"
                        className="h-9 w-full rounded-lg bg-raised pl-8 pr-3 text-[13px] text-text outline-none placeholder:text-faint focus:ring-1 focus:ring-line-strong"
                      />
                    </div>
                  </div>
                  {!active.models.length ? (
                    <p className="px-4 py-3 text-[13px] text-muted">
                      {active.section === "local"
                        ? `No model downloaded in ${active.label} yet. Download one there, then reopen this list.`
                        : "No signed-in app found on this computer yet. Open Claude Code or Codex there once and sign in."}
                    </p>
                  ) : null}
                  <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                    {shown.length && !query ? <p className="px-2 pb-1 pt-1 text-[12px] text-faint">{folded ? "Suggested" : "Models"}</p> : null}
                    {shown.map((m) => {
                      const selected = value?.keyId === active.keyId && value?.model === m.id
                      const unusable = m.orgBlocked || Boolean(m.needsCliUpdate)
                      const ctx = contextLabel(m.contextWindow)
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={unusable || locked}
                          onClick={() => pick(active.keyId, m.id)}
                          title={
                            m.orgBlocked
                              ? "Your organization does not allow this model"
                              : m.needsCliUpdate
                                ? `Needs version ${m.needsCliUpdate} or newer of the app. Update it, then refresh.`
                                : m.id
                          }
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Radio on={selected} />
                          <span className="min-w-0 flex-1 truncate text-[14px] text-text">{m.label}</span>
                          {m.orgBlocked ? (
                            <span className="shrink-0 text-[11px] text-faint">Blocked by org</span>
                          ) : m.needsCliUpdate ? (
                            <span className="shrink-0 text-[11px] text-faint">Update app</span>
                          ) : m.id === "default" ? (
                            <span className="shrink-0 text-[11px] text-faint">Default</span>
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
                    {folded ? (
                      <button
                        type="button"
                        onClick={() => setShowAll(true)}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[13px] text-muted hover:bg-raised hover:text-text"
                      >
                        Show all {visible.length} models
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    ) : null}
                    {query && !visible.length ? <p className="px-2 py-6 text-center text-[13px] text-faint">No model matches.</p> : null}
                    {active.section === "key" || active.section === "subscription" ? (
                      <form
                        className="mt-2 flex gap-2 px-2"
                        onSubmit={(event) => {
                          event.preventDefault()
                          if (custom.trim()) pick(active.keyId, custom.trim())
                          setCustom("")
                        }}
                      >
                        <input
                          value={custom}
                          onChange={(event) => setCustom(event.target.value)}
                          placeholder="Other model id…"
                          aria-label="Other model id"
                          className="h-8 min-w-0 flex-1 rounded-lg bg-raised px-2.5 text-[12px] text-text outline-none placeholder:text-faint"
                        />
                        <button type="submit" disabled={locked} className="rounded-lg px-2 text-[12px] text-muted hover:text-text">
                          Use
                        </button>
                      </form>
                    ) : null}
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
              value={value?.effort ?? ""}
              disabled={locked || !currentGroup || !offered.length}
              onChange={(event) => value && pick(value.keyId, value.model, event.target.value || null)}
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
          {active?.section !== "local" ? (
            firstLocal ? (
              <button
                type="button"
                onClick={() => openRail(firstLocal.keyId)}
                className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-left text-[13px] text-text hover:bg-raised"
              >
                Use a local model
                <ChevronRight className="h-4 w-4 text-faint" />
              </button>
            ) : (
              <p className="border-t border-line px-4 py-2.5 text-[12px] text-faint">
                Local models: open Ollama or LM Studio on your Mac with Sayabot for Mac running.
              </p>
            )
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[12px] text-faint">
            <Link href={`/${orgSlug}/settings/keys`} className="hover:text-text">
              Model providers and accounts
            </Link>
            <Link href={`/${orgSlug}/settings/keys`} className="text-muted hover:text-text">
              Add API keys
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
