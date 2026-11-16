"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { ChevronDown } from "lucide-react"
import { createBotAction } from "@/lib/actions/agents"
import { addAgentToRoom } from "@/lib/actions/rooms"
import { InviteBotDialog } from "@/components/room/invite-bot-dialog"
import {
  choiceLabel,
  ModelPickerPanel,
  RailIcon,
  type ModelValue,
} from "@/components/agents/model-picker-panel"
import type { PickerGroup } from "@/lib/model-catalog"
import { Button } from "@/components/ui/button"
import { Field, HelpText, Select } from "@/components/ui/field"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"

export interface RoomTemplateOption {
  id: string
  name: string
  description: string | null
  category: string | null
}

export interface RoomAgentOption {
  id: string
  handle: string
  displayName: string
}

type Tab = "template" | "existing" | "app"

/**
 * "Runs on" for a new ready-made agent: the same accounts as the model picker (server models,
 * apps on your Mac or the server, API keys). Nothing picked = the workspace's default model.
 */
function RunsOnPicker({
  orgSlug,
  value,
  onChange,
}: {
  orgSlug: string
  value: ModelValue | null
  onChange: (next: ModelValue | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<PickerGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || groups) return
    let cancelled = false
    fetch(`/api/connectors/models?${new URLSearchParams({ org: orgSlug })}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          groups?: PickerGroup[]
          error?: string
        } | null
        if (!response.ok || !body?.groups) throw new Error(body?.error ?? `HTTP ${response.status}`)
        if (!cancelled) setGroups(body.groups)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load models")
      })
    return () => {
      cancelled = true
    }
  }, [open, groups, orgSlug])

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

  const group = value && groups ? groups.find((g) => g.keyId === value.keyId) : undefined
  const label = value && groups ? choiceLabel(groups, value) : "Workspace default"

  return (
    <div ref={ref} className="relative flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-muted">Runs on</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 text-[12px] text-text hover:border-line-strong"
      >
        {group ? <RailIcon group={group} size={13} /> : null}
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-faint" />
      </button>
      {value ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-[12px] text-muted underline underline-offset-4 hover:text-text"
        >
          Use default
        </button>
      ) : null}
      {open ? (
        <div
          role="dialog"
          aria-label="Where new agents run"
          className="absolute left-0 top-10 z-40 h-[520px] max-h-[75vh] w-[min(92vw,540px)] overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl"
        >
          {groups ? (
            <ModelPickerPanel
              orgSlug={orgSlug}
              groups={groups}
              value={value}
              onPick={(next) => {
                onChange(next)
                setOpen(false)
              }}
              className="h-full"
            />
          ) : (
            <p className="p-4 text-[13px] text-muted">{error ?? "Loading models…"}</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Room settings' one "Add agent" control, three ways in: a ready-made specialist (made and added
 * in one click), an agent the workspace already has, or your own app (Claude Code, Cursor…)
 * joining through an invitation.
 */
export function RoomAddAgent({
  orgSlug,
  roomId,
  roomName,
  templates,
  available,
  canCreate,
}: {
  orgSlug: string
  roomId: string
  roomName: string
  templates: RoomTemplateOption[]
  available: RoomAgentOption[]
  /** Workspace admins can make new agents; room admins can only add existing ones. */
  canCreate: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(canCreate && templates.length ? "template" : "existing")
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [agentId, setAgentId] = useState("")
  const [inviting, setInviting] = useState(false)
  const [runsOn, setRunsOn] = useState<ModelValue | null>(null)

  function addTemplate(template: RoomTemplateOption) {
    setPendingId(template.id)
    startTransition(async () => {
      const res = await createBotAction({
        orgSlug,
        name: template.name,
        templateId: template.id,
        roomId,
        keyId: runsOn?.keyId ?? null,
        model: runsOn?.model ?? null,
        effort: runsOn?.effort ?? null,
      })
      setPendingId(null)
      if (!res.ok) {
        showToast({ message: res.error ?? "Could not add the agent", tone: "danger" })
        return
      }
      showToast({ message: `${template.name} joined #${roomName}`, tone: "success" })
      if (res.warning) showToast({ message: res.warning, tone: "warning" })
      router.refresh()
    })
  }

  function addExisting() {
    if (!agentId) return
    startTransition(async () => {
      const form = new FormData()
      form.set("orgSlug", orgSlug)
      form.set("roomId", roomId)
      form.set("agentId", agentId)
      const res = await addAgentToRoom(null, form)
      if (!res.ok) {
        showToast({ message: res.error ?? "Could not add the agent", tone: "danger" })
        return
      }
      setAgentId("")
      showToast({ message: res.message ?? "Agent added", tone: "success" })
      router.refresh()
    })
  }

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "template", label: "Ready-made", show: canCreate && templates.length > 0 },
    { id: "existing", label: "From this workspace", show: true },
    { id: "app", label: "Connect your app", show: true },
  ]

  return (
    <div>
      <div role="tablist" aria-label="Ways to add an agent" className="flex flex-wrap gap-1">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "h-9 rounded-full px-3 text-[13px] transition-colors",
                tab === t.id ? "bg-raised text-text" : "text-muted hover:text-text",
              )}
            >
              {t.label}
            </button>
          ))}
      </div>

      <div className="mt-4">
        {tab === "template" ? (
          <>
            <div className="mb-3">
              <RunsOnPicker orgSlug={orgSlug} value={runsOn} onChange={setRunsOn} />
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {templates.map((template) => (
                <li
                  key={template.id}
                  className="flex flex-col rounded-lg border border-line bg-ink p-3"
                >
                  <p className="text-[14px] font-medium text-text">{template.name}</p>
                  <p className="mt-1 line-clamp-2 flex-1 text-[12px] leading-relaxed text-muted">
                    {template.description ?? template.category ?? ""}
                  </p>
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => addTemplate(template)}
                    >
                      {pendingId === template.id ? "Adding…" : "Add to room"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <HelpText>
              Each one becomes its own agent in this workspace and joins this room, running on the
              choice above. You can change it later with the model button.{" "}
              <Link
                href={`/${orgSlug}/agents/new?room=${roomId}`}
                className="text-accent underline underline-offset-4"
              >
                Make your own instead
              </Link>
            </HelpText>
          </>
        ) : null}

        {tab === "existing" ? (
          available.length === 0 ? (
            <p className="text-[13px] text-muted">
              {canCreate
                ? "Every agent in this workspace is already here. Pick a ready-made one, or "
                : "Every agent in this workspace is already here. A workspace admin can make more, or "}
              connect your own app.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="agent" htmlFor="add-agent">
                <Select
                  id="add-agent"
                  value={agentId}
                  onChange={(event) => setAgentId(event.target.value)}
                >
                  <option value="" disabled>
                    Choose an agent
                  </option>
                  {available.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      @{agent.handle} · {agent.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button variant="primary" disabled={!agentId || pending} onClick={addExisting}>
                {pending ? "Adding…" : "Add agent"}
              </Button>
            </div>
          )
        ) : null}

        {tab === "app" ? (
          <div className="rounded-lg border border-line bg-ink p-4">
            <p className="text-[14px] font-medium text-text">
              Bring Claude Code, Cursor, Codex, Hermes or another app
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              You get a short invitation to send to whoever runs the app. Once it joins, it reads
              this room, replies and takes tasks on its own subscription. It answers while the app
              is open; when it isn&apos;t, the room says so.
            </p>
            <div className="mt-3">
              <Button variant="secondary" onClick={() => setInviting(true)}>
                Create invitation
              </Button>
            </div>
            <InviteBotDialog
              orgSlug={orgSlug}
              roomId={roomId}
              roomName={roomName}
              open={inviting}
              onOpenChange={setInviting}
              hideTrigger
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
