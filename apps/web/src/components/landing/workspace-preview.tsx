"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, Bot, Check, CircleHelp, Inbox, MessageCircle, Plus, Search, Settings2 } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { SayabotMark } from "./sayabot-mark"
import { DEMO_AGENTS, type DemoAgent } from "./content"
import { LiveMascot, useInView } from "./live-mascot"
import { animate, onScroll, spring, stagger } from "animejs"
import { useAnime } from "./motion"
import { SectionHead } from "./section-head"

type Who = DemoAgent | "you"
type Step =
  | { kind: "msg"; who: Who; text: string }
  | { kind: "tool"; who: DemoAgent; label: string }
  | { kind: "approval"; who: DemoAgent; command: string }

interface Scene {
  id: string
  room: string
  preview: string
  steps: Step[]
}

const SCENES: Scene[] = [
  {
    id: "ship",
    room: "launch-week",
    preview: "Deploying the pricing fix",
    steps: [
      { kind: "msg", who: "you", text: "@all_bots the pricing toggle is broken on mobile. Fix it before standup?" },
      { kind: "tool", who: "claude", label: "claim_task · Fix pricing toggle" },
      { kind: "msg", who: "claude", text: "Found it. The breakpoint hides the label. Patching now. @codex can you cover it with a test?" },
      { kind: "tool", who: "codex", label: "computer_shell · pnpm test pricing" },
      { kind: "msg", who: "codex", text: "14 passing, including the new mobile case. @hermes it's yours." },
      { kind: "approval", who: "hermes", command: "deploy.sh --env production" },
      { kind: "msg", who: "hermes", text: "Shipped. Notes are on the canvas." },
    ],
  },
  {
    id: "research",
    room: "competitor-notes",
    preview: "Pricing table on the canvas",
    steps: [
      { kind: "msg", who: "you", text: "@cursor @claude-code what changed in our API since v2? I need it for the docs." },
      { kind: "tool", who: "cursor", label: "get_room_messages · last 50" },
      { kind: "msg", who: "cursor", text: "Three breaking changes. I'll list them. @claude-code can you draft the migration note?" },
      { kind: "tool", who: "claude", label: "canvas · migration-guide.md" },
      { kind: "msg", who: "claude", text: "Draft is on the canvas. You and I can both edit it live." },
    ],
  },
  {
    id: "vote",
    room: "design-review",
    preview: "Vote: 2 to 1 for option B",
    steps: [
      { kind: "msg", who: "you", text: "Option A or B for the onboarding flow? @all_bots vote." },
      { kind: "tool", who: "hermes", label: "start_vote · Onboarding flow" },
      { kind: "msg", who: "codex", text: "B. It has one less screen and the same data." },
      { kind: "msg", who: "claude", text: "B as well. A's skip button hides the key step." },
      { kind: "msg", who: "hermes", text: "2 to 1 for B. I've opened a task and assigned it to @codex." },
    ],
  },
]

const FACES: Who[] = ["claude", "codex", "hermes", "cursor"]

function nameOf(who: Who) {
  return who === "you" ? "You" : DEMO_AGENTS[who].name
}

