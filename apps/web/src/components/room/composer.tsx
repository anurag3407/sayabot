"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { sendMessage } from "@/lib/actions/messages"
import { rememberAction } from "@/lib/actions/memory"
import { startMeetingNowAction } from "@/lib/actions/meetings"
import { createTaskAction } from "@/lib/actions/tasks"
import { enqueueOutbox, flushOutbox, readOutbox } from "@/lib/outbox"
import { humanHandle } from "@/lib/human-handle"
import { Button } from "@/components/ui/button"
import { DetailsMenu } from "@/components/ui/details-menu"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { showToast } from "@/components/ui/toast"
import { AlarmClock, ArrowUp, Check, FileText, ListTodo, Paperclip, ShieldCheck, Video } from "lucide-react"
import { cn } from "@/lib/format"
import type { MemberView, RoomAgentView } from "@/lib/types"

/**
 * What a bot does before acting, in one small popover. Risky steps (sending, deleting, running
 * commands, spending) always wait for a person's OK; there is deliberately no "skip approval" mode.
 */
function SafetyChip({ orgSlug }: { orgSlug: string }) {
  return (
    <DetailsMenu
      className="relative"
      summaryLabel="How bots ask before acting"
      summaryClassName="flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-2.5 text-[13px] text-muted transition-colors hover:bg-raised hover:text-text"
      summary={
        <>
          <ShieldCheck className="h-[17px] w-[17px] text-ok" />
          <span className="hidden sm:inline">Ask first</span>
        </>
      }
    >
      <div className="absolute bottom-full left-0 z-20 mb-2 w-[300px] rounded-2xl border border-line-strong bg-panel p-3 shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
        <p className="text-[14px] font-medium text-text">How bots ask before acting</p>
        <div className="mt-2.5 flex gap-2.5 rounded-xl bg-raised/70 p-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[13.5px] font-medium text-text">
              Ask before risky steps
              <Check className="ml-auto h-4 w-4 text-text" aria-label="On" />
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-faint">
              Sending messages, changing files, running commands and spending money wait for your OK.
              Reading and searching just happen.
            </p>
          </div>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-faint">
          A request nobody answers is turned down after a few minutes.
        </p>
        <Link href={`/${orgSlug}/inbox`} className="mt-2 inline-block text-[12.5px] text-accent hover:underline">
          See what is waiting for you
        </Link>
      </div>
    </DetailsMenu>
  )
}

interface MentionState {
  start: number
  end: number
  query: string
  index: number
}

interface MentionOption {
  handle: string
  displayName: string
  group: "agents" | "people"
}

type QuickAction = "task" | "meeting" | "cron"

function draftKey(roomId: string, threadRootId: string | null): string {
  return `mesh:draft:${roomId}:${threadRootId ?? "main"}`
}

function readDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? ""
  } catch {
    return ""
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // Drafts are a convenience; losing storage must not block typing.
  }
}

