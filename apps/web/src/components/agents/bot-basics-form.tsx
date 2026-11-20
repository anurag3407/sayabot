"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Sparkles, Clock, Plus, Zap } from "lucide-react"
import { updateBotBasicsAction } from "@/lib/actions/agents"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import { RUNTIME_PROMPT_PRESETS, QUICK_RUNTIME_RULES } from "@/lib/curated-bot-templates"

const field =
  "w-full rounded-xl border border-line bg-raised px-3.5 text-[14px] text-text outline-none placeholder:text-faint focus:border-line-strong disabled:opacity-70"

/** The bot's name and system prompt, editable on its page with live runtime update support. */
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
  const [customRule, setCustomRule] = useState("")
  const [saving, startSave] = useTransition()
  const changed = name.trim() !== initialName || systemPrompt.trim() !== initialPrompt.trim()

  const charCount = systemPrompt.length
  const wordCount = systemPrompt.trim() ? systemPrompt.trim().split(/\s+/).length : 0

  function appendRule(rule: string) {
    if (!rule.trim() || !canEdit) return
    setSystemPrompt((prev) => {
      const clean = prev.trim()
      const ruleText = rule.trim()
      if (!clean) return ruleText
      return `${clean}\n\n${ruleText.startsWith("-") ? ruleText : `- ${ruleText}`}`
    })
  }

  function applyPreset(prompt: string) {
    if (!canEdit) return
    setSystemPrompt(prompt)
  }

  function save() {
    setError(null)
    startSave(async () => {
      const result = await updateBotBasicsAction({ orgSlug, agentId, name, systemPrompt })
      if (!result.ok) {
        setError(result.error ?? "Could not save")
        return
      }
      showToast({ message: "Saved · active at runtime" })
      router.refresh()
    })
  }

  return (
    <form
      className="space-y-5 rounded-xl border border-border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (canEdit && changed) save()
      }}
    >
      <div>
        <label htmlFor="bot-edit-name" className="mb-1.5 block text-[13px] font-medium text-muted">
          Name
        </label>
        <input
          id="bot-edit-name"
          value={name}
          maxLength={60}
          disabled={!canEdit}
          onChange={(e) => setName(e.target.value)}
          className={cn(field, "h-11")}
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <label htmlFor="bot-edit-prompt" className="text-[13px] font-medium text-muted">
              System Prompt
            </label>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Active at runtime
            </span>
          </div>

          <span className="font-mono text-[11px] text-faint">
            {charCount.toLocaleString()} chars · {wordCount.toLocaleString()} words
          </span>
        </div>

        <p className="text-[12px] text-faint">
          Defines the persona, instructions, reasoning rules, and constraints. Updates take effect immediately on next turns across all rooms.
        </p>

        {canEdit && (
          <div className="rounded-lg border border-line bg-raised/50 p-2.5 space-y-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-faint flex items-center gap-1 mr-1">
                <Sparkles className="h-3 w-3 text-accent" /> Presets:
              </span>
              {RUNTIME_PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.prompt)}
                  title={preset.tagline}
                  className="rounded-md border border-line bg-card px-2 py-1 text-[11px] text-muted hover:border-line-strong hover:text-text transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-line/60">
              <span className="text-[11px] font-medium text-faint flex items-center gap-1 mr-1">
                <Zap className="h-3 w-3 text-amber-400" /> Quick rules:
              </span>
              {QUICK_RUNTIME_RULES.map((rule, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => appendRule(rule)}
                  className="rounded-md border border-line/80 bg-raised px-2 py-0.5 text-[10.5px] text-faint hover:text-text hover:border-line-strong transition-colors"
                >
                  + {rule.replace(/^- /, "")}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1 border-t border-line/60">
              <input
                type="text"
                value={customRule}
                onChange={(e) => setCustomRule(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    if (customRule.trim()) {
                      appendRule(customRule)
                      setCustomRule("")
                    }
                  }
                }}
                placeholder="Type a custom rule or constraint to append and press Enter..."
                className="h-8 flex-1 rounded-md border border-line bg-card px-2.5 text-[11.5px] text-text placeholder:text-faint outline-none focus:border-line-strong"
              />
              <button
                type="button"
                onClick={() => {
                  if (customRule.trim()) {
                    appendRule(customRule)
                    setCustomRule("")
                  }
                }}
                disabled={!customRule.trim()}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-card px-2.5 text-[11.5px] font-medium text-text hover:border-line-strong disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Append
              </button>
            </div>
          </div>
        )}

        <textarea
          id="bot-edit-prompt"
          value={systemPrompt}
          disabled={!canEdit}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={9}
          placeholder="How should this bot behave? Enter guidelines, persona, reasoning style, and tool preferences..."
          className={cn(field, "font-mono text-[13px] resize-y py-3 leading-relaxed")}
        />
      </div>

      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      {canEdit ? (
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="flex items-center gap-2 text-[12px] text-faint">
            <Clock className="h-3.5 w-3.5 text-muted" />
            <span>Instant runtime sync: changes apply to the very next turn.</span>
          </div>

          <button
            type="submit"
            disabled={saving || !changed || !name.trim()}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-5 text-[13.5px] font-semibold text-void hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save Changes
          </button>
        </div>
      ) : null}
    </form>
  )
}
