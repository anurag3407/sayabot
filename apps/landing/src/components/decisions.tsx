"use client"

import { useRef } from "react"
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
  const step = useSequence([3400, 3400, 3400], on)

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
          <div ref={ref} className="ask-stack" aria-hidden>
            {SLIPS.map((slip, index) => (
              <div
                key={slip.kind}
                className={`ask-slip card ask-${slip.tone} ${index === step ? "is-on" : ""}`}
              >
                <div className="ask-head">
                  <Saya
                    shape={slip.shape}
                    mood={slip.tone === "stop" ? "idle" : "waiting"}
                    className="ask-face"
                  />
                  <span className="ask-kind">{slip.kind}</span>
                  <span className="ask-who">{slip.who}</span>
                </div>
                <p className="ask-title">{slip.title}</p>
                <p className="ask-detail">{slip.detail}</p>
                {slip.choices.length > 0 ? (
                  <div className="ask-choices">
                    {slip.choices.map((choice, choiceIndex) => (
                      <span
                        key={choice}
                        className={`ask-choice ${choiceIndex === 0 ? "is-primary" : ""}`}
                      >
                        {choice}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="ask-denied">Denied</span>
                )}
                <p className="ask-note">{slip.note}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
