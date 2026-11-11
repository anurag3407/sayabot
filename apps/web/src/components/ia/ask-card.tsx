"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { askItemsFromMetadata, humanizeFactKey } from "@sayabot/core"
import { answerTaskRequestAction } from "@/lib/actions/tasks"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input, Textarea } from "@/components/ui/field"
import { CheckIcon } from "@/components/ui/icons"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import type { TaskView } from "@/lib/types"

export function when(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`
  if (diff < 2 * 86_400_000) return "Yesterday"
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

/** A short, readable version of what the agent wrote, with "Read more" for the rest. */
function Details({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 320
  return (
    <div className="mt-2">
      <p
        className={cn(
          "whitespace-pre-wrap text-[14px] leading-relaxed text-muted",
          !open && long && "line-clamp-4",
        )}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 text-[13px] font-medium text-accent hover:underline"
        >
          {open ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  )
}

/**
 * One agent question. Keyed questions get one field per item; anything already known shows
 * as answered and is never asked again. Free-form questions get one answer box.
 */
export function AskCard({
  task,
  agentName,
  orgSlug,
  onAnswered,
}: {
  task: TaskView
  agentName: string
  orgSlug: string
  onAnswered: () => void
}) {
  const items = askItemsFromMetadata(task.metadata)
  const open = items.filter((i) => !i.answer)
  const options = Array.isArray(task.metadata.options)
    ? (task.metadata.options as unknown[]).filter((o): o is string => typeof o === "string")
    : []
  const [values, setValues] = useState<Record<string, string>>({})
  const [note, setNote] = useState("")
  const [alsoPost, setAlsoPost] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const filled = Object.values(values).filter((v) => v.trim()).length

  function send(quick?: string) {
    setError(null)
    const answer = quick ?? note
    if (!items.length && !answer.trim()) return
    if (items.length && !filled && !answer.trim()) return
    startTransition(async () => {
      const result = await answerTaskRequestAction({
        orgSlug,
        taskId: task.id,
        answer,
        alsoPost,
        itemAnswers: items.length ? values : undefined,
      })
      if (!result.ok) {
        setError(result.error ?? "Could not send your answer")
        return
      }
      const left = items.length ? open.length - filled : 0
      showToast({
        tone: "success",
        message:
          left > 0
            ? `Sent to ${agentName}. ${left} still open; answer them any time.`
            : `Sent to ${agentName}. It will remember, so it won't ask again.`,
      })
      setValues({})
      setNote("")
      onAnswered()
    })
  }

  return (
    <li className="rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Avatar name={task.requestedByHandle ?? agentName} kind="agent" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-text">
            {agentName} {items.length > 1 ? "needs a few answers" : "has a question"}
          </p>
          <p className="text-[12px] text-faint">
            {when(task.updatedAt)} · in{" "}
            <Link href={`/${orgSlug}/r/${task.roomId}`} className="hover:text-text hover:underline">
              {task.roomName}
            </Link>
            {task.askedCount && task.askedCount > 1 ? ` · asked ${task.askedCount} times` : ""}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[15px] leading-snug text-text">{task.title}</p>
      {task.description ? <Details text={task.description} /> : null}

      {items.length ? (
        <ol className="mt-4 space-y-3">
          {items.map((item, index) =>
            item.answer ? (
              <li key={item.key} className="flex items-start gap-2.5 rounded-lg bg-ink px-3 py-2.5">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ok/15 text-ok">
                  <CheckIcon width={11} height={11} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] text-muted">{item.question}</p>
                  <p className="text-[14px] text-text">{item.answer}</p>
                  {item.source === "fact" ? (
                    <p className="text-[11px] text-faint">Filled from what you told your agents before</p>
                  ) : null}
                </div>
              </li>
            ) : (
              <li key={item.key} className="rounded-lg border border-line bg-ink p-3">
                <label htmlFor={`${task.id}-${item.key}`} className="flex gap-2 text-[14px] text-text">
                  <span className="text-faint">{index + 1}.</span>
                  <span>{item.question}</span>
                </label>
                {item.hint ? <p className="mt-1 pl-5 text-[12px] text-faint">{item.hint}</p> : null}
                {item.options?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-5">
                    {item.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setValues((v) => ({ ...v, [item.key]: option }))}
                        className={cn(
                          "h-8 rounded-full border px-3 text-[13px] transition-colors",
                          values[item.key] === option
                            ? "border-accent bg-accent-soft text-text"
                            : "border-line text-muted hover:border-line-strong hover:text-text",
                        )}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
                <Input
                  id={`${task.id}-${item.key}`}
                  className="mt-2"
                  value={values[item.key] ?? ""}
                  onChange={(event) => setValues((v) => ({ ...v, [item.key]: event.target.value }))}
                  placeholder={`${humanizeFactKey(item.key)}…`}
                />
              </li>
            ),
          )}
        </ol>
      ) : options.length ? (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Quick answers">
          {options.map((option, index) => (
            <Button
              key={option}
              size="sm"
              variant={index === 0 ? "primary" : "secondary"}
              disabled={pending}
              onClick={() => send(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="mt-4">
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={items.length ? 2 : 3}
          placeholder={items.length ? "Anything else to add? (optional)" : "Your answer"}
          aria-label="Your answer"
        />
      </div>

      <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 text-[13px] text-muted">
        <span>Also post my answer in the group chat</span>
        <input
          type="checkbox"
          role="switch"
          checked={alsoPost}
          onChange={(event) => setAlsoPost(event.target.checked)}
          className="h-4 w-4 accent-[var(--color-accent)]"
        />
      </label>

      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={pending || (items.length ? !filled && !note.trim() : !note.trim())}
          onClick={() => send()}
        >
          {pending ? "Sending…" : items.length && filled && filled < open.length ? `Send ${filled} of ${open.length}` : "Send"}
        </Button>
        <Link
          href={`/${orgSlug}/r/${task.roomId}`}
          className="inline-flex h-11 items-center rounded-sm px-3 text-[13px] text-muted hover:bg-raised hover:text-text md:h-9"
        >
          Open chat
        </Link>
      </div>
    </li>
  )
}