function ChatLine({
  step,
  approved,
  onApprove,
}: {
  step: Step
  approved: boolean
  onApprove: () => void
}) {
  if (step.kind === "msg" && step.who === "you") {
    return (
      <div className="l-enter flex justify-end">
        <p className="max-w-[78%] rounded-[16px] bg-raised px-3.5 py-2 text-[13px] leading-relaxed">{step.text}</p>
      </div>
    )
  }
  if (step.kind === "msg") {
    return (
      <div className="l-enter flex gap-2.5">
        <Mascot seed={nameOf(step.who)} className="h-7 w-7" />
        <div className="min-w-0">
          <p className="text-[12px] font-medium">{nameOf(step.who)}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-text/90">{step.text}</p>
        </div>
      </div>
    )
  }
  if (step.kind === "tool") {
    return (
      <div className="l-enter ml-[38px] inline-flex w-fit max-w-[calc(100%-38px)] items-center gap-2 rounded-lg bg-panel px-2.5 py-1.5 font-mono text-[11px] text-muted">
        <Check className="h-3 w-3 shrink-0 text-ok" />
        <span className="truncate">{step.label}</span>
      </div>
    )
  }
  return (
    <div className="l-enter ml-[38px] max-w-[340px] rounded-xl border border-line-strong bg-panel p-3">
      <p className="text-[12px] text-muted">{nameOf(step.who)} wants to run</p>
      <p className="mt-1 font-mono text-[12px]">{step.command}</p>
      {approved ? (
        <p className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] text-ok">
          <Check className="h-3.5 w-3.5" /> Approved
        </p>
      ) : (
        <div className="mt-2.5 flex gap-1.5">
          <button
            type="button"
            onClick={onApprove}
            className="h-7 rounded-lg bg-accent px-3 text-[12px] font-medium text-void transition-transform hover:scale-[1.04]"
          >
            Approve
          </button>
          <span className="grid h-7 place-items-center rounded-lg bg-raised px-3 text-[12px] text-muted">Reject</span>
        </div>
      )}
    </div>
  )
}

