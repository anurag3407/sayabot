"use client"

import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { sendMessage } from "@/lib/actions/messages"
import { rememberAction } from "@/lib/actions/memory"
import { startMeetingNowAction } from "@/lib/actions/meetings"
import { createTaskAction } from "@/lib/actions/tasks"
import { setRoomExecutionModeAction } from "@/lib/actions/room-state"
import { MODEL_PICKER_EVENT } from "@/lib/recovery-hint"
import { parseSlashCommand, slashSuggestions, type SlashCommand } from "@/lib/slash-commands"
import { enqueueOutbox, flushOutbox, readOutbox } from "@/lib/outbox"
import { humanHandle } from "@/lib/human-handle"
import { Button } from "@/components/ui/button"
import { DetailsMenu } from "@/components/ui/details-menu"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { showToast } from "@/components/ui/toast"
import { RoomModelPicker } from "@/components/room/model-picker/room-model-picker"
import { DictationButton } from "@/components/voice"
import {
  AlarmClock,
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  FileText,
  Lock,
  ListTodo,
  Paperclip,
  Plus,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Video,
} from "lucide-react"
import { cn } from "@/lib/format"
import type { MemberView, RoomAgentView, RoomExecutionMode } from "@/lib/types"

const MODES: {
  id: RoomExecutionMode
  label: string
  detail: string
  icon: typeof ShieldCheck
  tone: string
}[] = [
  {
    id: "review_all",
    label: "Request review",
    detail: "Every step waits for your OK, even reading and searching.",
    icon: Eye,
    tone: "text-accent",
  },
  {
    id: "ask_risky",
    label: "Default",
    detail: "Asks before sensitive steps: running commands, changing files, sending, spending.",
    icon: Lock,
    tone: "text-ok",
  },
  {
    id: "auto",
    label: "Auto",
    detail: "On your Mac, read-only commands run on their own; anything that changes things asks.",
    icon: Shield,
    tone: "text-ok",
  },
  {
    id: "turbo",
    label: "Turbo",
    detail:
      "Every command and tool runs without asking, including ones that send or change the workspace. Only for bots you trust.",
    icon: ShieldAlert,
    tone: "text-warn",
  },
]

/**
 * Execution mode, right in the composer, like a local coding agent's permissions. Auto loosens
 * read-only commands on the Mac of whoever picks it (another member's pick never loosens your
 * Mac); risky server tools still ask. Turbo runs every command and tool in this room without
 * a review.
 */
