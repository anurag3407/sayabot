"use client"

import { useState, useTransition } from "react"
import { deleteOwnerFactAction, saveOwnerFactAction } from "@/lib/actions/facts"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { PlusIcon } from "@/components/ui/icons"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import type { OwnerFactView } from "@/lib/types"

interface RoomOption {
  id: string
  name: string
}

function FactForm({
  orgSlug,
  rooms,
  fact,
  onDone,
}: {
  orgSlug: string
  rooms: RoomOption[]
  fact?: OwnerFactView
  onDone: () => void
}) {
  const [label, setLabel] = useState(fact?.label ?? "")
  const [value, setValue] = useState(fact?.value ?? "")
  const [scope, setScope] = useState<string>(fact ? (fact.roomId ?? "") : (rooms[0]?.id ?? ""))
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await saveOwnerFactAction({
        orgSlug,
        id: fact?.id,
        label,
        value,
        roomId: scope || null,
      })
      if (!result.ok) {
        setError(result.error ?? "Could not save")
        return
      }
      showToast({ tone: "success", message: result.message ?? "Saved" })
      onDone()
    })
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-ink p-3">
      <Input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        placeholder="What is it? e.g. Start date"
        disabled={Boolean(fact)}
        aria-label="Name"
      />
      <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder="Your answer" aria-label="Answer" />
      <Select value={scope} onChange={(event) => setScope(event.target.value)} aria-label="Which bots can read it">
        <option value="">Every room in this workspace</option>
        {rooms.map((room) => (
          <option key={room.id} value={room.id}>
            Only #{room.name}
          </option>
        ))}
      </Select>
      {error ? <p className="text-[12px] text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={pending || !label.trim() || !value.trim()} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * Everything the person has already told their bots. Bots read this before asking, so a
 * fact here is never asked again. Facts bots found themselves are marked unconfirmed.
 */
export function FactsPanel({
  orgSlug,
  facts,
  rooms,
  onChanged,
}: {
  orgSlug: string
  facts: OwnerFactView[]
  rooms: RoomOption[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [pending, startTransition] = useTransition()

  function forget(fact: OwnerFactView) {
    startTransition(async () => {
      const result = await deleteOwnerFactAction({ orgSlug, id: fact.id })
      showToast({ tone: result.ok ? "neutral" : "danger", message: result.ok ? `Forgot "${fact.label}"` : (result.error ?? "Could not delete") })
      if (result.ok) onChanged()
    })
  }

  return (
    <section aria-labelledby="facts-heading" className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="facts-heading" className="text-[15px] font-medium text-text">
          What your agents know
        </h2>
        <Button size="icon-sm" variant="ghost" aria-label="Add a fact" onClick={() => setAdding(true)}>
          <PlusIcon width={14} height={14} />
        </Button>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-faint">
        Answers you gave once. Agents read these first, so they never ask you the same thing twice.
      </p>

      {adding ? (
        <div className="mt-3">
          <FactForm
            orgSlug={orgSlug}
            rooms={rooms}
            onDone={() => {
              setAdding(false)
              onChanged()
            }}
          />
        </div>
      ) : null}

      {facts.length === 0 && !adding ? (
        <p className="mt-4 rounded-lg bg-ink p-3 text-[13px] text-muted">
          Nothing yet. When you answer an agent&apos;s question, the answer is kept here.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {facts.map((fact) =>
            editing === fact.id ? (
              <li key={fact.id} className="py-2">
                <FactForm
                  orgSlug={orgSlug}
                  rooms={rooms}
                  fact={fact}
                  onDone={() => {
                    setEditing(null)
                    onChanged()
                  }}
                />
              </li>
            ) : (
              <li key={fact.id} className="group py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12px] text-faint">{fact.label}</p>
                    <p className="break-words text-[14px] text-text">{fact.value}</p>
                    <p className="mt-0.5 text-[11px] text-faint">
                      {fact.roomName ? `#${fact.roomName}` : "Every room"}
                      {fact.source === "agent" ? (
                        <span className="text-warn">
                          {" "}
                          · found by @{fact.sourceAgentHandle ?? "an agent"}, not confirmed
                        </span>
                      ) : null}
                      {fact.note ? ` · ${fact.note}` : ""}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "flex shrink-0 gap-1 transition-opacity",
                      "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
                    )}
                  >
                    <Button size="sm" variant="quiet" onClick={() => setEditing(fact.id)}>
                      {fact.source === "agent" ? "Confirm" : "Edit"}
                    </Button>
                    <Button size="sm" variant="quiet" disabled={pending} onClick={() => forget(fact)}>
                      Forget
                    </Button>
                  </div>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}
