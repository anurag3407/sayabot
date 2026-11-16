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
  shape: SayaShape
  mood: SayaMood
}

const BEATS: Beat[] = [
  {
    time: "9:00",
    title: "Morning",
    body: "The room's morning window opens. Ledger reports what moved overnight and the one thing that needs you.",
    shape: "ledger",
    mood: "working",
  },
  {
    time: "11:40",
    title: "Check-in",
    body: "Northwind is still open. It asks once, then waits, instead of pinging you on a loop.",
    shape: "block",
    mood: "thinking",
  },
  {
    time: "2:15",
    title: "A question",
    body: "Which account? The question lands on your phone. The room holds until you answer.",
    shape: "hoot",
    mood: "waiting",
  },
  {
    time: "5:00",
    title: "Evening",
    body: "The evening window. What's done, what it cost, and the one loop still open until Friday.",
    shape: "peak",
    mood: "done",
  },
  {
    time: "3:00",
    title: "Overnight",
    body: "The room goes quiet. Computers that stay awake keep their routines. Yours sleeps with the Mac.",
    shape: "ghost",
    mood: "sleeping",
  },
]

export function Day() {
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref)
  const beat = BEATS[active] ?? BEATS[0]

  useEffect(() => {
    if (!auto || !visible || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const timer = window.setTimeout(() => setActive((value) => (value + 1) % BEATS.length), 4200)
    return () => window.clearTimeout(timer)
  }, [active, auto, visible])

  if (!beat) return null

  return (
    <section className="section" id="day" aria-labelledby="day-title">
      <div className="wrap">
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

        <div ref={ref} className="day-list" role="tablist" aria-label="A room's day">
          {BEATS.map((item, index) => {
            const on = index === active
            return (
              <button
                key={item.time}
                type="button"
                role="tab"
                aria-selected={on}
                className={`day-beat ${on ? "is-on" : ""}`}
                onClick={() => {
                  setActive(index)
                  setAuto(false)
                }}
              >
                <span className="day-time">{item.time}</span>
                <span className="day-mark" aria-hidden>
                  <span className="day-dot" />
                </span>
                <span className="day-copy">
                  <span className="day-name">{item.title}</span>
                  <span className="day-body">{item.body}</span>
                </span>
                <Saya
                  shape={item.shape}
                  mood={on ? item.mood : "idle"}
                  live={on}
                  className="day-face"
                />
              </button>
            )
          })}
        </div>
        <p className="day-note">
          {auto ? "Playing through a sample day." : `Holding at ${beat.time}.`} Morning is 9:00 and
          evening is 5:00 unless you move them.
        </p>
      </div>
    </section>
  )
}