function ExecutionModeMenu({
  orgSlug,
  roomId,
  initial,
}: {
  orgSlug: string
  roomId: string
  initial: RoomExecutionMode
}) {
  const [mode, setMode] = useState<RoomExecutionMode>(initial)
  const [pending, startTransition] = useTransition()
  useEffect(() => setMode(initial), [initial])
  const current = MODES.find((item) => item.id === mode) ?? MODES[1]!
  const Icon = current.icon

  function choose(next: RoomExecutionMode) {
    if (next === mode) return
    const before = mode
    setMode(next)
    startTransition(async () => {
      const result = await setRoomExecutionModeAction({ orgSlug, roomId, mode: next })
      if (!result.ok) {
        setMode(before)
        showToast({ tone: "danger", message: result.error ?? "Could not change the mode" })
      }
    })
  }

  return (
    <DetailsMenu
      className="relative"
      summaryLabel={`Permissions: ${current.label}`}
      summaryClassName={cn(
        "flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-muted transition-colors hover:bg-white/[0.06] hover:text-text",
        pending && "opacity-70",
      )}
      summary={
        <>
          <Icon className={cn("h-4 w-4", current.tone)} aria-hidden="true" />
          <span className="hidden sm:inline">{current.label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-faint" aria-hidden="true" />
        </>
      }
    >
      <div
        role="menu"
        aria-label="Permissions"
        className="surface-pop pop-in absolute bottom-full right-0 z-30 mb-2 w-[min(340px,86vw)] rounded-2xl p-1.5"
      >
        <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-faint">Permissions</p>
        {MODES.map((item) => {
          const ItemIcon = item.icon
          const active = item.id === mode
          return (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => choose(item.id)}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.05]",
                active && "bg-white/[0.04]",
              )}
            >
              <ItemIcon
                className={cn(
                  "mt-0.5 h-[18px] w-[18px] shrink-0",
                  active ? item.tone : "text-muted",
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[13.5px] font-medium text-text">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-faint">
                  {item.detail}
                </span>
              </span>
              {active ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-text" aria-hidden="true" />
              ) : null}
            </button>
          )
        })}
        <div className="mt-1 border-t border-line px-2.5 pb-1.5 pt-2 text-[11.5px] leading-relaxed text-faint">
          Auto and Turbo apply to bots on your own Mac, and only when you pick them. Sending
          messages, posting and spending always ask.{" "}
          <Link href={`/${orgSlug}/inbox`} className="text-accent hover:underline">
            See what&apos;s waiting
          </Link>
        </div>
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
  initialText = "",
  onClose,
}: {
  action: QuickAction
  orgSlug: string
  roomId: string
  agents: RoomAgentView[]
  people: MemberView[]
  /** Text typed after /todo or /schedule, used as the title or the routine's instructions. */
  initialText?: string
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
              <Input
                id="quick-task-title"
                name="title"
                required
                minLength={2}
                maxLength={120}
                defaultValue={initialText.slice(0, 120)}
                autoFocus
              />
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
              <Input
                id="quick-meeting-title"
                name="title"
                required
                maxLength={80}
                defaultValue="Stand-up"
                autoFocus
              />
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
                defaultValue={
                  initialText ||
                  "Summarize uncompleted tasks, report progress, and plan next actions."
                }
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
  executionMode = "ask_risky",
  placeholder,
  compact = false,
  autoFocus = false,
  onTyping,
  onSent,
  onShowCanvas,
  onStop,
}: {
  orgSlug: string
  roomId: string
  threadRootId?: string | null
  agents: RoomAgentView[]
  people?: MemberView[]
  selfId?: string
  canAdmin?: boolean
  roomKind?: "public" | "private" | "dm"
  executionMode?: RoomExecutionMode
  placeholder: string
  compact?: boolean
  autoFocus?: boolean
  onTyping?: () => void
  onSent?: () => void
  onShowCanvas?: () => void
  /** Stops the run in progress (/stop); absent when nothing can be stopped from here. */
  onStop?: () => void
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
  const [quickText, setQuickText] = useState("")
  const [slashIndex, setSlashIndex] = useState(0)
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
          ? [
              {
                handle: "all_bots",
                displayName: "every agent in the room",
                group: "agents" as const,
              },
            ]
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
  // The "/" menu, while the first word of the message is still being typed.
  const slashOptions = mention ? [] : slashSuggestions(value)
  const slashOpen = slashOptions.length > 0
  const activeOptionId =
    mention && options.length
      ? `${listboxId}-${mention.index % options.length}`
      : slashOpen
        ? `${listboxId}-slash-${slashIndex % slashOptions.length}`
        : undefined

  function pickSlash(command: SlashCommand) {
    setSlashIndex(0)
    if (!command.args) {
      void runSlash(command, "", `/${command.name}`)
      return
    }
    updateValue(`/${command.name} `)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    })
  }

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

    const slash = parseSlashCommand(content)
    if (slash) {
      await runSlash(slash.command, slash.rest, content)
      return
    }

    await deliver(content)
  }

  /** Runs a "/" command. `typed` is the composer text, cleared once the command is handled. */
  async function runSlash(command: SlashCommand, rest: string, typed: string) {
    setError(null)
    setNotice(null)
    switch (command.name) {
      case "goal":
      case "btw":
        if (!rest) {
          setError(
            command.name === "goal"
              ? "Say what to achieve: /goal <what to achieve>"
              : "Add the note: /btw <note>",
          )
          return
        }
        await deliver(rest, command.name, typed)
        return
      case "stop":
        clearIfUnchanged(typed)
        if (onStop) onStop()
        else showToast({ message: "Nothing is running right now" })
        return
      case "model":
        clearIfUnchanged(typed)
        window.dispatchEvent(new Event(MODEL_PICKER_EVENT))
        return
      case "todo":
      case "schedule":
        if (command.name === "schedule" && rest === "list") {
          router.push(`/${orgSlug}/cron`)
          clearIfUnchanged(typed)
          return
        }
        setQuickText(rest)
        setQuickAction(command.name === "todo" ? "task" : "cron")
        clearIfUnchanged(typed)
        return
      case "remember": {
        if (!rest) {
          setError("Add the fact: /remember <fact or decision>")
          return
        }
        setPending(true)
        try {
          const result = await rememberAction({ orgSlug, roomId, body: rest })
          if (!result.ok) {
            setError(result.error ?? "Failed to save memory")
          } else {
            clearIfUnchanged(typed)
            showToast({ message: "Saved to room memory", tone: "success" })
          }
        } catch {
          setError("Failed to save memory")
        } finally {
          setPending(false)
        }
        return
      }
    }
  }

  /** Sends a message (or a /goal or /btw), queuing it offline when there is no connection. */
  async function deliver(content: string, command: "goal" | "btw" | null = null, typed = content) {
    setPending(true)
    if (!navigator.onLine) {
      try {
        await queueOffline(content)
        clearIfUnchanged(typed)
      } catch {
        setError("Could not save this message for later in this browser.")
      } finally {
        setPending(false)
      }
      return
    }
    try {
      const result = await sendMessage({ orgSlug, roomId, content, threadRootId, command })
      if (!result.ok) {
        setError(result.error ?? "Message could not be sent")
      } else {
        clearIfUnchanged(typed)
        if (result.warning) setNotice(result.warning)
        else if (command === "goal")
          setNotice(
            "Goal set. The bot keeps working round by round until it's done; /stop ends it.",
          )
        else if (command === "btw")
          setNotice("Noted. The bots will see it without being interrupted.")
        onSent?.()
      }
    } catch {
      try {
        await queueOffline(content)
        clearIfUnchanged(typed)
      } catch {
        setError("Connection lost, and this message could not be saved for later.")
      }
    } finally {
      setPending(false)
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return
    if (slashOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setSlashIndex((index) => (index + step + slashOptions.length) % slashOptions.length)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        const command = slashOptions[slashIndex % slashOptions.length]
        if (command) pickSlash(command)
        return
      }
      if (event.key === "Escape") {
        updateValue("")
        return
      }
    }
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
  const menuItem =
    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] text-muted transition-colors hover:bg-white/[0.05] hover:text-text"

  return (
    <div className={cn("relative", compact ? "px-3 pb-3 pt-2" : "px-3 pb-3 pt-2 md:px-4 md:pb-4")}>
      {slashOpen ? (
        <div
          className="surface-pop pop-in absolute bottom-full left-3 z-10 mb-1 max-h-72 w-80 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl py-1"
          id={listboxId}
          role="listbox"
          aria-label="Commands"
        >
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-faint">Commands</p>
          {slashOptions.map((command, index) => {
            const active = index === slashIndex % slashOptions.length
            return (
              <button
                key={command.name}
                type="button"
                id={`${listboxId}-slash-${index}`}
                role="option"
                aria-selected={active}
                onMouseDown={(event) => {
                  event.preventDefault()
                  pickSlash(command)
                }}
                onMouseEnter={() => setSlashIndex(index)}
                className={cn(
                  "flex w-full items-baseline gap-2 px-3 py-2 text-left md:py-1.5",
                  active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
                )}
              >
                <span className="shrink-0 font-mono text-[13px] text-text">/{command.name}</span>
                {command.args ? (
                  <span className="shrink-0 text-[12px] text-faint">{command.args}</span>
                ) : null}
                <span className="ml-auto truncate pl-2 text-right text-[12px] text-muted">
                  {command.description}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      {mention && options.length ? (
        <div
          className="surface-pop pop-in absolute bottom-full left-3 z-10 mb-1 max-h-56 w-72 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl py-1"
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
          "relative flex flex-col rounded-[22px] border border-line bg-panel shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_10px_30px_-18px_rgba(0,0,0,0.6)] transition-[border-color,box-shadow] duration-200 focus-within:border-accent/40 focus-within:shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_0_0_4px_rgba(157,140,255,0.10),0_10px_30px_-18px_rgba(0,0,0,0.6)]",
          isDragging && "ring-2 ring-accent",
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
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[22px] bg-panel/90 text-[14px] text-accent backdrop-blur-xs">
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
          aria-expanded={Boolean(mention && options.length) || slashOpen}
          aria-controls={(mention && options.length) || slashOpen ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          ref={textareaRef}
          value={value}
          autoFocus={autoFocus}
          rows={1}
          maxLength={100_000}
          spellCheck
          placeholder={placeholder}
          title="@ to mention, / for commands, Enter to send, Shift+Enter for a new line"
          onChange={(event) => {
            const next = event.target.value
            updateValue(next)
            setSlashIndex(0)
            updateMention(next, event.target.selectionStart ?? next.length)
            onTyping?.()
          }}
          onSelect={(event) =>
            updateMention(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)
          }
          onKeyDown={onKeyDown}
          onBlur={() => window.setTimeout(() => setMention(null), 120)}
          className="block max-h-[220px] min-h-10 w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-[22px] text-text outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 placeholder:text-faint"
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          {showQuickActions ? (
            <>
              <DetailsMenu
                className="relative"
                summaryLabel="Add to your message"
                summaryClassName="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-full text-muted transition-colors hover:bg-white/[0.06] hover:text-text"
                summary={<Plus className="h-[18px] w-[18px]" aria-hidden="true" />}
              >
                <div
                  role="menu"
                  aria-label="Add to your message"
                  className="surface-pop pop-in absolute bottom-full left-0 z-30 mb-2 w-60 rounded-2xl p-1.5"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItem}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="h-4 w-4" aria-hidden="true" />
                    Attach a PDF
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItem}
                    onClick={() => setQuickAction("task")}
                  >
                    <ListTodo className="h-4 w-4" aria-hidden="true" />
                    Add a to-do
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItem}
                    onClick={() => setQuickAction("cron")}
                  >
                    <AlarmClock className="h-4 w-4" aria-hidden="true" />
                    Do this on a schedule
                  </button>
                  {canAdmin && roomKind !== "dm" ? (
                    <button
                      type="button"
                      role="menuitem"
                      className={menuItem}
                      onClick={() => setQuickAction("meeting")}
                    >
                      <Video className="h-4 w-4" aria-hidden="true" />
                      Start a meeting
                    </button>
                  ) : null}
                  {onShowCanvas ? (
                    <button
                      type="button"
                      role="menuitem"
                      className={menuItem}
                      onClick={onShowCanvas}
                    >
                      <FileText className="h-4 w-4" aria-hidden="true" />
                      Open canvas
                    </button>
                  ) : null}
                </div>
              </DetailsMenu>
              <RoomModelPicker orgSlug={orgSlug} roomId={roomId} placement="up" />
            </>
          ) : null}
          <span className="flex-1" />
          {value.length > 90_000 ? (
            <span className="mr-1 font-mono text-[11px] text-warn">{value.length}/100000</span>
          ) : null}
          {showQuickActions ? (
            <ExecutionModeMenu orgSlug={orgSlug} roomId={roomId} initial={executionMode} />
          ) : null}
          <DictationButton
            onTranscript={(dictatedText) => {
              const next = value ? `${value.trim()} ${dictatedText}` : dictatedText
              updateValue(next)
              textareaRef.current?.focus()
            }}
            disabled={pending}
          />
          <button
            type="button"
            data-testid="send-message"
            aria-label={pending ? "Sending" : "Send message"}
            title="Send (Enter)"
            onClick={() => void send()}
            disabled={pending || !value.trim()}
            className="ml-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-text text-void transition-[transform,background-color,color] duration-150 hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-faint"
          >
            <ArrowUp className="h-[17px] w-[17px]" strokeWidth={2.4} aria-hidden="true" />
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
          initialText={quickText}
          onClose={() => {
            setQuickAction(null)
            setQuickText("")
          }}
        />
      ) : null}
    </div>
  )
}