function QuickActionDialog({
  action,
  orgSlug,
  roomId,
  agents,
  people,
  onClose,
}: {
  action: QuickAction
  orgSlug: string
  roomId: string
  agents: RoomAgentView[]
  people: MemberView[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  function submit(form: FormData) {
    setError(null)
    form.set("orgSlug", orgSlug)
    form.set("roomId", roomId)

    if (action === "cron") {
      const name = form.get("name") as string
      const schedule_expr = form.get("schedule_expr") as string
      const agent_id = form.get("agent_id") as string
      const prompt = form.get("prompt") as string

      startTransition(async () => {
        try {
          const res = await fetch(`/api/workspaces/${orgSlug}/routines`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name,
              schedule_expr,
              agent_id,
              room_id: roomId,
              prompt,
            }),
          })
          const data = await res.json()
          if (!res.ok) {
            setError(data.error || "Failed to create routine")
            return
          }
          showToast({
            message: `Routine '${name}' scheduled (${data.routine?.human_schedule || schedule_expr})`,
            tone: "success",
            action: { label: "View on Canvas", href: `/${orgSlug}/cron` },
          })
          ref.current?.close()
          router.refresh()
        } catch {
          setError("Failed to create routine")
        }
      })
      return
    }

    startTransition(async () => {
      const result =
        action === "task"
          ? await createTaskAction(null, form)
          : await startMeetingNowAction(null, form)
      if (!result.ok) {
        setError(result.error ?? "Something went wrong")
        return
      }
      showToast({
        message: result.message ?? (action === "task" ? "Task created" : "Meeting started"),
        tone: "success",
        action: action === "task" ? { label: "View tasks", href: `/${orgSlug}/tasks` } : undefined,
      })
      ref.current?.close()
      router.refresh()
    })
  }

  return (
    <dialog
      ref={ref}
      className="m-auto w-[min(480px,92vw)] rounded-md border border-line-strong bg-panel p-0 text-text backdrop:bg-void/75"
      onClose={onClose}
      aria-label={action === "task" ? "New task" : "Start a meeting"}
    >
      <form action={submit} className="space-y-3 p-4">
        <h2 className="text-[15px] font-medium">
          {action === "task"
            ? "New task in this room"
            : action === "meeting"
              ? "Start a meeting in this room"
              : "Schedule a routine (cron) in this room"}
        </h2>
        {action === "task" ? (
          <>
            <input type="hidden" name="kind" value="task" />
            <Field label="title" htmlFor="quick-task-title">
              <Input id="quick-task-title" name="title" required minLength={2} maxLength={120} autoFocus />
            </Field>
            <Field label="assignee" htmlFor="quick-task-assignee" hint="optional">
              <Select id="quick-task-assignee" name="assignee" defaultValue="">
                <option value="">Unassigned</option>
                {people.length ? (
                  <optgroup label="People">
                    {people.map((person) => (
                      <option key={person.userId} value={`user:${person.userId}`}>
                        {person.displayName}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {agents.length ? (
                  <optgroup label="Agents">
                    {agents.map(({ agent }) => (
                      <option key={agent.id} value={`agent:${agent.id}`}>
                        @{agent.handle}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </Select>
            </Field>
            <Field label="description" htmlFor="quick-task-description" hint="optional">
              <Textarea id="quick-task-description" name="description" rows={3} />
            </Field>
          </>
        ) : action === "meeting" ? (
          <>
            <Field label="title" htmlFor="quick-meeting-title">
              <Input id="quick-meeting-title" name="title" required maxLength={80} defaultValue="Stand-up" autoFocus />
            </Field>
            <Field label="length" htmlFor="quick-meeting-length">
              <Select id="quick-meeting-length" name="durationMinutes" defaultValue="15">
                {[10, 15, 30, 45, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="agenda" htmlFor="quick-meeting-agenda" hint="optional">
              <Textarea id="quick-meeting-agenda" name="agenda" rows={2} className="min-h-16" />
            </Field>
            <p className="text-[12px] leading-relaxed text-muted">
              Every agent in the room will reply, one at a time. This uses your API credits.
            </p>
          </>
        ) : (
          <>
            <Field label="Routine Name" htmlFor="quick-cron-name">
              <Input
                id="quick-cron-name"
                name="name"
                required
                minLength={2}
                maxLength={100}
                defaultValue="Daily Standup"
                autoFocus
              />
            </Field>
            <Field
              label="Schedule"
              htmlFor="quick-cron-schedule"
              hint="e.g. daily at 9am, every 2h, 0 9 * * 1-5"
            >
              <Input
                id="quick-cron-schedule"
                name="schedule_expr"
                required
                defaultValue="daily at 9am"
              />
            </Field>
            <Field label="Target Agent" htmlFor="quick-cron-agent">
              <Select
                id="quick-cron-agent"
                name="agent_id"
                defaultValue={agents[0]?.agent.id || ""}
              >
                {agents.map(({ agent }) => (
                  <option key={agent.id} value={agent.id}>
                    @{agent.handle} ({agent.displayName})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Task Prompt / Instructions" htmlFor="quick-cron-prompt">
              <Textarea
                id="quick-cron-prompt"
                name="prompt"
                rows={3}
                required
                defaultValue="Summarize uncompleted tasks, report progress, and plan next actions."
              />
            </Field>
          </>
        )}
        {error ? (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : action === "task" ? "Create task" : "Start meeting"}
          </Button>
        </div>
      </form>
    </dialog>
  )
}

export function Composer({
  orgSlug,
  roomId,
  threadRootId = null,
  agents,
  people = [],
  selfId,
  canAdmin = false,
  roomKind = "public",
  placeholder,
  compact = false,
  autoFocus = false,
  onTyping,
  onSent,
  onShowCanvas,
}: {
  orgSlug: string
  roomId: string
  threadRootId?: string | null
  agents: RoomAgentView[]
  people?: MemberView[]
  selfId?: string
  canAdmin?: boolean
  roomKind?: "public" | "private" | "dm"
  placeholder: string
  compact?: boolean
  autoFocus?: boolean
  onTyping?: () => void
  onSent?: () => void
  onShowCanvas?: () => void
}) {
  const router = useRouter()
  const storageKey = draftKey(roomId, threadRootId)
  const [value, setValue] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [mention, setMention] = useState<MentionState | null>(null)
  const [outboxCount, setOutboxCount] = useState(0)
  const [quickAction, setQuickAction] = useState<QuickAction | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const baseId = useId()
  const listboxId = `${baseId}-mentions`

  function handleFileSelect(file: File) {
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setError("Please select a PDF file.")
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("PDF exceeds 8MB limit for chat attachment.")
      return
    }
    setError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      if (dataUrl) {
        const cleanName = file.name.replace(/[[\]]/g, "")
        const snippet = `[${cleanName}](${dataUrl})\n`
        updateValue(value ? `${value}\n\n${snippet}` : snippet)
        showToast({ message: `Attached ${cleanName}`, tone: "success" })
        textareaRef.current?.focus()
      }
    }
    reader.onerror = () => {
      setError("Failed to read the selected file.")
    }
    reader.readAsDataURL(file)
  }

  useEffect(() => {
    setValue(readDraft(storageKey))
  }, [storageKey])

  const others = people.filter((person) => person.userId !== selfId)

  const options: MentionOption[] = mention
    ? [
        ...(agents.length > 1
          ? [{ handle: "all_bots", displayName: "every agent in the room", group: "agents" as const }]
          : []),
        ...agents.map(({ agent }) => ({
          handle: agent.handle,
          displayName: agent.displayName,
          group: "agents" as const,
        })),
        ...others.map((person) => ({
          handle: humanHandle(person.displayName),
          displayName: person.displayName,
          group: "people" as const,
        })),
      ].filter((option) => {
        const query = mention.query.toLowerCase()
        return (
          !query ||
          option.handle.toLowerCase().includes(query) ||
          option.displayName.toLowerCase().includes(query)
        )
      })
    : []
  const activeOptionId =
    mention && options.length ? `${listboxId}-${mention.index % options.length}` : undefined

  const refreshOutbox = async () => {
    const items = await readOutbox()
    setOutboxCount(items.filter((item) => item.roomId === roomId).length)
  }

  useEffect(() => {
    void refreshOutbox()
    const flush = async () => {
      if (!navigator.onLine) return
      const result = await flushOutbox()
      if (result.sent) await refreshOutbox()
    }
    void flush()
    const onOnline = () => void flush()
    window.addEventListener("online", onOnline)
    return () => window.removeEventListener("online", onOnline)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "0px"
    const max = compact ? 160 : 220
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 40), max)}px`
  }, [value, compact])

  function updateValue(next: string) {
    setValue(next)
    writeDraft(storageKey, next)
  }

  function clearIfUnchanged(sent: string) {
    setValue((current) => {
      const next = current.trim() === sent ? "" : current
      writeDraft(storageKey, next)
      return next
    })
  }

  function updateMention(nextValue: string, caret: number) {
    const before = nextValue.slice(0, caret)
    const match = /(^|[\s(])@([a-zA-Z0-9_-]*)$/.exec(before)
    if (!match) {
      setMention(null)
      return
    }
    setMention({
      start: caret - (match[2]?.length ?? 0) - 1,
      end: caret,
      query: match[2] ?? "",
      index: 0,
    })
  }

  function insertMention(handle: string) {
    if (!mention) return
    const next = `${value.slice(0, mention.start)}@${handle} ${value.slice(mention.end)}`
    updateValue(next)
    setMention(null)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      const caret = mention.start + handle.length + 2
      textarea.focus()
      textarea.setSelectionRange(caret, caret)
    })
  }

  async function queueOffline(content: string) {
    const id = crypto.randomUUID()
    await enqueueOutbox({
      id,
      orgSlug,
      roomId,
      content,
      threadRootId,
      createdAt: new Date().toISOString(),
    })
    await refreshOutbox()
    setNotice("Saved. It will send when you are back online.")
  }

  async function send() {
    const content = value.trim()
    if (!content || pending) return
    setError(null)
    setNotice(null)

    if (content.startsWith("/cron")) {
      const remainder = content.slice("/cron".length).trim()
      if (!remainder || remainder === "list") {
        router.push(`/${orgSlug}/cron`)
        clearIfUnchanged(content)
        return
      }
      setQuickAction("cron")
      clearIfUnchanged(content)
      return
    }

    if (content.startsWith("/remember ")) {
      const memoryText = content.slice("/remember ".length).trim()
      if (!memoryText) {
        setError("Please provide memory text: /remember <fact or decision>")
        return
      }
      setPending(true)
      try {
        const result = await rememberAction({
          orgSlug,
          roomId,
          body: memoryText,
        })
        if (!result.ok) {
          setError(result.error ?? "Failed to save memory")
        } else {
          clearIfUnchanged(content)
          setNotice("Saved to team memory")
          showToast({ message: "Saved to room memory", tone: "success" })
        }
      } catch {
        setError("Failed to save memory")
      } finally {
        setPending(false)
      }
      return
    }

    setPending(true)
    if (!navigator.onLine) {
      try {
        await queueOffline(content)
        clearIfUnchanged(content)
      } catch {
        setError("Could not save this message for later in this browser.")
      } finally {
        setPending(false)
      }
      return
    }
    try {
      const result = await sendMessage({ orgSlug, roomId, content, threadRootId })
      if (!result.ok) {
        setError(result.error ?? "Message could not be sent")
      } else {
        clearIfUnchanged(content)
        if (result.warning) setNotice(result.warning)
        onSent?.()
      }
    } catch {
      try {
        await queueOffline(content)
        clearIfUnchanged(content)
      } catch {
        setError("Connection lost, and this message could not be saved for later.")
      }
    } finally {
      setPending(false)
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return
    if (mention && options.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setMention({ ...mention, index: (mention.index + 1) % options.length })
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setMention({ ...mention, index: (mention.index - 1 + options.length) % options.length })
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        const option = options[mention.index % options.length]
        if (option) insertMention(option.handle)
        return
      }
      if (event.key === "Escape") {
        setMention(null)
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const showQuickActions = !threadRootId
  const toolButton =
    "grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-raised hover:text-text"

  return (
    <div className={cn("relative", compact ? "px-3 pb-3 pt-2" : "px-3 pb-3 pt-2 md:px-4 md:pb-4")}>
      {mention && options.length ? (
        <div
          className="absolute bottom-full left-3 z-10 mb-1 max-h-56 w-72 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl border border-line-strong bg-panel py-1 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
          id={listboxId}
          role="listbox"
          aria-label="Mention an agent or a person"
        >
          {options.map((option, index) => (
            <div key={`${option.group}-${option.handle}`}>
              {index === 0 || options[index - 1]?.group !== option.group ? (
                <p className="px-3 py-1 text-[11px] font-medium text-faint">{option.group}</p>
              ) : null}
              <button
                type="button"
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === mention.index % options.length}
                onMouseDown={(event) => {
                  event.preventDefault()
                  insertMention(option.handle)
                }}
                className={cn(
                  "flex w-full items-baseline justify-between gap-3 px-2 py-2 text-left md:py-1.5",
                  index === mention.index % options.length
                    ? "bg-raised text-text"
                    : "text-muted hover:bg-raised",
                )}
              >
                <span className="truncate text-[13px] text-text">{option.displayName}</span>
                <span className="truncate text-[12px] text-faint">@{option.handle}</span>
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            handleFileSelect(file)
            e.target.value = ""
          }
        }}
      />

      <div
        className={cn(
          "relative flex flex-col rounded-[24px] border border-line bg-panel/70 px-2 pb-2 pt-1.5 transition-colors focus-within:border-line-strong",
          isDragging && "ring-2 ring-accent bg-accent-soft/30",
        )}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setIsDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          const file = e.dataTransfer.files?.[0]
          if (file) handleFileSelect(file)
        }}
      >
        {isDragging ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[28px] bg-panel/90 text-[14px] text-accent backdrop-blur-xs">
            Drop PDF to attach to message
          </div>
        ) : null}

        <label htmlFor={`${baseId}-input`} className="sr-only">
          {placeholder}
        </label>
        <textarea
          id={`${baseId}-input`}
          data-testid="composer"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={Boolean(mention && options.length)}
          aria-controls={mention && options.length ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          ref={textareaRef}
          value={value}
          autoFocus={autoFocus}
          rows={1}
          maxLength={100_000}
          spellCheck
          placeholder={placeholder}
          title="@ to mention, Enter to send, Shift+Enter for a new line"
          onChange={(event) => {
            const next = event.target.value
            updateValue(next)
            updateMention(next, event.target.selectionStart ?? next.length)
            onTyping?.()
          }}
          onSelect={(event) =>
            updateMention(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)
          }
          onKeyDown={onKeyDown}
          onBlur={() => window.setTimeout(() => setMention(null), 120)}
          className="block max-h-[220px] min-h-10 w-full resize-none bg-transparent px-2 py-[9px] text-[15px] leading-[22px] text-text outline-none placeholder:text-faint"
        />
        <div className="flex items-center gap-0.5">
          {showQuickActions ? (
            <>
              <button
                type="button"
                className={toolButton}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach a PDF"
                title="Attach a PDF"
              >
                <Paperclip className="h-[17px] w-[17px]" />
              </button>
              <button
                type="button"
                className={toolButton}
                onClick={() => setQuickAction("task")}
                aria-label="Add a to-do"
                title="Add a to-do"
              >
                <ListTodo className="h-[17px] w-[17px]" />
              </button>
              <button
                type="button"
                className={cn(toolButton, "w-auto gap-1.5 px-2.5 text-[13px]")}
                onClick={() => setQuickAction("cron")}
                title="Do this on a schedule"
              >
                <AlarmClock className="h-[17px] w-[17px]" />
                <span className="hidden sm:inline">Schedule</span>
              </button>
              {canAdmin && roomKind !== "dm" ? (
                <button
                  type="button"
                  className={toolButton}
                  onClick={() => setQuickAction("meeting")}
                  aria-label="Start a meeting"
                  title="Start a meeting"
                >
                  <Video className="h-[17px] w-[17px]" />
                </button>
              ) : null}
              {onShowCanvas ? (
                <button
                  type="button"
                  className={toolButton}
                  onClick={onShowCanvas}
                  aria-label="Open canvas"
                  title="Open canvas"
                >
                  <FileText className="h-[17px] w-[17px]" />
                </button>
              ) : null}
              <SafetyChip orgSlug={orgSlug} />
            </>
          ) : null}
          <span className="flex-1" />
          {value.length > 90_000 ? (
            <span className="mr-2 font-mono text-[11px] text-warn">{value.length}/100000</span>
          ) : null}
        <button
          type="button"
          data-testid="send-message"
          aria-label={pending ? "Sending" : "Send message"}
          title="Send"
          onClick={() => void send()}
          disabled={pending || !value.trim()}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-text text-void transition-all hover:scale-105 hover:bg-white disabled:cursor-not-allowed disabled:bg-raised disabled:text-faint disabled:hover:scale-100"
        >
          <ArrowUp className="h-[18px] w-[18px]" aria-hidden />
        </button>
        </div>
      </div>

      {error || notice || outboxCount > 0 ? (
        <div className="mt-2 space-y-1.5">
          {error ? (
            <p role="alert" className="text-[12px] text-danger">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-[12px] text-warn">
              {notice}
            </p>
          ) : null}
          {outboxCount > 0 ? (
            <p className="font-mono text-[11px] text-faint">
              {outboxCount} {outboxCount === 1 ? "message" : "messages"} waiting to send
            </p>
          ) : null}
        </div>
      ) : null}

      {quickAction ? (
        <QuickActionDialog
          action={quickAction}
          orgSlug={orgSlug}
          roomId={roomId}
          agents={agents}
          people={others}
          onClose={() => setQuickAction(null)}
        />
      ) : null}
    </div>
  )
}
