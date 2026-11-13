"use client"

import { useEffect, useState, useTransition } from "react"
import { CloseIcon } from "@/components/ui/icons"
import { Mascot } from "@/components/ui/mascot"
import { sendMessage } from "@/lib/actions/messages"
import { cn } from "@/lib/format"

const STARTERS: { label: string; prompt: string }[] = [
  {
    label: "Research and digging into topics",
    prompt: "I'd like help with research and digging into topics.",
  },
  {
    label: "Keeping an eye on things for me",
    prompt: "I'd like you to keep an eye on things for me and tell me when something changes.",
  },
  {
    label: "Email, calendar and messages",
    prompt: "I'd like help with my email, calendar and messages.",
  },
  {
    label: "Bookings, shopping and errands",
    prompt: "I'd like help with bookings, shopping and errands.",
  },
  {
    label: "Data, spreadsheets and reports",
    prompt: "I'd like help with data, spreadsheets and reports.",
  },
]

const SET_UP_HINT =
  " Set yourself up for that, then ask me the one or two things you need to know to get going."

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/**
 * The first thing someone sees in a new chat with an agent: a hello, and a few
 * plain-language places to start so nobody faces an empty box.
 */
export function StarterCard({
  orgSlug,
  roomId,
  agentName,
  userName,
  onSent,
  onSomethingElse,
}: {
  orgSlug: string
  roomId: string
  agentName: string
  userName: string
  onSent: () => void
  onSomethingElse: () => void
}) {
  const [dismissed, setDismissed] = useState(false)
  const [chosen, setChosen] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function choose(index: number) {
    if (pending) return
    if (index >= STARTERS.length) {
      onSomethingElse()
      return
    }
    const starter = STARTERS[index]
    if (!starter) return
    setChosen(index)
    setError(null)
    startTransition(async () => {
      const result = await sendMessage({
        orgSlug,
        roomId,
        content: starter.prompt + SET_UP_HINT,
      })
      if (!result.ok) {
        setChosen(null)
        setError(result.error ?? "That did not send. Try again in a moment.")
        return
      }
      onSent()
    })
  }

  useEffect(() => {
    if (dismissed) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return
      const index = "abcdef".indexOf(event.key.toLowerCase())
      if (index === -1) return
      event.preventDefault()
      choose(index)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  const options = [...STARTERS.map((starter) => starter.label), "Something else"]

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pb-6 pt-10 md:px-6">
      <div className="starter-in flex flex-col items-center pb-8 text-center">
        <Mascot seed={agentName} figure shadow blink mood="happy" className="h-[120px] w-auto" />
      </div>
      <p className="starter-in inline-block rounded-[22px] bg-panel px-5 py-3 text-[16px] leading-relaxed text-text">
        Hi {firstName(userName)}, I&apos;m {agentName}. What would you like me to do?
      </p>

      {dismissed ? null : (
        <section
          aria-label="Pick a starting point"
          className="starter-in mt-3 rounded-[24px] border border-line bg-panel/70 p-2 [animation-delay:120ms]"
        >
          <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-text">
                Pick a starting point
              </h2>
              <p className="mt-1 text-[14px] text-muted">
                {agentName} sets itself up for whichever you choose, or type your own below.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Hide starting points"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-raised hover:text-text"
            >
              <CloseIcon width={14} height={14} />
            </button>
          </div>
          <ul>
            {options.map((label, index) => (
              <li key={label}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => choose(index)}
                  className={cn(
                    "group flex w-full items-center justify-between gap-4 rounded-2xl px-4 py-3.5 text-left text-[15px] text-text transition-colors hover:bg-raised disabled:cursor-wait",
                    chosen === index && "bg-raised",
                    pending && chosen !== index && "opacity-50",
                  )}
                >
                  <span>{label}</span>
                  <kbd className="grid h-6 min-w-6 place-items-center rounded-md text-[12px] font-medium text-faint transition-colors group-hover:bg-hover group-hover:text-muted">
                    {chosen === index && pending ? "…" : String.fromCharCode(65 + index)}
                  </kbd>
                </button>
              </li>
            ))}
          </ul>
          {error ? (
            <p role="alert" className="px-4 pb-2 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
        </section>
      )}
    </div>
  )
}
