"use client"

import { useRef, useState } from "react"
import type { SayaShape } from "@sayabot/core/mascot"
import { useInView, useSequence } from "@/lib/motion"
import { Reveal } from "./reveal"
import { Saya } from "./saya"

type Slip = {
  kind: string
  who: string
  tone: "wait" | "ask" | "stop"
  shape: SayaShape
  title: string
  detail: string
  choices: string[]
  note: string
}

const SLIPS: Slip[] = [
  {
    kind: "Approval",
    who: "Ledger",
    tone: "wait",
    shape: "ledger",
    title: "Post in #billing?",
    detail: "October is reconciled. $1,280 came in from Northwind.",
    choices: ["Allow", "Not now"],
    note: "4:12 left. Silence counts as a no.",
  },
  {
    kind: "Question",
    who: "Ledger",
    tone: "ask",
    shape: "ledger",
    title: "Which account should the refund hit?",
    detail: "Nothing on file matches, so it stopped to ask.",
    choices: ["Operating", "Savings"],
    note: "Your answer is saved. It will not ask twice.",
  },
  {
    kind: "Stopped",
    who: "Block",
    tone: "stop",
    shape: "block",
    title: "bash · rm -rf build/",
    detail: "You said no. The command did not run.",
    choices: [],
    note: "On the record, with your name next to it.",
  },
]

const POINTS = [
  {
    title: "You see the exact action",
    body: "The card names the tool and what it is about to do, before anything happens.",
  },
  {
    title: "The same question, everywhere",
    body: "Your phone, the inbox, and the chat the agent is already in.",
  },
  {
    title: "Five quiet minutes is a no",
    body: "The tool never runs. The agent is told, and it moves on.",
  },
]

export function Decisions() {
  const ref = useRef<HTMLDivElement>(null)
  const on = useInView(ref)
  const [picked, setPicked] = useState<number | null>(null)
  const sequence = useSequence([3800, 3800, 3800], on && picked === null)
  const step = picked ?? sequence

  return (
    <section className="section" id="decisions" aria-labelledby="decisions-title">
      <div className="wrap story-split story-split-flip">
        <Reveal>
          <span className="eyebrow">A yes, first</span>
          <h2 className="h2" id="decisions-title">
            Risky things wait for a <em>yes</em>.
          </h2>
          <p className="lede">
            Anything that sends, deletes, spends or leaves the machine stops the turn. Everything
            else just runs.
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
          <div ref={ref} className="ask-device">
            <div className="ask-device-bar">
              <span className="ask-device-dot" aria-hidden />
              <span>Inbox</span>
              <span className="ask-device-count">Needs you · {step < 2 ? 1 : 0}</span>
            </div>
            <div className="ask-list">
              {SLIPS.map((slip, index) => {
                const open = index === step
                return (
                  <button
                    type="button"
                    key={slip.kind}
                    onClick={() => setPicked(index)}
                    aria-expanded={open}
                    className={`ask-row ask-${slip.tone} ${open ? "is-on" : ""}`}
                  >
                    <span className="ask-head">
                      <Saya
                        shape={slip.shape}
                        mood={slip.tone === "stop" ? "idle" : open ? "waiting" : "idle"}
                        live={open}
                        className="ask-face"
                      />
                      <span className="ask-kind">{slip.kind}</span>
                      <span className="ask-row-title">{slip.title}</span>
                      <span className="ask-who">{slip.who}</span>
                    </span>
                    {open ? (
                      <span className="ask-body">
                        <span className="ask-title">{slip.title}</span>
                        <span className="ask-detail">{slip.detail}</span>
                        {slip.choices.length > 0 ? (
                          <span className="ask-choices">
                            {slip.choices.map((choice, choiceIndex) => (
                              <span
                                key={choice}
                                className={`ask-choice ${choiceIndex === 0 ? "is-primary" : ""}`}
                              >
                                {choice}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="ask-denied">Denied</span>
                        )}
                        {slip.tone === "wait" ? (
                          <span className="ask-timer" aria-hidden>
                            <span key={`${step}-${picked}`} />
                          </span>
                        ) : null}
                        <span className="ask-note">{slip.note}</span>
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