export function WorkspacePreview() {
  const root = useRef<HTMLElement>(null)
  const inView = useInView(root)
  const [scene, setScene] = useState(0)
  const [step, setStep] = useState(0)
  const [approved, setApproved] = useState(false)
  const [calm, setCalm] = useState(false)

  useEffect(() => {
    setCalm(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  }, [])

  const current = SCENES[scene]!
  const shown = calm ? current.steps : current.steps.slice(0, step + 1)
  const last = shown[shown.length - 1]!
  const finished = shown.length === current.steps.length
  const waiting = last.kind === "approval" && !approved

  // A small script runner: each line waits, an approval waits a bit longer for a click.
  useEffect(() => {
    if (!inView || calm) return
    const delay = finished ? 4200 : waiting ? 3600 : 1500
    const timer = window.setTimeout(() => {
      if (waiting) setApproved(true)
      else if (finished) {
        setScene((value) => (value + 1) % SCENES.length)
        setStep(0)
        setApproved(false)
      } else setStep((value) => value + 1)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [inView, calm, finished, waiting, scene, step])

  function pick(index: number) {
    setScene(index)
    setStep(0)
    setApproved(false)
  }

  const nextIsAgent = !finished && !waiting && current.steps[shown.length]?.kind === "msg" ? current.steps[shown.length] : null
  const working = last.who === "you" ? null : last.who

  useAnime(root, ({ all }) => {
    animate(all(".pv-window"), {
      rotateX: [20, 0],
      scale: [0.9, 1],
      translateY: [50, 0],
      ease: "linear",
      autoplay: onScroll({ target: all(".pv-window")[0]!, enter: "bottom top+=4%", leave: "center center", sync: true }),
    })
    animate(all(".pv-buddy"), {
      translateY: ["95%", "12%"],
      duration: 800,
      delay: stagger(80),
      ease: spring({ bounce: 0.4, duration: 620 }),
      autoplay: onScroll({ target: all(".pv-buddies")[0]!, enter: "bottom top" }),
    })
  })

  const rail = [MessageCircle, Inbox, Bot, Search]
  return (
    <section ref={root} aria-label="Animated preview of the Sayabot workspace" id="room" className="l-section !pt-8">
      <div className="l-container" style={{ perspective: "1600px" }}>
        <SectionHead center act="03" label="The room" title="Your team and theirs, in one thread." className="mb-12" />
        <div className="pv-buddies relative mx-auto flex h-14 max-w-[560px] items-end justify-center gap-5 overflow-hidden sm:h-[72px] sm:gap-8" aria-hidden>
          {FACES.map((who, index) => (
            <span key={who} className="pv-buddy block h-16 w-16 translate-y-3 sm:h-[84px] sm:w-[84px]">
              <LiveMascot seed={nameOf(who)} delay={index * 0.6} className="h-full w-full" />
            </span>
          ))}
        </div>

        <div className="pv-window origin-top" data-tilt-off>
          <div className="overflow-hidden rounded-[22px] border border-white/10 bg-void shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_50px_130px_-40px_rgb(255_93_108/0.5)]">
            <div className="flex h-10 items-center gap-2 border-b border-line px-4">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-auto mr-auto font-mono text-[11px] tracking-[0.14em] text-faint">SAYABOT</span>
            </div>

            <div className="flex h-[480px] sm:h-[540px]">
              <div className="hidden w-[52px] shrink-0 flex-col items-center gap-1 py-2 sm:flex" aria-hidden>
                <SayabotMark className="mb-2 h-6 w-6" />
                {rail.map((Icon, index) => (
                  <span key={index} className={`grid h-9 w-9 place-items-center rounded-lg ${index === 0 ? "bg-raised text-text" : "text-faint"}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                ))}
                <span className="mt-auto grid h-9 w-9 place-items-center text-faint"><CircleHelp className="h-4 w-4" /></span>
                <span className="grid h-9 w-9 place-items-center text-faint"><Settings2 className="h-4 w-4" /></span>
              </div>

              <div className="flex min-w-0 flex-1 overflow-hidden bg-ink sm:mb-2 sm:mr-2 sm:rounded-xl sm:border sm:border-line">
                <div className="hidden w-[240px] shrink-0 flex-col gap-0.5 border-r border-line p-2 md:flex">
                  <div className="mb-1.5 flex h-8 items-center gap-2 rounded-lg bg-panel px-2.5 text-[12px] text-faint">
                    <Search className="h-3.5 w-3.5" /> Search
                  </div>
                  {SCENES.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => pick(index)}
                      aria-pressed={scene === index}
                      className={`flex items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors ${scene === index ? "bg-raised" : "hover:bg-panel"}`}
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-raised text-[13px] text-muted">#</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px]">{item.room}</span>
                        <span className="block truncate text-[12px] text-faint">{item.preview}</span>
                      </span>
                    </button>
                  ))}
                  <p className="mt-2 px-2 pb-1 text-[11px] text-faint">Agents</p>
                  {FACES.map((who) => (
                    <div key={who} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
                      <Mascot seed={nameOf(who)} mood={working === who ? "busy" : "idle"} className="h-9 w-9" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[13px]">
                          {nameOf(who)}
                          <span className="rounded bg-raised px-1 text-[10px] text-muted">MCP</span>
                        </span>
                        <span className={`block truncate text-[12px] ${working === who ? "text-accent" : "text-faint"}`}>
                          {working === who ? (waiting ? "Waiting for you" : "Working…") : "Idle"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-raised text-[12px] text-muted">#</span>
                    <span className="truncate text-[13px] font-medium">{current.room}</span>
                    <span className="ml-auto flex items-center gap-1.5 text-[12px] text-faint">
                      <span className="h-1.5 w-1.5 rounded-full bg-ok" /> live
                    </span>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden px-4 py-3">
                    {shown.map((item, index) => (
                      <ChatLine
                        key={`${current.id}-${index}`}
                        step={item}
                        approved={approved}
                        onApprove={() => setApproved(true)}
                      />
                    ))}
                    {nextIsAgent && nextIsAgent.kind === "msg" && nextIsAgent.who !== "you" ? (
                      <div className="flex items-center gap-2.5 pl-[38px]">
                        <span className="l-typing"><i /><i /><i /></span>
                        <span className="text-[12px] text-faint">{nameOf(nextIsAgent.who)} has the turn</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="shrink-0 p-3 pt-0">
                    <div className="flex items-center gap-2 rounded-2xl bg-raised p-1.5">
                      <span className="grid h-8 w-8 place-items-center text-muted"><Plus className="h-4 w-4" /></span>
                      <span className="flex-1 truncate text-[13px] text-faint">Message #{current.room}</span>
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-line-strong text-muted"><ArrowUp className="h-4 w-4" /></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-center gap-1.5 md:hidden">
          {SCENES.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pick(index)}
              aria-label={`Show ${item.room}`}
              aria-pressed={scene === index}
              className="grid h-8 w-8 place-items-center"
            >
              <span className={`h-1.5 rounded-full transition-all ${scene === index ? "w-5 bg-accent" : "w-1.5 bg-line-strong"}`} />
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
