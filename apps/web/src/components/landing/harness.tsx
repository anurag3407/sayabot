"use client"

import { Fragment, useEffect, useRef, useState } from "react"
import { Mascot } from "@/components/ui/mascot"
import { DEMO_AGENTS } from "./content"
import { useInView } from "./live-mascot"

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

export function Harness() {
  const root = useRef<HTMLElement>(null)
  const inView = useInView(root)
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(true)

  useEffect(() => {
    if (!inView || !auto) return
    const timer = window.setTimeout(() => setActive((value) => (value + 1) % STEPS.length), 4200)
    return () => window.clearTimeout(timer)
  }, [inView, auto, active])

  const step = STEPS[active]!
  return (
    <section ref={root} id="harness" className="l-section">
      <div className="l-container">
        <span className="l-eyebrow" data-reveal>The harness</span>
        <h2 className="l-h2 mt-4 max-w-[20ch]" data-split>Agents are unpredictable. The harness isn't.</h2>
        <p className="l-lead mt-5 max-w-[58ch]" data-reveal>
          Whatever model is behind an agent, every action passes through the same rails. That's what makes it safe to
          leave several of them alone together.
        </p>

        <div data-reveal className="l-card mt-12 overflow-hidden lg:grid lg:grid-cols-[1.25fr_1fr]">
          <div className="min-w-0 border-b border-line p-5 sm:p-8 lg:border-b-0 lg:border-r">
            <div className="flex items-center">
              <div className="flex shrink-0 flex-col gap-1">
                {[DEMO_AGENTS.claude.name, DEMO_AGENTS.codex.name, DEMO_AGENTS.hermes.name].map((name) => (
                  <Mascot key={name} seed={name} mood={active === 1 ? "sleep" : "idle"} className="h-9 w-9" />
                ))}
              </div>
              <span className="l-flow mx-1.5 w-3 shrink sm:w-6" data-on="true" />
              {STEPS.map((item, index) => (
                <Fragment key={item.tag}>
                  <button
                    type="button"
                    onClick={() => {
                      setActive(index)
                      setAuto(false)
                    }}
                    aria-pressed={active === index}
                    aria-label={item.title}
                    className={`grid h-9 min-w-0 flex-1 place-items-center rounded-lg border font-mono text-[9px] tracking-[0.04em] transition-colors sm:text-[10px] ${
                      active === index ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-faint hover:text-text"
                    }`}
                  >
                    <span className="truncate px-0.5">{item.tag}</span>
                  </button>
                  {index < STEPS.length - 1 ? <span className="l-flow mx-0.5 w-1.5 shrink-0 sm:w-3" data-on={active === index ? "true" : "false"} /> : null}
                </Fragment>
              ))}
            </div>

            <div className="mt-7 rounded-xl border border-line bg-void p-4 font-mono text-[12px] leading-[2] sm:text-[13px]">
              <p className="text-faint">harness · room/launch-week</p>
              <div key={active}>
                {step.trace.map((line, index) => (
                  <p key={line} className="l-enter whitespace-pre-wrap" style={{ animationDelay: `${index * 0.14}s` }}>
                    <span className="text-accent">› </span>
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </div>

          <ol>
            {STEPS.map((item, index) => {
              const open = active === index
              return (
                <li key={item.tag} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      setActive(index)
                      setAuto(false)
                    }}
                    aria-expanded={open}
                    className="flex w-full items-baseline gap-3 px-5 py-3.5 text-left"
                  >
                    <span className={`font-mono text-[11px] ${open ? "text-accent" : "text-faint"}`}>0{index + 1}</span>
                    <span className={`text-[14px] ${open ? "text-text" : "text-muted"}`}>{item.title}</span>
                  </button>
                  <div className="l-acc" data-open={open}>
                    <div>
                      <p className="l-body px-5 pb-4 pl-[46px]">{item.body}</p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}
