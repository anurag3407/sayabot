"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { Check, ChevronDown, Plus, Search } from "lucide-react"
import { setAgentModelAction } from "@/lib/actions/agents"
import { ProviderIcon } from "@/components/room/model-picker/provider-icons"
import { showToast } from "@/components/ui/toast"
import { SayabotMark } from "@/components/landing/sayabot-mark"
import { cn } from "@/lib/format"

export interface PickerModel {
  id: string
  label: string
  free?: boolean
}

export interface PickerGroup {
  keyId: string | null
  provider: string
  label: string
  detail: string
  models: PickerModel[]
}

const EFFORTS = [
  { id: "", label: "Default" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "max", label: "Max" },
]

function RailIcon({ group, size = 18 }: { group: PickerGroup; size?: number }) {
  if (group.keyId === null) return <SayabotMark className="h-[18px] w-[18px]" />
  return <ProviderIcon provider={group.provider} size={size} />
}

/**
 * OpenBot-style model picker for one agent: provider accounts on a rail, that account's
 * models on the right (search, Free badges), thinking effort at the bottom. Saves on click.
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
  const [open, setOpen] = useState(false)
  const [keyId, setKeyId] = useState<string | null>(currentKeyId)
  const [model, setModel] = useState<string | null>(currentModel)
  const [effort, setEffort] = useState<string>(currentEffort ?? "")
  const [railKey, setRailKey] = useState<string | null>(currentKeyId ?? groups[0]?.keyId ?? null)
  const [query, setQuery] = useState("")
  const [custom, setCustom] = useState("")
  const [pending, startTransition] = useTransition()
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
  const free = visible.filter((m) => m.free)
  const paid = visible.filter((m) => !m.free)
  const currentGroup = groups.find((g) => g.keyId === keyId)
  const chipLabel = keyId === null ? (currentGroup ? "Sayabot default" : "Choose a model") : (model ?? "Choose a model")

  function save(nextKey: string | null, nextModel: string | null, nextEffort = effort) {
    const prev = { keyId, model, effort }
    setKeyId(nextKey)
    setModel(nextModel)
    setEffort(nextEffort)
    startTransition(async () => {
      const result = await setAgentModelAction({
        orgSlug,
        agentId,
        providerKeyId: nextKey,
        model: nextModel,
        effort: nextEffort || null,
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
        {effort ? <span className="text-faint">· {effort}</span> : null}
        {!disabled ? <ChevronDown className="h-3 w-3 shrink-0 text-faint" /> : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a model"
          className="absolute left-0 top-10 z-40 flex h-[460px] w-[min(92vw,480px)] overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl"
        >
          <nav aria-label="Providers" className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-ink py-3">
            {groups.map((group) => (
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
                  "grid h-10 w-10 place-items-center rounded-xl transition-colors",
                  railKey === group.keyId ? "bg-raised ring-2 ring-line-strong" : "hover:bg-raised",
                )}
              >
                <RailIcon group={group} />
              </button>
            ))}
            <Link
              href={`/${orgSlug}/settings/keys`}
              title="Add a provider"
              aria-label="Add a provider"
              className="mt-auto grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised hover:text-text"
            >
              <Plus className="h-4 w-4" />
            </Link>
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            {active ? (
              <>
                <div className="px-4 pt-3">
                  <p className="text-[15px] font-semibold text-text">{active.label}</p>
                  <p className="text-[12px] text-faint">{active.detail}</p>
                </div>
                {active.keyId === null ? (
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
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                      {[
                        { title: "Free", list: free },
                        { title: free.length ? "Models" : "", list: paid },
                      ].map((section) =>
                        section.list.length ? (
                          <div key={section.title || "all"} className="mb-1">
                            {section.title ? <p className="px-2 pb-1 pt-2 text-[12px] text-faint">{section.title}</p> : null}
                            {section.list.map((m) => {
                              const selected = keyId === active.keyId && model === m.id
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => save(active.keyId, m.id)}
                                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-raised"
                                >
                                  <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full border", selected ? "border-text bg-text text-void" : "border-line-strong")}>
                                    {selected ? <Check className="h-3 w-3" /> : null}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-[14px] text-text">{m.label}</span>
                                  {m.free ? <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted">Free</span> : null}
                                </button>
                              )
                            })}
                          </div>
                        ) : null,
                      )}
                      {!visible.length ? <p className="px-2 py-6 text-center text-[13px] text-faint">No model matches.</p> : null}
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
                disabled={pending || !currentGroup}
                onChange={(event) => save(keyId, model, event.target.value)}
                className="h-9 rounded-lg border border-line bg-raised px-3 text-[13px] text-text"
                aria-label="Thinking effort"
              >
                {EFFORTS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
