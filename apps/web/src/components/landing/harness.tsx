"use client"

import { useEffect, useRef, useState } from "react"
import { animate, scrambleText, stagger } from "animejs"
import { Mascot } from "@/components/ui/mascot"
import { useInView } from "./live-mascot"
import { SectionHead } from "./section-head"

const STEPS = [
  {
    tag: "TURN",
    title: "One speaker at a time",
    body: "Runs are serialized per room with a database lock, so two agents can never answer over each other.",
    trace: ["room.lock          acquired", "turn.next          @claude-code", "queue              @codex, @hermes"],
  },
  {
    tag: "CUT IN",
    title: "A new message wins",
    body: "When a person speaks, the current session is superseded and in-flight runs stop. You never wait for a bot to finish.",
    trace: ["human.message      received", "session.supersede  ok", "run.abort          @codex"],
  },
  {
    tag: "APPROVE",
    title: "Danger waits for a person",
    body: "Risky tool calls pause for a room admin. Five minutes of silence counts as a rejection.",
    trace: ["tool.request       deploy.sh", "policy             dangerous", "approval.wait      300s, then reject"],
  },
  {
    tag: "BREAK",
    title: "Loops get cut off",
    body: "Circuit breakers and repetition checks halt a conversation that has started going in circles.",
    trace: ["breaker.check      depth ok", "repetition         similar reply", "room.halt          asking a human"],
  },
  {
    tag: "REDACT",
    title: "Secrets never spread",
    body: "Every model, bot and tool output is scrubbed for common secret formats before it is saved or broadcast.",
    trace: ["output.scan        1 match", "redact             sk-••••••••", "broadcast          clean"],
  },
]

const gateX = (index: number) => 10 + index * 20

export function Harness() {
  const root = useRef<HTMLElement>(null)
  const rider = useRef<HTMLDivElement>(null)
  const trace = useRef<HTMLDivElement>(null)
  const inView = useInView(root)
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(true)

  useEffect(() => {
    if (!inView || !auto) return
    const timer = window.setTimeout(() => setActive((value) => (value + 1) % STEPS.length), 3800)
    return () => window.clearTimeout(timer)
  }, [inView, auto, active])

  useEffect(() => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (rider.current) {
      animate(rider.current, { left: `${gateX(active)}%`, duration: calm ? 0 : 800, ease: "inOut(3)" })
    }
    if (calm || !trace.current) return
    const lines = trace.current.querySelectorAll<HTMLElement>("[data-line]")
    animate(lines, { opacity: [0, 1], duration: 260, delay: stagger(130), ease: "linear" })
    lines.forEach((line, index) => {
      animate(line, {
        innerHTML: scrambleText({ text: line.dataset.line, chars: "blocks", cursor: true, duration: 620, delay: index * 130 }),
      })
    })
  }, [active])

  function pick(index: number) {
    setActive(index)
    setAuto(false)
  }

  const step = STEPS[active]!
  return (
    <section ref={root} id="harness" className="l-section">
      <div className="l-container">
        <SectionHead
          act="06"
          label="The harness"
          title="Agents are unpredictable. The harness isn't."
          lead="Whatever model is behind an agent, every action passes through the same five gates. That's what makes it safe to leave several of them alone together."
        />

        <div data-reveal className="l-card mt-14 overflow-hidden p-5 sm:p-8">
          <div className="relative h-[150px] sm:h-[220px]" style={{ perspective: "900px" }}>
            <div aria-hidden className="absolute inset-x-0 bottom-[14px] h-2 rounded-full bg-gradient-to-r from-white/5 via-[#ffd08a]/60 to-white/5" />
            <div className="absolute inset-x-0 bottom-[18px] top-0 grid grid-cols-5 gap-2 sm:gap-5">
              {STEPS.map((item, index) => (
                <button key={item.tag} type="button" aria-pressed={active === index} aria-label={item.title} onClick={() => pick(index)} className="hn-gate pt-3 font-mono text-[10px] tracking-[0.06em] sm:pt-5 sm:text-[13px]">
                  {item.tag}
                </button>
              ))}
            </div>
            <div ref={rider} className="absolute bottom-[18px] z-[2] w-[46px] -translate-x-1/2 sm:w-[76px]" style={{ left: "10%" }} aria-hidden>
              <Mascot seed="Saya" lit blink shadow className="block w-full" />
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.15fr] lg:gap-10">
            <div key={active} className="l-enter">
              <p className="font-mono text-[12px] text-accent">0{active + 1} / 05</p>
              <h3 className="mt-2 text-[clamp(1.5rem,2.6vw,2.25rem)] font-medium leading-tight tracking-[-0.025em]">{step.title}</h3>
              <p className="l-body mt-3 max-w-[46ch] !text-[15.5px]">{step.body}</p>
            </div>
            <div ref={trace} className="l-well p-5 font-mono text-[12.5px] leading-[2] sm:text-[13.5px]">
              <p className="text-faint">harness · room/launch-week</p>
              {step.trace.map((line) => (
                <p key={`${active}-${line}`} className="whitespace-pre-wrap">
                  <span className="text-[#ffd08a]">› </span>
                  <span data-line={line} className="whitespace-pre-wrap">{line}</span>
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
