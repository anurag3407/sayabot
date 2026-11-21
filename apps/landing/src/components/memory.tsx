"use client"

import { useRef, useState } from "react"
import type { SayaShape } from "@sayabot/core/mascot"
import { useInView, useSequence } from "@/lib/motion"
import { Reveal } from "./reveal"
import { Saya } from "./saya"

type Memory = {
  kind: string
  scope: string
  title: string
  detail: string
  shape: SayaShape
}

const NOTES: Memory[] = [
  {
    kind: "Preference",
    scope: "This room",
    title: "Invoices go out on the 1st. Net 15.",
    detail: "You said it once. Ledger has used it on every run since.",
    shape: "ledger",
  },
  {
    kind: "Decision",
    scope: "The workspace",
    title: "Northwind refunds hit the operating account.",
    detail: "A decision the room already made. It applies in every room.",
    shape: "block",
  },
  {
    kind: "Still open",
    scope: "Due Friday",
    title: "Waiting on Priya's Q3 receipt.",
    detail: "An open promise stays open, with a due date, until someone closes it.",
    shape: "hoot",
  },
  {
    kind: "Fact",
    scope: "This agent",
    title: "Staging lives at staging.northwind.dev.",
    detail: "Private to this agent. The others never see it.",
    shape: "sprout",
  },
]

const POINTS = [
  {
    title: "Three places a note can live",
    body: "With one agent, with everyone in the room, or with the whole workspace.",
  },
  {
    title: "An answer is kept",
    body: "Ask once. The next run reads the fact and skips the question.",
  },
  {
    title: "Written on its computer",
    body: "The same notes land as files in /home/bot, so a later run can open them.",
  },
]

const SCOPES = ["This agent", "This room", "The workspace"]

function scopeOf(note: Memory): string {
  if (note.scope === "This agent") return "This agent"
  if (note.scope === "The workspace") return "The workspace"
  return "This room"
}

export function Memory() {
  const ref = useRef<HTMLDivElement>(null)
  const on = useInView(ref)
  const [picked, setPicked] = useState<number | null>(null)
  const sequence = useSequence([3200, 3200, 3200, 3200], on && picked === null)
  const step = picked ?? sequence
  const note = NOTES[step] ?? NOTES[0]
  if (!note) return null

  return (
    <section className="section" id="memory" aria-labelledby="memory-title">
      <div className="wrap story-split">
        <Reveal>
          <span className="eyebrow">Memory</span>
          <h2 className="h2" id="memory-title">
            They still know in the <em>morning</em>.
          </h2>
          <p className="lede">
            The next run starts from what you already decided. A preference, a fact, an open
            promise. Not from a blank chat.
          </p>
          <ol className="story-points story-points-num">
            {POINTS.map((point, index) => (
              <li key={point.title}>
                <span className="story-num" aria-hidden>
                  {index + 1}
                </span>
                <strong>{point.title}</strong>
                <span>{point.body}</span>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal index={1}>
          <div ref={ref} className="mem-card card">
            <div className="mem-top">
              <Saya shape={note.shape} mood="thinking" live lit className="mem-face" />
              <span className="mem-top-copy">
                <strong>Recalled for this run</strong>
                <span>
                  {NOTES.length} notes · read before the first step
                </span>
              </span>
            </div>
            <ul className="mem-list">
              {NOTES.map((item, index) => {
                const open = index === step
                return (
                  <li key={item.kind}>
                    <button
                      type="button"
                      onClick={() => setPicked(index)}
                      aria-expanded={open}
                      className={`mem-row ${open ? "is-on" : ""}`}
                    >
                      <span className={`mem-kind ${item.kind === "Still open" ? "is-open" : ""}`}>
                        {item.kind}
                      </span>
                      <span className="mem-title">{item.title}</span>
                      {open ? <span className="mem-detail">{item.detail}</span> : null}
                      <span className="mem-used" aria-hidden>
                        {open ? "used ✓" : ""}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="mem-scopes" aria-label="Where this note lives">
              {SCOPES.map((scope) => (
                <span key={scope} className={scope === scopeOf(note) ? "is-on" : ""}>
                  {scope}
                </span>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
