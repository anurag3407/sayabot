"use client"

import { useState, useTransition } from "react"
import { setAgentWhenMacOffAction } from "@/lib/actions/agents"
import { Select } from "@/components/ui/field"
import { showToast } from "@/components/ui/toast"

const OPTIONS: Array<[string, string, string]> = [
  ["auto", "Answer from Sayabot, or wait", "Uses this bot's API key or Sayabot's own model when it has one; otherwise waits for your Mac."],
  ["server", "Answer from Sayabot", "Replies right away from the server while your Mac is off."],
  ["wait", "Wait for my Mac", "Keeps the message for up to 15 minutes and answers once Sayabot for Mac is open again."],
  ["fail", "Tell me it's off", "Says your Mac is off, so you can open it and retry."],
]

/** For a bot that runs on someone's Mac: what happens to a message while that Mac is off. */
export function MacOffForm({
  orgSlug,
  agentId,
  value,
  canEdit,
}: {
  orgSlug: string
  agentId: string
  value: string
  canEdit: boolean
}) {
  const [choice, setChoice] = useState(value)
  const [pending, startTransition] = useTransition()
  const help = OPTIONS.find(([id]) => id === choice)?.[2]

  return (
    <div className="mt-3 space-y-1.5">
      <label className="block text-xs text-muted-foreground" htmlFor="when-mac-off">
        When your Mac is off
      </label>
      <Select
        id="when-mac-off"
        value={choice}
        disabled={!canEdit || pending}
        onChange={(event) => {
          const next = event.target.value
          const prev = choice
          setChoice(next)
          startTransition(async () => {
            const result = await setAgentWhenMacOffAction({ orgSlug, agentId, whenMacOff: next })
            if (!result.ok) setChoice(prev)
            showToast({ tone: result.ok ? "success" : "danger", message: result.ok ? (result.message ?? "Saved") : (result.error ?? "Could not save") })
          })
        }}
      >
        {OPTIONS.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </Select>
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  )
}
