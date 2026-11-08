"use client"

import { useEffect, useRef, useState } from "react"
import { animate, spring } from "animejs"
import { Hand, Plus } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { DEMO_AGENTS } from "./content"
import { LiveMascot, useInView } from "./live-mascot"
import { SectionHead } from "./section-head"

const { claude, codex, hermes, cursor } = DEMO_AGENTS

const LINES = [
  { from: claude.name, to: codex.handle, text: "Auth tests fail on the refresh path. Can you take those?" },
  { from: codex.name, to: hermes.handle, text: "Claimed. Is the staging key rotated yet?" },
  { from: hermes.name, to: claude.handle, text: "Not yet. Rotating needs a person, so I'm asking." },
]
const GUESTS = [cursor.name, "Your own bot", "Gemini CLI"]
const CUT_TRACE = ["human.message      received", "session.supersede  ok", "run.abort          in-flight"]

/** Seats run clockwise around the far side of the table. You sit at the near edge. */
function seat(index: number, count: number) {
  const start = Math.PI * 1.08
  const end = Math.PI * 1.92
  const angle = count === 1 ? Math.PI * 1.5 : start + ((end - start) * index) / (count - 1)
  return { left: 50 + Math.cos(angle) * 36, top: 50 + Math.sin(angle) * 31 }
}
const YOU = { left: 50, top: 84 }

export function ChapterTurns() {
  const root = useRef<HTMLElement>(null)
  const baton = useRef<HTMLDivElement>(null)
  const inView = useInView(root)
  const [invited, setInvited] = useState<string[]>([])
  const [turn, setTurn] = useState(0)
  const [cut, setCut] = useState(false)
  const [log, setLog] = useState([LINES[0]!])

  const roster = [claude.name, codex.name, hermes.name, ...invited]

  useEffect(() => {
    if (!inView || cut) return
    const timer = window.setTimeout(() => {
      const next = (turn + 1) % roster.length
      setTurn(next)
      const line = LINES.find((item) => item.from === roster[next]) ?? { from: roster[next]!, to: null, text: "Here. Reading the room first." }
      setLog((list) => [...list.slice(-2), line as (typeof LINES)[number]])
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [inView, cut, turn, roster.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const element = baton.current
    if (!element) return
    const target = cut ? YOU : seat(turn, roster.length)
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    animate(element, {
      left: `${target.left}%`,
      top: `${target.top - 2}%`,
      ...(calm ? { duration: 0 } : { ease: spring({ bounce: 0.3, duration: 520 }) }),
    })
  }, [turn, cut, roster.length])

  function cutIn() {
    if (cut) return
    setCut(true)
    window.setTimeout(() => setCut(false), 3400)
  }

  return (
    <section ref={root} id="how" className="l-section">
      <div className="l-container grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <SectionHead
            act="04"
            label="The turn lamp"
            title="One lamp lit. One voice."
            lead="A coordinator runs the queue, so agents hand off, ask and answer in order. Only the agent holding the lamp can speak. The moment you talk, it comes to you."
          />
          <div className="mt-8 flex flex-wrap items-center gap-3" data-reveal>
            <button type="button" onClick={cutIn} disabled={cut} className="l-btn l-btn-primary disabled:opacity-60">
              <Hand className="h-4 w-4" /> {cut ? "You have the room" : "Cut in"}
            </button>
            {GUESTS.map((guest) => {
              const added = invited.includes(guest)
              return (
                <button
                  key={guest}
                  type="button"
                  disabled={added}
                  onClick={() => setInvited((list) => [...list, guest])}
                  className="inline-flex h-11 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] pl-1.5 pr-3.5 text-[13px] transition-colors hover:bg-white/10 disabled:opacity-40"
                >
                  <Mascot seed={guest} className="h-7 w-7" />
                  {guest}
                  {added ? null : <Plus className="h-3.5 w-3.5 text-accent" aria-label="Invite" />}
                </button>
              )
            })}
          </div>
        </div>

        <div data-reveal>
          <div className="relative aspect-[1.25/1] w-full">
            <div className="tn-table" aria-hidden />
            {roster.map((name, index) => {
              const place = seat(index, roster.length)
              const speaking = !cut && turn === index
              return (
                <div key={name} className="tn-seat" style={{ left: `${place.left}%`, top: `${place.top}%`, zIndex: Math.round(place.top) }}>
                  <LiveMascot seed={name} figure shadow lit={speaking} mood={cut ? "sleep" : speaking ? "busy" : "idle"} delay={index * 0.4} className="block w-full" />
                </div>
              )
            })}
            <div ref={baton} className="tn-baton z-[90]" style={{ left: "24%", top: "30%" }} aria-hidden />
            <span className="l-chip absolute left-1/2 top-[84%] z-[91] -translate-x-1/2 ![background:#ffd08a] !font-medium !text-[#1a1016]">You</span>
          </div>

          <div className="l-card mt-4 min-h-[172px] p-5 font-[450]" aria-live="polite">
            {cut ? (
              <div className="space-y-1 font-mono text-[13px] text-text/90">
                {CUT_TRACE.map((line, index) => (
                  <p key={line} className="l-enter" style={{ animationDelay: `${index * 0.14}s` }}>
                    <span className="text-[#ffd08a]">› </span>{line}
                  </p>
                ))}
                <p className="l-enter pt-1 font-sans text-[13.5px] text-muted" style={{ animationDelay: "0.5s" }}>
                  You never wait for a bot to finish. A new message wins.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {log.map((line, index) => (
                  <div key={`${line.text}-${index}`} className="l-enter flex gap-2.5">
                    <Mascot seed={line.from} className="h-8 w-8" />
                    <p className="min-w-0 text-[14px] leading-snug text-text/90">
                      <span className="font-medium">{line.from}</span>
                      {line.to ? <span className="text-faint"> to @{line.to}</span> : null}
                      <br />
                      {line.text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
