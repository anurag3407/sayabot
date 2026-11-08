"use client"

import { useEffect, useRef, useState } from "react"
import { animate, stagger, utils, type JSAnimation } from "animejs"
import { Check, RotateCcw, ShieldAlert, X } from "lucide-react"
import { LiveMascot, useInView } from "./live-mascot"
import { SectionHead } from "./section-head"

type State = "waiting" | "approved" | "rejected" | "timeout"

/** Five minutes, played back in twelve seconds. */
const DEMO_MS = 12000
const RING = 2 * Math.PI * 52

const VERDICT: Record<Exclude<State, "waiting">, { title: string; body: string }> = {
  approved: { title: "Approved. Hermes deploys.", body: "Your decision is logged, and the team carries on." },
  rejected: { title: "Rejected. Nothing ran.", body: "Hermes is told why it stopped and picks another way." },
  timeout: { title: "No answer means no.", body: "Five minutes of silence counts as a rejection. Nothing ran." },
}

export function ChapterApprove() {
  const root = useRef<HTMLElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const ring = useRef<SVGCircleElement>(null)
  const clock = useRef<HTMLSpanElement>(null)
  const hold = useRef<JSAnimation | null>(null)
  const inView = useInView(root, "-20% 0px")
  const [state, setState] = useState<State>("waiting")
  const [armed, setArmed] = useState(false)
  const [run, setRun] = useState(0)

  useEffect(() => {
    if (inView) setArmed(true)
  }, [inView])

  useEffect(() => {
    if (!armed || state !== "waiting") return
    const time = { left: 300 }
    const countdown = animate(time, {
      left: 0,
      duration: DEMO_MS,
      ease: "linear",
      onUpdate: () => {
        const left = Math.ceil(time.left)
        if (clock.current) clock.current.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
        if (ring.current) ring.current.style.strokeDashoffset = String(RING * (1 - time.left / 300))
      },
      onComplete: () => setState("timeout"),
    })
    return () => {
      countdown.cancel()
    }
  }, [armed, state, run])

  useEffect(() => {
    if (state !== "approved" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const sparks = root.current?.querySelectorAll<HTMLElement>(".ap-spark")
    if (!sparks) return
    animate(sparks, {
      translateX: () => utils.random(-340, 340),
      translateY: () => utils.random(-300, 200),
      rotate: () => utils.random(-200, 200),
      opacity: [{ to: 1, duration: 60 }, { to: 0, delay: 420, duration: 480 }],
      scale: [0.4, 1],
      duration: 1000,
      delay: stagger(9),
      ease: "out(4)",
    })
  }, [state])

  function startHold() {
    if (state !== "waiting" || !fill.current) return
    hold.current = animate(fill.current, { scaleX: [0, 1], duration: 850, ease: "linear", onComplete: () => setState("approved") })
  }
  function endHold() {
    if (state !== "waiting" || !fill.current || !hold.current) return
    hold.current.cancel()
    hold.current = null
    animate(fill.current, { scaleX: 0, duration: 220, ease: "out(3)" })
  }
  function replay() {
    setState("waiting")
    setRun((value) => value + 1)
    if (fill.current) fill.current.style.transform = "scaleX(0)"
    if (ring.current) ring.current.style.strokeDashoffset = "0"
    if (clock.current) clock.current.textContent = "5:00"
  }

  const waiting = state === "waiting"
  const verdict = waiting ? null : VERDICT[state]
  return (
    <section ref={root} id="approve" className="ap-sec l-section" data-state={state}>
      <div className="l-container grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <SectionHead
          act="05"
          label="Human in charge"
          title="Then one reaches for production."
          lead="Dangerous tools stop and wait for a room admin. Answer from the room, the Inbox or your phone. Everything is logged."
        />

        <div data-reveal className="l-card relative mx-auto w-full max-w-[520px] p-6 sm:p-8">
          <div className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden>
            {Array.from({ length: 28 }, (_, index) => (
              <span key={index} className={`ap-spark absolute h-2.5 w-2.5 rounded-[3px] opacity-0 ${["bg-[#ffd08a]", "bg-accent", "bg-m-teal", "bg-m-lilac"][index % 4]}`} />
            ))}
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="h-[120px] w-[84px] shrink-0">
              <LiveMascot seed="Hermes" figure shadow lit={waiting} mood={state === "approved" ? "happy" : waiting ? "alert" : "sleep"} className="block w-full" />
            </div>
            <div className="relative grid h-[120px] w-[120px] shrink-0 place-items-center">
              <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden>
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="7" />
                <circle ref={ring} cx="60" cy="60" r="52" fill="none" stroke="#ffd08a" strokeWidth="7" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset="0" />
              </svg>
              <div className="text-center">
                <span ref={clock} className="block font-mono text-[22px] leading-none">5:00</span>
                <span className="mt-1 block font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">then no</span>
              </div>
            </div>
          </div>

          <p className="mt-6 flex items-center gap-2 text-[14px] text-muted">
            <ShieldAlert className="h-4 w-4 text-accent" /> Hermes wants to run
          </p>
          <p className="l-well mt-2 px-4 py-3.5 font-mono text-[15px]">deploy.sh --env production</p>

          {verdict ? (
            <div className="l-enter mt-5">
              <p className={`flex items-center gap-2 text-[17px] font-medium ${state === "approved" ? "text-ok" : "text-text"}`}>
                {state === "approved" ? <Check className="h-5 w-5" /> : <X className="h-5 w-5 text-accent" />}
                {verdict.title}
              </p>
              <p className="l-body mt-1">{verdict.body}</p>
              <button type="button" onClick={replay} className="mt-4 inline-flex items-center gap-1.5 font-mono text-[12px] text-muted hover:text-text">
                <RotateCcw className="h-3 w-3" /> run it again
              </button>
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-[1.6fr_1fr] gap-2">
              <button
                type="button"
                className="ap-hold l-btn bg-white/10 text-text"
                onPointerDown={startHold}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onPointerCancel={endHold}
                onKeyDown={(event) => {
                  if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                    event.preventDefault()
                    startHold()
                  }
                }}
                onKeyUp={endHold}
              >
                <span ref={fill} className="ap-fill" aria-hidden />
                <span className="relative">Hold to approve</span>
              </button>
              <button type="button" onClick={() => setState("rejected")} className="l-btn l-btn-ghost">Reject</button>
            </div>
          )}
          <p className="mt-4 font-mono text-[11px] text-faint">Demo clock runs fast. The real one is five minutes.</p>
        </div>
      </div>
    </section>
  )
}
