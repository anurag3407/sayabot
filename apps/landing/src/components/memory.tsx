"use client"

import { useRef } from "react"
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

export function Memory() {
  const ref = useRef<HTMLDivElement>(null)
  const on = useInView(ref)
  const step = useSequence([3200, 3200, 3200, 3200], on)
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
          <ul className="story-points">
            {POINTS.map((point) => (
              <li key={point.title}>
                <strong>{point.title}</strong>
                <span>{point.body}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal index={1}>
          <div ref={ref} className="mem-stage" aria-hidden>
            <div className="mem-card card">
              <div className="mem-top">
                <span className="mono">Recalled for this run</span>
                <Saya shape={note.shape} mood="thinking" live className="mem-face" />
              </div>
              <div className="mem-slip" key={note.kind}>
                <div className="mem-kicker">
                  <span className={`mem-kind ${note.kind === "Still open" ? "is-open" : ""}`}>
                    {note.kind}
                  </span>
                  <span className="mem-scope">{note.scope}</span>
                </div>
                <p className="mem-title">{note.title}</p>
                <p className="mem-detail">{note.detail}</p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
