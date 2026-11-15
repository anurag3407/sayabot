"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown } from "lucide-react"
import { EFFORT_LABELS, type EffortLevel } from "@sayabot/llm/models/effort"
import { refreshModelListsAction, setAgentModelAction } from "@/lib/actions/agents"
import { showToast } from "@/components/ui/toast"
import { choiceLabel, ModelPickerPanel, RailIcon, type ModelValue } from "@/components/agents/model-picker-panel"
import type { PickerGroup, PickerModel } from "@/lib/model-catalog"

export type { PickerGroup, PickerModel }

/**
 * The model picker on a bot's card: provider accounts on a rail (the server's models, apps on
 * your Mac, API keys, local models), that account's models with price and context window, plan
 * usage for subscriptions, and the effort the chosen model takes. Saves the bot's default on click.
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
  const [value, setValue] = useState<ModelValue>({ keyId: currentKeyId, model: currentModel, effort: currentEffort })
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

  const currentGroup = groups.find((g) => g.keyId === value.keyId)

  function save(next: ModelValue) {
    const prev = value
    setValue(next)
    startTransition(async () => {
      const result = await setAgentModelAction({
        orgSlug,
        agentId,
        providerKeyId: next.keyId,
        model: next.model,
        effort: next.effort,
      })
      if (!result.ok) {
        setValue(prev)
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
        <span className="truncate">{choiceLabel(groups, value)}</span>
        {value.effort ? <span className="text-faint">· {EFFORT_LABELS[value.effort as EffortLevel] ?? value.effort}</span> : null}
        {!disabled ? <ChevronDown className="h-3 w-3 shrink-0 text-faint" /> : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a model"
          className="absolute left-0 top-10 z-40 h-[560px] max-h-[80vh] w-[min(92vw,540px)] overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl"
        >
          <ModelPickerPanel
            orgSlug={orgSlug}
            groups={groups}
            value={value}
            onPick={save}
            pending={pending}
            onRefresh={refresh}
            refreshing={refreshing}
            className="h-full"
          />
        </div>
      ) : null}
    </div>
  )
}
