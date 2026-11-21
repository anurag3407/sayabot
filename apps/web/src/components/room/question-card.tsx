"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { humanizeFactKey } from "@sayabot/core"
import { answerTaskRequestAction } from "@/lib/actions/tasks"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { showToast } from "@/components/ui/toast"
import { clockTime, cn } from "@/lib/format"
import type { RoomQuestionView } from "@/lib/types"

/**
 * A bot's question, in the room where it asked. Options answer in one tap; anything else takes a
 * line of text. Answers post into the room, so the bot is woken and a paused /goal carries on.
 */
function QuestionCard({ question, orgSlug }: { question: RoomQuestionView; orgSlug: string }) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>({})
  const [note, setNote] = useState("")
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const open = question.items.filter((item) => !item.answer?.trim())
  const answered = question.items.length - open.length
  const keyed = open.length > 0
  const filled = open.filter((item) => (values[item.key] ?? "").trim()).length
  const canSend = keyed ? filled > 0 || Boolean(note.trim()) : Boolean(note.trim())

  function send(quick?: string) {
    const answer = (quick ?? note).trim()
    if (!answer && !filled) return
    setError(null)
    startTransition(async () => {
      const result = await answerTaskRequestAction({
        orgSlug,
        taskId: question.id,
        answer,
        alsoPost: true,
        itemAnswers: keyed ? values : undefined,
      })
      if (!result.ok) {
        setError(result.error ?? "Could not send your answer")
        return
      }
      showToast({
        tone: "success",
        message: question.goal
          ? "Answer sent. The goal carries on from there."
          : "Answer sent. It will remember, so it won't ask again.",
      })
      setValues({})
      setNote("")
      router.refresh()
    })
  }

  return (
    <section
      className="rounded-2xl border border-line bg-panel p-3.5 md:p-4"
      aria-label={`Question from ${question.agentName ?? "a bot"}`}
      data-testid="room-question"
      data-task-id={question.id}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[13px] font-medium text-text">
          {question.agentName ?? "A bot"}{" "}
          {keyed && open.length > 1 ? "needs a few answers" : "asks"}
        </span>
        <span className="font-mono text-[11px] text-faint">{clockTime(question.createdAt)}</span>
        {question.goal ? (
          <span
            className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent"
            title={question.goal}
          >
            goal waiting
          </span>
        ) : null}
        {question.askedCount > 1 ? (
          <span className="text-[11px] text-faint">asked {question.askedCount} times</span>
        ) : null}
      </div>

      <p className="mt-1.5 text-[14.5px] leading-snug text-text">{question.title}</p>
      {question.description ? (
        <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
          {question.description}
        </p>
      ) : null}

      {keyed ? (
        <ul className="mt-3 space-y-2.5">
          {open.map((item) => (
            <li key={item.key}>
              <p className="text-[13px] text-text">{item.question}</p>
              {item.hint ? <p className="text-[12px] text-faint">{item.hint}</p> : null}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {(item.options ?? []).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setValues((all) => ({ ...all, [item.key]: option }))}
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
                <Input
                  className="h-8 min-w-[160px] flex-1"
                  value={values[item.key] ?? ""}
                  onChange={(event) =>
                    setValues((all) => ({ ...all, [item.key]: event.target.value }))
                  }
                  placeholder={`${humanizeFactKey(item.key)}…`}
                  aria-label={item.question}
                />
              </div>
            </li>
          ))}
          {answered ? (
            <li className="text-[11px] text-faint">{answered} already answered</li>
          ) : null}
        </ul>
      ) : question.options.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Quick answers">
          {question.options.map((option, index) => (
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

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canSend && !pending) {
              event.preventDefault()
              send()
            }
          }}
          className="h-8 min-w-[180px] flex-1"
          placeholder={keyed ? "Something to add? (optional)" : "Type your answer"}
          aria-label="Your answer"
        />
        <Button size="sm" variant="primary" disabled={pending || !canSend} onClick={() => send()}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}

/** The newest open questions above the composer; the Inbox still holds everything. */
export function RoomQuestions({
  questions,
  orgSlug,
}: {
  questions: RoomQuestionView[]
  orgSlug: string
}) {
  if (!questions.length) return null
  const shown = questions.slice(0, 3)
  return (
    <div className="mx-auto w-full max-w-[780px] shrink-0 space-y-2 px-4 pb-1 pt-2 md:px-6">
      {shown.map((question) => (
        <QuestionCard key={question.id} question={question} orgSlug={orgSlug} />
      ))}
      {questions.length > shown.length ? (
        <p className="text-[12px] text-faint">
          {questions.length - shown.length} more waiting in your Inbox
        </p>
      ) : null}
    </div>
  )
}
