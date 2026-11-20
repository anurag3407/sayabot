"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import {
  addTaskCommentAction,
  answerTaskRequestAction,
  createTaskAction,
  updateTaskAction,
} from "@/lib/actions/tasks"
import { Button } from "@/components/ui/button"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { EmptyState, InlineAlert } from "@/components/ui/empty"
import { StatusBadge } from "@/components/ui/status"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import { useWorkspaceChange } from "@/lib/use-workspace-change"
import type { TaskView } from "@/lib/types"

interface TaskRoom {
  id: string
  name: string
}

interface TaskMember {
  userId: string
  displayName: string
}

interface TaskAgent {
  id: string
  handle: string
  displayName: string
}

const COLUMNS = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "stuck", label: "Stuck" },
  { key: "done", label: "Done" },
] as const

const STATUS_LABELS: Record<TaskView["status"], string> = {
  open: "Open",
  in_progress: "In progress",
  stuck: "Stuck",
  done: "Done",
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function assigneeLabel(task: TaskView): string {
  if (task.assigneeHandle) return `@${task.assigneeHandle}`
  if (task.assigneeName) return task.assigneeName
  return "Unassigned"
}

function taskTone(status: TaskView["status"]): string {
  if (status === "done") return "border-l-[var(--color-ok)]"
  if (status === "stuck") return "border-l-[var(--color-danger)]"
  if (status === "in_progress") return "border-l-accent"
  return "border-l-line-strong"
}

function TaskCard({
  task,
  onOpen,
  showRoom = true,
}: {
  task: TaskView
  onOpen: (task: TaskView) => void
  showRoom?: boolean
}) {
  const isOverdue =
    task.dueAt && new Date(task.dueAt).getTime() < Date.now() && task.status !== "done"
  const formattedCost = typeof task.costUsd === "number" ? `$${task.costUsd.toFixed(2)}` : "$0.00"
  const runs = task.runsCount || 0

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(task)}
        className={cn(
          "w-full border border-line border-l-2 bg-panel px-3 py-2.5 text-left transition-colors hover:bg-raised",
          taskTone(task.status),
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-faint">SAYA-{task.number}</span>
          {task.kind === "request" ? (
            <span className="font-mono text-[11px] text-accent">request</span>
          ) : null}
          {task.status === "stuck" && task.unblockNeeds ? (
            <span className="rounded-sm bg-danger/20 px-1 py-0.5 font-mono text-[10px] text-danger">
              needs: {task.unblockNeeds}
            </span>
          ) : null}
          {task.blockedBy && task.blockedBy.length > 0 && task.status !== "done" ? (
            <span className="rounded-sm bg-line-strong px-1 py-0.5 font-mono text-[10px] text-muted">
              {task.blockedBy.length} blocker{task.blockedBy.length > 1 ? "s" : ""}
            </span>
          ) : null}
          {task.dueAt ? (
            <span
              className={cn(
                "rounded-sm px-1 py-0.5 font-mono text-[10px]",
                isOverdue ? "bg-danger/20 text-danger" : "bg-line text-muted",
              )}
            >
              due {shortDate(task.dueAt)}
            </span>
          ) : null}
          <span className="ml-auto font-mono text-[11px] text-faint">
            {shortDate(task.updatedAt)}
          </span>
        </div>
        <p className="mt-1.5 text-[13px] leading-snug text-text">{task.title}</p>
        {task.description ? (
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">
            {task.description}
          </p>
        ) : null}
        {task.status === "done" && task.outcomeKind ? (
          <div className="mt-2 rounded-sm bg-line/30 px-2 py-1 font-mono text-[11px] text-muted">
            <span className="text-[var(--color-ok)]">outcome:</span> {task.outcomeKind}
            {task.outcomeRef ? ` · ${task.outcomeRef}` : ""}
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-faint">
          {showRoom ? <span>{task.roomName}</span> : null}
          <span>· {assigneeLabel(task)}</span>
          <span>
            · {formattedCost} · {runs} run{runs === 1 ? "" : "s"}
          </span>
          {task.comments.length ? <span>· {task.comments.length} comments</span> : null}
          {task.requestedByHandle ? <span>· asked by @{task.requestedByHandle}</span> : null}
        </div>
      </button>
    </li>
  )
}

function TaskDetail({
  task,
  orgSlug,
  members,
  agents,
  onClose,
  onChanged,
}: {
  task: TaskView
  orgSlug: string
  members: TaskMember[]
  agents: TaskAgent[]
  onClose: () => void
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState("")
  const [answer, setAnswer] = useState("")
  const [alsoPost, setAlsoPost] = useState(true)
  const [pendingStatus, setPendingStatus] = useState<TaskView["status"] | null>(null)
  const [outcomeKind, setOutcomeKind] = useState<string>(task.outcomeKind || "artifact")
  const [outcomeRef, setOutcomeRef] = useState<string>(task.outcomeRef || "")
  const [unblockNeeds, setUnblockNeeds] = useState<string>(task.unblockNeeds || "human_answer")
  const [unblockDetail, setUnblockDetail] = useState<string>(task.unblockDetail || "")
  const [reason, setReason] = useState<string>("")
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  function update(input: {
    status?: TaskView["status"]
    assignee?: string
    outcome?: { kind: string; ref?: string | null } | null
    unblockNeeds?: string | null
    unblockDetail?: string | null
    reason?: string | null
  }) {
    setError(null)
    startTransition(async () => {
      const result = await updateTaskAction({ orgSlug, taskId: task.id, ...input })
      if (!result.ok) {
        setError(result.error ?? "Could not update the task")
        return
      }
      showToast({ message: result.message ?? "Task updated", tone: "success" })
      setPendingStatus(null)
      onChanged()
    })
  }

  function handleStatusChange(newStatus: TaskView["status"]) {
    if (newStatus === task.status) return
    if (
      newStatus === "done" ||
      newStatus === "stuck" ||
      (newStatus === "in_progress" && (task.blockedBy?.length ?? 0) > 0)
    ) {
      setPendingStatus(newStatus)
      return
    }
    update({ status: newStatus })
  }

  function confirmStatusTransition() {
    if (!pendingStatus) return
    if (pendingStatus === "done") {
      update({
        status: "done",
        outcome: { kind: outcomeKind, ref: outcomeRef || null },
      })
    } else if (pendingStatus === "stuck") {
      update({
        status: "stuck",
        unblockNeeds,
        unblockDetail: unblockDetail || null,
      })
    } else if (pendingStatus === "in_progress") {
      update({
        status: "in_progress",
        reason: reason || null,
      })
    }
  }

  function addComment() {
    if (!comment.trim()) return
    setError(null)
    const form = new FormData()
    form.set("orgSlug", orgSlug)
    form.set("taskId", task.id)
    form.set("content", comment)
    startTransition(async () => {
      const result = await addTaskCommentAction(null, form)
      if (!result.ok) {
        setError(result.error ?? "Could not add the comment")
        return
      }
      setComment("")
      onChanged()
    })
  }

  function sendAnswer() {
    if (!answer.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await answerTaskRequestAction({
        orgSlug,
        taskId: task.id,
        answer,
        alsoPost,
      })
      if (!result.ok) {
        setError(result.error ?? "Could not send the answer")
        return
      }
      setAnswer("")
      showToast({ message: result.message ?? "Answer sent", tone: "success" })
      onChanged()
    })
  }

  const assigneeValue = task.assigneeUserId
    ? `user:${task.assigneeUserId}`
    : task.assigneeAgentId
      ? `agent:${task.assigneeAgentId}`
      : ""

  return (
    <dialog
      ref={dialogRef}
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-lg bg-ink p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-text backdrop:bg-void/70"
      aria-label={`Task SAYA-${task.number}`}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close()
      }}
    >
      <div className="flex h-full w-full flex-col overflow-y-auto border-l border-line bg-ink">
        <div className="sticky top-0 flex items-center gap-2 border-b border-line bg-ink px-4 py-3">
          <span className="font-mono text-[11px] text-faint">SAYA-{task.number}</span>
          <StatusBadge status={task.status} />
          <span className="rounded-sm bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">
            {task.kind}
          </span>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="ml-auto grid h-10 w-10 place-items-center rounded-sm text-muted hover:bg-raised hover:text-text md:h-7 md:w-7"
            aria-label="Close task"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div>
            <h2 className="text-[17px] font-medium leading-snug tracking-[-0.01em]">
              {task.title}
            </h2>
            <p className="mt-1 font-mono text-[11px] text-faint">
              {task.roomName} · updated {shortDate(task.updatedAt)} ·{" "}
              {task.requestedByHandle ? `requested by @${task.requestedByHandle}` : `by a teammate`}
            </p>
          </div>
          {task.description ? (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
              {task.description}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border border-line bg-panel/50 px-3 py-2 font-mono text-[11px] text-muted">
            <span>
              Cost: ${typeof task.costUsd === "number" ? task.costUsd.toFixed(2) : "0.00"}
            </span>
            <span>· Runs: {task.runsCount || 0}</span>
            {task.dueAt ? <span>· Due: {shortDate(task.dueAt)}</span> : null}
            {task.statusChangedAt ? (
              <span>· In status since: {shortDate(task.statusChangedAt)}</span>
            ) : null}
            {task.outcomeKind ? (
              <span className="text-[var(--color-ok)]">
                · Outcome: {task.outcomeKind}
                {task.outcomeRef ? ` (${task.outcomeRef})` : ""}
              </span>
            ) : null}
            {task.blockedBy && task.blockedBy.length > 0 ? (
              <span className="text-danger">· Blockers: {task.blockedBy.length}</span>
            ) : null}
          </div>

          <div className="grid gap-3 border border-line bg-panel p-3 sm:grid-cols-2">
            <Field label="status" htmlFor="task-status">
              <Select
                id="task-status"
                value={pendingStatus ?? task.status}
                disabled={pending}
                onChange={(event) => handleStatusChange(event.target.value as TaskView["status"])}
              >
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="assignee" htmlFor="task-assignee">
              <Select
                id="task-assignee"
                value={assigneeValue}
                disabled={pending}
                onChange={(event) => update({ assignee: event.target.value })}
              >
                <option value="">Unassigned</option>
                <optgroup label="People">
                  {members.map((member) => (
                    <option key={member.userId} value={`user:${member.userId}`}>
                      {member.displayName}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Agents">
                  {agents.map((agent) => (
                    <option key={agent.id} value={`agent:${agent.id}`}>
                      @{agent.handle} · {agent.displayName}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </Field>
          </div>

          {pendingStatus ? (
            <div className="border border-line border-l-2 border-l-accent bg-panel p-3">
              <h4 className="font-mono text-[11px] uppercase tracking-wide text-accent">
                Confirm transition to {pendingStatus}
              </h4>
              {pendingStatus === "done" ? (
                <div className="mt-2 space-y-2">
                  <Field label="Outcome kind (required)" htmlFor="task-outcome-kind">
                    <Select
                      id="task-outcome-kind"
                      value={outcomeKind}
                      onChange={(e) => setOutcomeKind(e.target.value)}
                    >
                      <option value="artifact">artifact</option>
                      <option value="submission">submission</option>
                      <option value="external_change">external_change</option>
                      <option value="decision">decision</option>
                      <option value="none">none (human override only)</option>
                    </Select>
                  </Field>
                  <Field
                    label="Outcome reference (URL, Canvas ID, or ref)"
                    htmlFor="task-outcome-ref"
                  >
                    <Input
                      id="task-outcome-ref"
                      value={outcomeRef}
                      onChange={(e) => setOutcomeRef(e.target.value)}
                      placeholder="e.g. https://... or canvas-id"
                    />
                  </Field>
                </div>
              ) : null}
              {pendingStatus === "stuck" ? (
                <div className="mt-2 space-y-2">
                  <Field label="Unblock needs (required)" htmlFor="task-unblock-needs">
                    <Select
                      id="task-unblock-needs"
                      value={unblockNeeds}
                      onChange={(e) => setUnblockNeeds(e.target.value)}
                    >
                      <option value="human_answer">human_answer</option>
                      <option value="another_agent">another_agent</option>
                      <option value="credential">credential</option>
                      <option value="external_access">external_access</option>
                      <option value="time">time</option>
                      <option value="other">other</option>
                    </Select>
                  </Field>
                  <Field label="Unblock detail" htmlFor="task-unblock-detail">
                    <Input
                      id="task-unblock-detail"
                      value={unblockDetail}
                      onChange={(e) => setUnblockDetail(e.target.value)}
                      placeholder="What specific fact, answer, or access is needed?"
                    />
                  </Field>
                </div>
              ) : null}
              {pendingStatus === "in_progress" && (task.blockedBy?.length ?? 0) > 0 ? (
                <div className="mt-2">
                  <Field label="Reason (required to proceed with blockers)" htmlFor="task-reason">
                    <Input
                      id="task-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why can this start while blockers are still unresolved?"
                    />
                  </Field>
                </div>
              ) : null}
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPendingStatus(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={confirmStatusTransition}
                >
                  {pending ? "Saving…" : "Save status"}
                </Button>
              </div>
            </div>
          ) : null}

          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

          {task.kind === "request" && task.status !== "done" ? (
            <section className="border border-line border-l-2 border-l-accent bg-panel p-3">
              <h3 className="font-mono text-[11px] text-accent">answer this request</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                {task.requestedByHandle
                  ? `@${task.requestedByHandle} is waiting on a human answer.`
                  : "An agent is waiting on a human answer."}
              </p>
              <Textarea
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                rows={3}
                className="mt-2"
                placeholder="Write the answer the agent should use."
              />
              <label className="mt-2 flex items-start gap-2 text-[12px] text-muted">
                <input
                  type="checkbox"
                  checked={alsoPost}
                  onChange={(event) => setAlsoPost(event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                <span>
                  Post the answer in {task.roomName}. Unchecked delivers it as a direct message to
                  the agent.
                </span>
              </label>
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending || !answer.trim()}
                  onClick={sendAnswer}
                >
                  {pending ? "Sending…" : "Send answer"}
                </Button>
              </div>
            </section>
          ) : null}

          <section>
            <div className="flex items-baseline justify-between">
              <h3 className="text-[13px] font-medium">Activity</h3>
              <span className="font-mono text-[11px] text-faint">
                {task.comments.length} comments
              </span>
            </div>
            {task.comments.length === 0 ? (
              <p className="mt-2 border-l-2 border-line-strong pl-3 font-mono text-[11px] text-faint">
                No comments yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {task.comments.map((item) => (
                  <li key={item.id} className="border-l-2 border-line pl-3">
                    <p className="font-mono text-[11px] text-faint">
                      {item.authorName} · {new Date(item.createdAt).toLocaleString()}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-muted">
                      {item.content}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <Textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={2}
                placeholder="Add context for the room."
              />
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !comment.trim()}
                  onClick={addComment}
                >
                  Comment
                </Button>
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-baseline justify-between">
              <h3 className="text-[13px] font-medium">Audit Timeline</h3>
              <span className="font-mono text-[11px] text-faint">
                {task.events?.length || 0} events
              </span>
            </div>
            {!task.events || task.events.length === 0 ? (
              <p className="mt-2 border-l-2 border-line-strong pl-3 font-mono text-[11px] text-faint">
                No recorded state changes yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {task.events.map((evt) => (
                  <li key={evt.id} className="border-l-2 border-line pl-3">
                    <p className="font-mono text-[11px] text-faint">
                      <span className="text-text">{evt.actorName || evt.actorType}</span>{" "}
                      {evt.fromStatus ? `${evt.fromStatus} → ` : "created as "}
                      <span className="text-accent">{evt.toStatus}</span> ·{" "}
                      {new Date(evt.createdAt).toLocaleString()}
                    </p>
                    {evt.reason ? (
                      <p className="mt-0.5 text-[12px] text-muted">Reason: {evt.reason}</p>
                    ) : null}
                    {evt.outcomeKind ? (
                      <p className="mt-0.5 font-mono text-[11px] text-[var(--color-ok)]">
                        Outcome: {evt.outcomeKind}
                        {evt.outcomeRef ? ` · ${evt.outcomeRef}` : ""}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3 font-mono text-[11px] text-faint">
            <Link href={`/${orgSlug}/r/${task.roomId}`} className="hover:text-text">
              open room
            </Link>
            <span>·</span>
            <span>changes are recorded in the audit log</span>
          </div>
        </div>
      </div>
    </dialog>
  )
}

export function TasksView({
  orgSlug,
  tasks,
  rooms,
  members,
  agents,
}: {
  orgSlug: string
  tasks: TaskView[]
  rooms: TaskRoom[]
  members: TaskMember[]
  agents: TaskAgent[]
}) {
  const router = useRouter()
  const [view, setView] = useState<"tasks" | "requests">("tasks")
  const [showNew, setShowNew] = useState(false)
  const [newKind, setNewKind] = useState<"task" | "request">("task")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [roomFilter, setRoomFilter] = useState("")
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const refresh = useCallback(() => router.refresh(), [router])
  useWorkspaceChange(["tasks"], refresh)

  const selected = tasks.find((task) => task.id === selectedId) ?? null
  const requests = tasks.filter((task) => task.kind === "request")
  const boardTasks = tasks.filter((task) => task.kind === "task")
  const openRequests = requests.filter((task) => task.status !== "done")
  const doneRequests = requests.filter((task) => task.status === "done")

  const matches = useCallback(
    (task: TaskView) => {
      const needle = query.trim().toLowerCase()
      if (roomFilter && task.roomId !== roomFilter) return false
      if (!needle) return true
      return (
        task.title.toLowerCase().includes(needle) ||
        task.description.toLowerCase().includes(needle) ||
        String(task.number).includes(needle)
      )
    },
    [query, roomFilter],
  )
  const filtered = useMemo(() => boardTasks.filter(matches), [boardTasks, matches])
  const shownOpenRequests = openRequests.filter(matches)
  const shownDoneRequests = doneRequests.filter(matches)
  const filtering = Boolean(roomFilter || query.trim())

  function create(form: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await createTaskAction(null, form)
      if (!result.ok) {
        setError(result.error ?? "Could not create the item")
        return
      }
      showToast({ message: result.message ?? "Created", tone: "success" })
      setShowNew(false)
      router.refresh()
    })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="font-mono text-[12px] text-faint">workspace</p>
            <h1 className="mt-1 text-2xl font-medium tracking-[-0.02em]">Tasks</h1>
            <p className="mt-1.5 font-mono text-[12px] text-muted">
              {boardTasks.filter((task) => task.status !== "done").length} open tasks ·{" "}
              {openRequests.length} requests waiting · {doneRequests.length} answered
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setNewKind(view === "requests" ? "request" : "task")
              setShowNew((open) => !open)
            }}
          >
            {showNew ? "Close" : view === "requests" ? "+ New request" : "+ New task"}
          </Button>
        </header>

        {error ? (
          <div className="mt-4">
            <InlineAlert tone="danger">{error}</InlineAlert>
          </div>
        ) : null}
        {showNew ? (
          <form action={create} className="mt-5 border border-line bg-panel p-4 sm:p-5">
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
              <Field label="title" htmlFor="new-task-title">
                <Input
                  id="new-task-title"
                  name="title"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="Draft the migration checklist"
                />
              </Field>
              <Field label="type" htmlFor="new-task-kind">
                <Select
                  id="new-task-kind"
                  name="kind"
                  value={newKind}
                  onChange={(event) => setNewKind(event.target.value as "task" | "request")}
                >
                  <option value="task">Task</option>
                  <option value="request">Request (needs a decision)</option>
                </Select>
              </Field>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="room" htmlFor="new-task-room">
                <Select id="new-task-room" name="roomId" required defaultValue="">
                  <option value="" disabled>
                    Choose a room
                  </option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="assignee"
                htmlFor="new-task-assignee"
                hint="must already be in the room"
              >
                <Select id="new-task-assignee" name="assignee" defaultValue="">
                  <option value="">Unassigned</option>
                  <optgroup label="People">
                    {members.map((member) => (
                      <option key={member.userId} value={`user:${member.userId}`}>
                        {member.displayName}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Agents">
                    {agents.map((agent) => (
                      <option key={agent.id} value={`agent:${agent.id}`}>
                        @{agent.handle} · {agent.displayName}
                      </option>
                    ))}
                  </optgroup>
                </Select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="description" htmlFor="new-task-description" hint="optional">
                <Textarea
                  id="new-task-description"
                  name="description"
                  rows={3}
                  placeholder="Context, acceptance criteria, links to the thread."
                />
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="submit" variant="primary" disabled={pending || rooms.length === 0}>
                {pending ? "Creating…" : newKind === "request" ? "Create request" : "Create task"}
              </Button>
            </div>
          </form>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3 border-b border-line">
          <div className="flex gap-1">
            {(
              [
                {
                  key: "tasks",
                  label: "Tasks",
                  count: boardTasks.filter((t) => t.status !== "done").length,
                },
                { key: "requests", label: "Requests", count: openRequests.length },
              ] as const
            ).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setView(option.key)}
                aria-pressed={view === option.key}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 font-mono text-[12px]",
                  view === option.key
                    ? "border-accent text-text"
                    : "border-transparent text-muted hover:text-text",
                )}
              >
                {option.label}
                {option.count ? <span className="text-faint">{option.count}</span> : null}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 pb-1">
            <Select
              value={roomFilter}
              onChange={(event) => setRoomFilter(event.target.value)}
              className="h-7 w-auto font-mono text-[11px]"
              aria-label="Filter by room"
            >
              <option value="">All rooms</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </Select>
            <label className="flex h-7 min-w-[10rem] items-center rounded-sm border border-line bg-panel px-2 focus-within:border-accent">
              <span className="sr-only">Search tasks</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                className="w-full bg-transparent font-mono text-[11px] text-text outline-none placeholder:text-faint"
              />
            </label>
          </div>
        </div>

        {view === "tasks" ? (
          filtered.length === 0 ? (
            <div className="mt-8">
              <EmptyState
                title={filtering ? "No tasks match" : "No tasks yet"}
                body={
                  filtering
                    ? "Try another room or search phrase."
                    : "Create a task and assign it to a person or an agent. Agents can create tasks too."
                }
                action={
                  filtering ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRoomFilter("")
                        setQuery("")
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setShowNew(true)}>
                      New task
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {COLUMNS.map((column) => {
                const items = filtered.filter((task) => task.status === column.key)
                return (
                  <section key={column.key} aria-labelledby={`column-${column.key}`}>
                    <div className="flex items-baseline justify-between border-b border-line pb-2">
                      <h2
                        id={`column-${column.key}`}
                        className="font-mono text-[11px] uppercase tracking-wide text-muted"
                      >
                        {column.label}
                      </h2>
                      <span className="font-mono text-[11px] text-faint">{items.length}</span>
                    </div>
                    {items.length === 0 ? (
                      <p className="mt-3 border border-dashed border-line px-3 py-4 font-mono text-[11px] text-faint">
                        nothing here
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {items.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            onOpen={(item) => setSelectedId(item.id)}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                )
              })}
            </div>
          )
        ) : (
          <div className="mt-5 grid gap-8 lg:grid-cols-[1fr_320px]">
            <section>
              <div className="flex items-baseline justify-between border-b border-line pb-2">
                <h2 className="font-mono text-[11px] uppercase tracking-wide text-muted">
                  Waiting on a human
                </h2>
                <span className="font-mono text-[11px] text-faint">{shownOpenRequests.length}</span>
              </div>
              {shownOpenRequests.length === 0 ? (
                <p className="mt-4 border-l-2 border-line-strong pl-3 font-mono text-[12px] leading-relaxed text-faint">
                  {filtering
                    ? "No open requests match these filters."
                    : "No open requests. Agents create one when they need a decision from a person."}
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {shownOpenRequests.map((task) => (
                    <TaskCard key={task.id} task={task} onOpen={(item) => setSelectedId(item.id)} />
                  ))}
                </ul>
              )}
            </section>
            <aside className="border-t border-line pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <div className="flex items-baseline justify-between border-b border-line pb-2">
                <h2 className="font-mono text-[11px] uppercase tracking-wide text-muted">
                  Answered
                </h2>
                <span className="font-mono text-[11px] text-faint">{shownDoneRequests.length}</span>
              </div>
              {shownDoneRequests.length === 0 ? (
                <p className="mt-4 font-mono text-[11px] text-faint">
                  {filtering ? "No answered requests match." : "No answered requests yet."}
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {shownDoneRequests.slice(0, 8).map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(task.id)}
                        className="w-full border border-line bg-panel px-3 py-2 text-left hover:bg-raised"
                      >
                        <p className="truncate text-[12px] text-muted">{task.title}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-faint">
                          {task.roomName} · {shortDate(task.updatedAt)}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 font-mono text-[11px] leading-relaxed text-faint">
                Answers can post in the room or go to the agent&apos;s direct chat. Either way the
                agent then continues.
              </p>
            </aside>
          </div>
        )}

        <p className="mt-10 font-mono text-[11px] leading-relaxed text-faint">
          Status and assignee changes are recorded in the audit log.
        </p>
      </div>

      {selected ? (
        <TaskDetail
          task={selected}
          orgSlug={orgSlug}
          members={members}
          agents={agents}
          onClose={() => setSelectedId(null)}
          onChanged={() => router.refresh()}
        />
      ) : null}
    </div>
  )
}
