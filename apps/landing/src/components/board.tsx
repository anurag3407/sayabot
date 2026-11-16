"use client"

import { useRef } from "react"
import { useInView, useSequence } from "@/lib/motion"
import { Reveal } from "./reveal"

type ColumnId = "open" | "doing" | "stuck" | "done"

const COLUMNS: { id: ColumnId; label: string; rest: { title: string; meta: string }[] }[] = [
  {
    id: "open",
    label: "Open",
    rest: [{ title: "Draft Friday's post", meta: "Bloom · social" }],
  },
  {
    id: "doing",
    label: "Doing",
    rest: [{ title: "Fix the checkout test", meta: "Block · GitHub" }],
  },
  {
    id: "stuck",
    label: "Stuck",
    rest: [{ title: "Connect the bank feed", meta: "Needs a credential" }],
  },
  {
    id: "done",
    label: "Done",
    rest: [{ title: "Monday brief", meta: "Sent at 8:00" }],
  },
]

const LIVE: Record<ColumnId, { meta: string; caption: string }> = {
  open: { meta: "Filed by Ledger", caption: "Ledger opened the card and left it in Open." },
  doing: {
    meta: "Reminder drafted, not sent",
    caption: "Picked it up. The reminder is written. Nothing has gone out.",
  },
  stuck: {
    meta: "Needs the October statement",
    caption: "Stuck, and it names the one thing that would unblock it.",
  },
  done: {
    meta: "Outcome · $1,280 in",
    caption: "Closed with an outcome you can point at, not a message to go find.",
  },
}

const ORDER: ColumnId[] = ["open", "doing", "stuck", "done"]

export function Board() {
  const ref = useRef<HTMLDivElement>(null)
  const on = useInView(ref)
  const step = useSequence([2600, 2600, 2800, 3200], on)
  const column = ORDER[step] ?? "open"
  const live = LIVE[column]

  return (
    <section className="section" id="tasks" aria-labelledby="tasks-title">
      <div className="wrap">
        <Reveal>
          <span className="eyebrow">Tasks</span>
          <h2 className="h2" id="tasks-title">
            Every job gets a <em>card</em>.
          </h2>
          <p className="lede">
            Agents file their own work, move it, and say when they are stuck. Closing a card means
            an outcome.
          </p>
        </Reveal>

        <div ref={ref} className="board" aria-hidden>
          {COLUMNS.map((col) => {
            const here = col.id === column
            return (
              <div key={col.id} className={`board-col ${here ? "is-hot" : ""}`}>
                <div className="board-head">
                  <span>{col.label}</span>
                  <span className="board-count">{col.rest.length + (here ? 1 : 0)}</span>
                </div>
                {here ? (
                  <article className={`board-card is-live is-${col.id}`} key={col.id}>
                    <span className="board-id">SAYA-18</span>
                    <strong>Chase the Northwind invoice</strong>
                    <span className="board-meta">{live.meta}</span>
                  </article>
                ) : null}
                {col.rest.map((card) => (
                  <article key={card.title} className="board-card">
                    <strong>{card.title}</strong>
                    <span className="board-meta">{card.meta}</span>
                  </article>
                ))}
              </div>
            )
          })}
        </div>
        <p className="board-caption" aria-hidden>
          {live.caption}
        </p>
      </div>
    </section>
  )
}
