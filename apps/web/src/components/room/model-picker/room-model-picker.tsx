"use client"

import { useCallback, useEffect, useRef, useState, useTransition } from "react"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { setRoomAgentModelAction } from "@/lib/actions/agents"
import { showToast } from "@/components/ui/toast"
import { choiceLabel, ModelPickerPanel, RailIcon, type ModelValue } from "@/components/agents/model-picker-panel"
import { cn } from "@/lib/format"
import { MODEL_PICKER_EVENT } from "@/lib/recovery-hint"
import type { PickerGroup } from "@/lib/model-catalog"
import type { RoomBotModel } from "@/app/api/connectors/models/room/route"
import { useReloadAfterRescan } from "./model-list"

type Scope = "chat" | "default"

interface Lists {
  groups: PickerGroup[]
  bots: RoomBotModel[]
  canEdit: boolean
}

/** The last lists per chat, shown at once while fresh ones load. */
const lastLists = new Map<string, Lists>()

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" })
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error ?? `HTTP ${response.status}`)
  return body
}

function useRoomModels(orgSlug: string, roomId: string) {
  const cacheKey = `${orgSlug}/${roomId}`
  const [lists, setLists] = useState<Lists | null>(() => lastLists.get(cacheKey) ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true)
      setError(null)
      try {
        const query = new URLSearchParams({ org: orgSlug, ...(refresh ? { refresh: "1" } : {}) })
        const [models, room] = await Promise.all([
          readJson<{ groups: PickerGroup[] }>(`/api/connectors/models?${query}`),
          readJson<{ bots: RoomBotModel[]; canEdit: boolean }>(
            `/api/connectors/models/room?${new URLSearchParams({ org: orgSlug, room: roomId })}`,
          ),
        ])
        const next = { groups: models.groups, bots: room.bots, canEdit: room.canEdit }
        lastLists.set(cacheKey, next)
        setLists(next)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load the model list")
      } finally {
        setLoading(false)
      }
    },
    [orgSlug, roomId, cacheKey],
  )

  useEffect(() => {
    void load()
  }, [load])

  const reload = useReloadAfterRescan(load)
  return { lists, loading, error, reload }
}

/**
 * The chat's model picker in the title bar: which model each bot answers with in this chat.
 * "Only this chat" keeps the pick here even when the bot's own model changes later; "Chat + bot
 * default" changes the bot everywhere. "Use @bot's model" drops this chat's own pick.
 */
export function RoomModelPicker({ orgSlug, roomId }: { orgSlug: string; roomId: string }) {
  const { lists, loading, error, reload } = useRoomModels(orgSlug, roomId)
  const [open, setOpen] = useState(false)
  const [botId, setBotId] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>("chat")
  const [pending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  // "Switch model" on a failed reply opens this picker.
  useEffect(() => {
    const openPicker = () => setOpen(true)
    window.addEventListener(MODEL_PICKER_EVENT, openPicker)
    return () => window.removeEventListener(MODEL_PICKER_EVENT, openPicker)
  }, [])

  useEffect(() => {
    if (!open) return
    void reload()
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
  }, [open, reload])

  const bots = lists?.bots.filter((b) => b.editable) ?? []
  const bot = bots.find((b) => b.id === botId) ?? bots[0]
  // No bot in this chat that the picker can change: nothing to show.
  if (lists && !bot) return null

  const groups = lists?.groups ?? []
  const effective: ModelValue | null = bot ? (bot.chat ?? bot.bot) : null
  const effectiveGroup = effective ? groups.find((g) => g.keyId === effective.keyId) : undefined
  // The model, and "· Mac" when it runs on the person's own computer.
  const onMac = effectiveGroup?.section === "mac" || effectiveGroup?.section === "local"
  const buttonLabel =
    effective && groups.length ? `${choiceLabel(groups, effective).split(" · ")[0]}${onMac ? " · Mac" : ""}` : "Model"

  function save(next: ModelValue | null) {
    if (!bot) return
    startTransition(async () => {
      const result = await setRoomAgentModelAction({
        orgSlug,
        roomId,
        agentId: bot.id,
        scope: next ? scope : "chat",
        clear: next === null,
        keyId: next?.keyId ?? null,
        model: next?.model ?? null,
        effort: next?.effort ?? null,
      })
      if (!result.ok) {
        showToast({ tone: "danger", message: result.error ?? "Could not change the model" })
        return
      }
      showToast({ tone: "success", message: result.message ?? "Saved" })
      await reload()
    })
  }

  const header = bot ? (
    <div className="border-b border-line">
      {bots.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto px-3 pt-2" role="tablist" aria-label="Bot">
          {bots.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={b.id === bot.id}
              onClick={() => setBotId(b.id)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-[12px]",
                b.id === bot.id ? "bg-raised font-medium text-text" : "text-muted hover:bg-raised hover:text-text",
              )}
            >
              @{b.handle}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        disabled={!lists?.canEdit || pending || !bot.chat}
        onClick={() => save(null)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-raised disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="shrink-0 text-[14px] font-semibold text-text">Use {bot.displayName}&apos;s model</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-faint">{groups.length ? choiceLabel(groups, bot.bot) : ""}</span>
        {!bot.chat ? <Check className="h-4 w-4 shrink-0 text-text" aria-label="In use" /> : null}
      </button>
      <div className="px-4 pb-3">
        <div className="flex gap-1" role="radiogroup" aria-label="Where this applies">
          {(
            [
              ["chat", "Only this chat"],
              ["default", "Chat + bot default"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={scope === id}
              onClick={() => setScope(id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[13px]",
                scope === id ? "bg-raised font-medium text-text" : "text-muted hover:text-text",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[12px] text-faint">
          {scope === "chat"
            ? "This chat only. It keeps this model when the bot's model changes."
            : `Changes ${bot.displayName}'s model everywhere, and this chat follows it.`}
        </p>
        {!lists?.canEdit ? <p className="mt-1 text-[12px] text-warn">Only workspace admins can change models.</p> : null}
      </div>
    </div>
  ) : null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Model: ${buttonLabel}`}
        className="flex h-9 items-center gap-2 rounded-xl px-3 text-[13.5px] font-medium text-text transition-colors hover:bg-panel aria-expanded:bg-panel"
      >
        {effectiveGroup ? <RailIcon group={effectiveGroup} size={16} /> : null}
        <span className="max-w-[160px] truncate">{buttonLabel}</span>
        {bot?.chat ? <span className="h-1.5 w-1.5 rounded-full bg-accent" title="This chat has its own model" /> : null}
        {open ? <ChevronUp className="h-3.5 w-3.5 text-faint" /> : <ChevronDown className="h-3.5 w-3.5 text-faint" />}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a model for this chat"
          className="absolute right-0 top-11 z-50 flex h-[640px] max-h-[82vh] w-[min(94vw,560px)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl"
        >
          {!lists && loading ? (
            <p className="p-6 text-center text-[13px] text-faint">Loading models…</p>
          ) : !lists && error ? (
            <div className="p-6 text-center text-[13px] text-muted">
              {error}{" "}
              <button type="button" onClick={() => void reload()} className="underline">
                Try again
              </button>
            </div>
          ) : (
            <ModelPickerPanel
              key={bot?.id}
              orgSlug={orgSlug}
              groups={groups}
              value={effective}
              onPick={save}
              pending={pending}
              disabled={!lists?.canEdit}
              header={header}
              onRefresh={() => void reload(true)}
              refreshing={loading}
              className="h-full"
            />
          )}
        </div>
      ) : null}
    </div>
  )
}
