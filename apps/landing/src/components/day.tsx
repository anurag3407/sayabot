"use client"

import { useEffect, useRef, useState } from "react"
import type { SayaMood, SayaShape } from "@sayabot/core/mascot"
import { useInView } from "@/lib/motion"
import { Reveal } from "./reveal"
import { Saya } from "./saya"

type Beat = {
  time: string
  title: string
  body: string
  /** What the agent actually posts at that hour. */
  post: string
  who: string
  shape: SayaShape
  mood: SayaMood
  sky: "dawn" | "day" | "ask" | "dusk" | "night"
}

const BEATS: Beat[] = [
  {
    time: "9:00",
    title: "Morning",
    body: "The room's morning window opens. Ledger reports what moved overnight and the one thing that needs you.",
    post: "Overnight: 3 invoices paid, $4,120 in. One needs you: Northwind is 12 days late.",
    who: "Ledger",
    shape: "ledger",
    mood: "working",
    sky: "dawn",
  },
  {
    time: "11:40",
    title: "Check-in",
    body: "Northwind is still open. It asks once, then waits, instead of pinging you on a loop.",
    post: "Sent Northwind a polite nudge. I'll check again at 4, not before.",
    who: "Block",
    shape: "block",
    mood: "thinking",
    sky: "day",
  },
  {
    time: "2:15",
    title: "A question",
    body: "Which account? The question lands on your phone. The room holds until you answer.",
    post: "Refund for order #2231: operating or savings account?",
    who: "Hoot",
    shape: "hoot",
    mood: "waiting",
    sky: "ask",
  },
  {
    time: "5:00",
    title: "Evening",
    body: "The evening window. What's done, what it cost, and the one loop still open until Friday.",
    post: "Done today: 9 tasks, $0.42 in tokens. Still open: Priya's Q3 receipt, due Friday.",
    who: "Peak",
    shape: "peak",
    mood: "done",
    sky: "dusk",
  },
  {
    time: "3:00",
    title: "Overnight",
    body: "The room goes quiet. Computers that stay awake keep their routines. Yours sleeps with the Mac.",
    post: "Nightly backup verified. Going quiet until 9.",
    who: "Saya",
    shape: "ghost",
    mood: "sleeping",
    sky: "night",
  },
]

const STEP_MS = 4600

export function Day() {
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref)
  const beat = BEATS[active] ?? BEATS[0]
  const playing = auto && visible

  useEffect(() => {
    if (!playing || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setTimeout(() => setActive((value) => (value + 1) % BEATS.length), STEP_MS)
    return () => window.clearTimeout(timer)
  }, [active, playing])

  if (!beat) return null

  return (
    <section className="section" id="day" aria-labelledby="day-title">
      <div className="wrap">
        <div className="day-head">
          <Reveal>
            <span className="eyebrow">The day</span>
            <h2 className="h2" id="day-title">
              A room keeps <em>office hours</em>.
            </h2>
            <p className="lede">
              Give a room a morning, an evening, and check-ins in between. Pick an hour, or let the
              day play through.
            </p>
          </Reveal>
          <button
            type="button"
            className="day-play"
            onClick={() => setAuto((value) => !value)}
            aria-pressed={auto}
          >
            <span className={`day-play-icon ${auto ? "is-pause" : ""}`} aria-hidden />
            {auto ? "Pause the day" : "Play the day"}
          </button>
        </div>

        <div ref={ref} className="day2">
          <div className="day-rail" role="tablist" aria-label="A room's day">
            {BEATS.map((item, index) => {
              const on = index === active
              return (
                <button
                  key={item.time}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls="day-stage"
                  className={`day-stop ${on ? "is-on" : ""} ${index < active ? "is-past" : ""}`}
                  onClick={() => {
                    setActive(index)
                    setAuto(false)
                  }}
                >
                  <span className="day-stop-time">{item.time}</span>
                  <span className="day-stop-name">{item.title}</span>
                  <Saya shape={item.shape} mood={on ? item.mood : "idle"} className="day-stop-face" />
                  {on ? (
                    <span className="day-stop-bar" aria-hidden>
                      <span
                        key={`${active}-${playing}`}
                        className={playing ? "is-running" : ""}
                        style={{ animationDuration: `${STEP_MS}ms` }}
                      />
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>

          <div id="day-stage" className={`day-stage sky-${beat.sky}`} role="tabpanel" aria-live="polite">
            <div className="day-stars" aria-hidden />
            <div className="day-orb" aria-hidden />
            <div className="day-stage-copy" key={beat.time}>
              <span className="day-stage-time">{beat.time}</span>
              <h3 className="day-stage-title">{beat.title}</h3>
              <p className="day-stage-body">{beat.body}</p>
            </div>
            <div className="day-post" key={`post-${beat.time}`}>
              <Saya shape={beat.shape} mood={beat.mood} live lit className="day-post-face" />
              <div className="day-post-bubble">
                <span className="day-post-who">
                  {beat.who} <span>· #finance</span>
                </span>
                <p>{beat.post}</p>
              </div>
            </div>
          </div>
        </div>
        <p className="day-note">
          Morning is 9:00 and evening is 5:00 unless you move them. Every room keeps its own hours
          and timezone.
        </p>
      </div>
    </section>
  )
}
