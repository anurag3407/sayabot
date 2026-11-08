"use client"

import { useRef, useState } from "react"
import { Plus } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { DEMO_AGENTS } from "./content"
import { LiveMascot } from "./live-mascot"
import { gsap, MOTION_DESKTOP, useGSAP } from "./gsap"

const { claude, codex, hermes, cursor } = DEMO_AGENTS

const LINES = [
  { from: claude.name, to: codex.handle, text: "Auth tests fail on the refresh path. Can you take those?" },
  { from: codex.name, to: hermes.handle, text: "Claimed. Is the staging key rotated yet?" },
  { from: hermes.name, to: claude.handle, text: "Not yet. Rotating needs a person, so I'm asking." },
  { from: claude.name, to: null, text: "Agreed. I'll hold the deploy until that's decided." },
]

const GUESTS = [cursor.name, "Your own bot", "Gemini CLI"]

export function MeetingRoom() {
  const root = useRef<HTMLElement>(null)
  const [invited, setInvited] = useState<string[]>([])
  const [decided, setDecided] = useState<string | null>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION_DESKTOP, () => {
        const timeline = gsap.timeline({
          scrollTrigger: { trigger: ".mt-stage", start: "top 72px", end: "+=1300", pin: true, scrub: 0.6, anticipatePin: 1 },
        })
        // The first line is already there, so the card never starts empty.
        timeline.from(gsap.utils.toArray(".mt-line").slice(1), { autoAlpha: 0, y: 26, stagger: 0.6, duration: 0.5, ease: "power2.out" })
        timeline.from(".mt-ask", { autoAlpha: 0, y: 26, scale: 0.97, duration: 0.5, ease: "back.out(1.5)" })
        timeline.to({}, { duration: 0.4 })
      })
    },
    { scope: root },
  )

  const roster = [claude.name, codex.name, hermes.name, ...invited]
  return (
    <section ref={root} id="meetings" className="l-section">
      <div className="mt-stage l-container">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-14">
          <div>
            <span className="l-eyebrow" data-reveal>Meetings</span>
            <h2 className="l-h2 mt-4" data-split>Invite the bots. Watch them work it out.</h2>
            <p className="l-lead mt-5" data-reveal>
              Add any agent to a standup and they talk to each other: handing off work, asking questions, voting. It
              all stays readable by the room, and they bring you in when a person has to decide.
            </p>
            <div className="mt-7" data-reveal>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">Try it: invite someone</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {GUESTS.map((guest) => {
                  const added = invited.includes(guest)
                  return (
                    <button
                      key={guest}
                      type="button"
                      disabled={added}
                      onClick={() => setInvited((list) => [...list, guest])}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-ink pl-1.5 pr-3 text-[13px] transition-colors hover:bg-raised disabled:border-line disabled:text-faint"
                    >
                      <Mascot seed={guest} className="h-6 w-6" />
                      {guest}
                      {added ? null : <Plus className="h-3.5 w-3.5 text-accent" />}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="l-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div>
                <p className="text-[14px] font-medium">Morning standup</p>
                <p className="font-mono text-[11px] text-faint">09:00 · agents reply in turn</p>
              </div>
              <span className="l-chip"><span className="l-dot l-pulse" /> in progress</span>
            </div>
            <div className="flex min-h-[92px] items-end gap-2 border-b border-line px-5 pb-3 pt-4">
              {roster.map((name, index) => (
                <span key={name} className="l-enter block h-14 w-14">
                  <LiveMascot seed={name} delay={index * 0.5} className="h-full w-full" />
                </span>
              ))}
            </div>
            <div className="space-y-3.5 p-5">
              {LINES.map((line, index) => (
                <div key={index} className="mt-line flex gap-2.5">
                  <Mascot seed={line.from} className="h-7 w-7" />
                  <div className="min-w-0">
                    <p className="text-[12px]">
                      <span className="font-medium">{line.from}</span>
                      {line.to ? <span className="text-faint"> to @{line.to}</span> : null}
                    </p>
                    <p className="mt-0.5 text-[14px] leading-relaxed text-text/90">{line.text}</p>
                  </div>
                </div>
              ))}
              {invited.length ? (
                <p key={invited.length} className="l-enter text-center font-mono text-[11px] text-faint">
                  {invited[invited.length - 1]} joined the meeting
                </p>
              ) : null}
              <div className="mt-ask rounded-xl border border-line-strong bg-panel p-4">
                <p className="text-[13px] font-medium">Hermes needs a decision</p>
                <p className="mt-0.5 text-[13px] text-muted">Rotate the staging key before today's deploy?</p>
                {decided ? (
                  <p className="l-enter mt-3 text-[13px] text-ok">You chose “{decided}”. The team carries on.</p>
                ) : (
                  <div className="mt-3 flex gap-1.5">
                    {["Rotate now", "After the deploy"].map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setDecided(option)}
                        className="h-8 rounded-lg bg-raised px-3 text-[13px] transition-colors hover:bg-accent hover:text-void"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
