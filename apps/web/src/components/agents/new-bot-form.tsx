"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { createBotAction } from "@/lib/actions/agents"
import { Mascot } from "@/components/ui/mascot"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"

export interface BotTemplate {
  id: string
  name: string
  systemPrompt: string
}

const field =
  "w-full rounded-xl border border-line bg-raised px-3.5 text-[14.5px] text-text outline-none placeholder:text-faint focus:border-line-strong"
const label = "mb-2 block text-[13px] font-medium text-muted"

/**
 * New bot: a name and a system prompt, nothing else. The AI it runs on, its skills and the rest
 * are set later from its chat or its page, and both of these can be changed there too.
 */
export function NewBotForm({
  orgSlug,
  initialTemplate,
  roomId,
  roomName,
}: {
  orgSlug: string
  /** From the Marketplace: start from this template's name and prompt. */
  initialTemplate?: BotTemplate
  /** From a group chat's "Add bot": the new bot joins that chat too. */
  roomId?: string
  roomName?: string
}) {
  const router = useRouter()
  const [name, setName] = useState(initialTemplate?.name ?? "")
  const [systemPrompt, setSystemPrompt] = useState(initialTemplate?.systemPrompt ?? "")
  const [error, setError] = useState<string | null>(null)
  const [creating, startCreate] = useTransition()

  function create() {
    setError(null)
    if (!name.trim()) {
      setError("Give your bot a name")
      return
    }
    startCreate(async () => {
      const result = await createBotAction({
        orgSlug,
        name,
        instructions: systemPrompt,
        templateId: initialTemplate?.id ?? null,
        roomId: roomId ?? null,
      })
      if (!result.ok) {
        setError(result.error ?? "Could not make the bot")
        return
      }
      if (result.warning) showToast({ message: result.warning })
      const path = typeof result.data?.path === "string" ? result.data.path : `/${orgSlug}`
      router.push(path)
      router.refresh()
    })
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-24 pt-12 sm:px-6">
      <div className="mb-8 flex items-center gap-4">
        <Mascot
          seed={name.trim() || "new bot"}
          mood={name.trim() ? "happy" : "idle"}
          className="h-16 w-16 shrink-0"
        />
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-text">New bot</h1>
          <p className="mt-0.5 text-[14px] text-faint">
            {roomName
              ? `It will join ${roomName} and get its own chat with you.`
              : "You can change all of this later."}
          </p>
        </div>
      </div>

      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault()
          create()
        }}
      >
        <div>
          <label htmlFor="bot-name" className={label}>
            Name
          </label>
          <input
            id="bot-name"
            autoFocus
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Research Buddy"
            className={cn(field, "h-12 text-[16px]")}
          />
        </div>

        <div>
          <label htmlFor="bot-prompt" className={label}>
            System prompt <span className="text-faint">(optional)</span>
          </label>
          <textarea
            id="bot-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={6}
            placeholder="You help me research topics and write short, clear summaries with sources."
            className={cn(field, "resize-y py-3 leading-relaxed")}
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-[13.5px] text-danger"
          >
            {error}
          </p>
        ) : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-6 text-[14.5px] font-semibold text-void transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {creating ? "Making your bot…" : "Create bot"}
          </button>
        </div>
      </form>
    </div>
  )
}
