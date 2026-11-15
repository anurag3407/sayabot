"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { updateBotBasicsAction } from "@/lib/actions/agents"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"

const field =
  "w-full rounded-xl border border-line bg-raised px-3.5 text-[14px] text-text outline-none placeholder:text-faint focus:border-line-strong disabled:opacity-70"

/** The bot's name and system prompt, editable on its page. */
export function BotBasicsForm({
  orgSlug,
  agentId,
  name: initialName,
  systemPrompt: initialPrompt,
  canEdit,
}: {
  orgSlug: string
  agentId: string
  name: string
  systemPrompt: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [systemPrompt, setSystemPrompt] = useState(initialPrompt)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()
  const changed = name.trim() !== initialName || systemPrompt.trim() !== initialPrompt.trim()

  function save() {
    setError(null)
    startSave(async () => {
      const result = await updateBotBasicsAction({ orgSlug, agentId, name, systemPrompt })
      if (!result.ok) {
        setError(result.error ?? "Could not save")
        return
      }
      showToast({ message: "Saved" })
      router.refresh()
    })
  }

  return (
    <form
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (canEdit && changed) save()
      }}
    >
      <div>
        <label htmlFor="bot-edit-name" className="mb-1.5 block text-[13px] font-medium text-muted">Name</label>
        <input
          id="bot-edit-name"
          value={name}
          maxLength={60}
          disabled={!canEdit}
          onChange={(e) => setName(e.target.value)}
          className={cn(field, "h-11")}
        />
      </div>
      <div>
        <label htmlFor="bot-edit-prompt" className="mb-1.5 block text-[13px] font-medium text-muted">System prompt</label>
        <textarea
          id="bot-edit-prompt"
          value={systemPrompt}
          disabled={!canEdit}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={8}
          placeholder="How should this bot behave?"
          className={cn(field, "resize-y py-3 leading-relaxed")}
        />
      </div>
      {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
      {canEdit ? (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || !changed || !name.trim()}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-5 text-[13.5px] font-semibold text-void hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </button>
        </div>
      ) : null}
    </form>
  )
}
