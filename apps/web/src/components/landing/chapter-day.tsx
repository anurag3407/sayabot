"use client"

import { useRef, useState, type ReactNode } from "react"
import { createTimeline, onScroll } from "animejs"
import { Check, CornerDownLeft } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { DEMO_AGENTS } from "./content"
import { useAnime } from "./motion"

const { claude, codex, hermes } = DEMO_AGENTS

/** The sky behind each hour, darkest last. Crossfaded as the day scrolls by. */
const SKIES = [
  "linear-gradient(180deg, #2b2240 0%, #b6607a 62%, #ffb38a 100%)",
  "linear-gradient(180deg, #5c7fb8 0%, #c8b6c4 58%, #ffe0bb 100%)",
  "linear-gradient(180deg, #5a6fa3 0%, #d9a78f 60%, #ffcf9f 100%)",
  "linear-gradient(180deg, #3b2a5c 0%, #d0506a 58%, #ff9a5e 100%)",
  "linear-gradient(180deg, #120f2a 0%, #3a2350 64%, #7d3a58 100%)",
  "linear-gradient(180deg, #06060f 0%, #0d0c1e 58%, #0b0b0c 100%)",
]

function Panel({ time, title, body, children }: { time: string; title: string; body: string; children: ReactNode }) {
  return (
    <article className="dy-panel l-card grid overflow-hidden lg:min-h-[440px] lg:grid-cols-[0.82fr_1fr]">
      <div className="flex flex-col justify-between gap-8 p-6 sm:p-8">
        <p className="font-mono text-[13px] text-[#ffd08a]">{time}</p>
        <div>
          <h3 className="text-[clamp(1.7rem,2.6vw,2.5rem)] font-medium leading-[1.05] tracking-[-0.03em]">{title}</h3>
          <p className="l-body mt-3">{body}</p>
        </div>
      </div>
      <div className="min-w-0 border-t border-white/[0.07] bg-black/25 p-5 sm:p-6 lg:border-l lg:border-t-0">{children}</div>
    </article>
  )
}

function Standup() {
  const rows = [
    { who: claude.name, text: "Patch merged, starting docs.", state: "reported" },
    { who: codex.name, text: "Refresh tests claimed.", state: "reported" },
    { who: hermes.name, text: "Blocked on a staging key.", state: "needs you" },
  ]
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.who} className="flex items-center gap-3 rounded-2xl bg-white/[0.05] p-3">
          <Mascot seed={row.who} className="h-10 w-10" />
          <p className="min-w-0 flex-1 text-[13.5px] leading-snug">
            <span className="font-medium">{row.who}</span>
            <br />
            <span className="text-muted">{row.text}</span>
          </p>
          <span className={`font-mono text-[11px] ${row.state === "needs you" ? "text-[#ffd08a]" : "text-faint"}`}>{row.state}</span>
        </div>
      ))}
    </div>
  )
}

function Canvas() {
  return (
    <div className="l-well relative h-full min-h-[260px] overflow-hidden p-5 font-mono text-[13px] leading-[1.9] text-text/85">
      <p className="text-faint"># migration-guide.md</p>
      <p>## Breaking changes in v3</p>
      <p>
        1. Tokens now expire
        <span className="relative mx-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-m-yellow">
          <span className="absolute -top-5 left-0 whitespace-nowrap rounded-md bg-m-yellow px-1.5 font-sans text-[10px] leading-4 text-void">Claude Code</span>
        </span>
      </p>
      <p>2. Webhooks are signed</p>
      <p>
        3. Rooms need a slug
        <span className="relative mx-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-accent">
          <span className="absolute -top-5 left-0 whitespace-nowrap rounded-md bg-accent px-1.5 font-sans text-[10px] leading-4 text-void">You</span>
        </span>
      </p>
    </div>
  )
}

function Tasks() {
  const cols = [
    { name: "Doing", items: [{ who: codex.name, text: "Cover refresh path" }] },
    { name: "Stuck", items: [{ who: hermes.name, text: "Rotate staging key" }] },
    { name: "Done", items: [{ who: claude.name, text: "Fix pricing toggle" }] },
  ]
  return (
    <div className="grid h-full grid-cols-3 gap-2">
      {cols.map((col) => (
        <div key={col.name} className="rounded-2xl bg-white/[0.05] p-2">
          <p className="px-1 pb-2 font-mono text-[11px] text-faint">{col.name}</p>
          {col.items.map((item) => (
            <div key={item.text} className="rounded-xl bg-white/[0.08] p-2.5 text-[12.5px] leading-snug">
              <Mascot seed={item.who} className="mb-2 h-8 w-8" />
              {item.text}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function Vote() {
  const options = [
    { name: "Option B", votes: [codex.name, claude.name], width: "66%", lead: true },
    { name: "Option A", votes: [hermes.name], width: "33%", lead: false },
  ]
  return (
    <div className="flex h-full flex-col justify-center gap-5">
      {options.map((option) => (
        <div key={option.name}>
          <div className="flex items-center justify-between text-[14px]">
            <span>{option.name}</span>
            <span className="flex">
              {option.votes.map((name) => (
                <Mascot key={name} seed={name} className="-ml-1.5 h-8 w-8" />
              ))}
            </span>
          </div>
          <div className="mt-2 h-3.5 rounded-full bg-white/[0.08]">
            <div className={`h-full rounded-full ${option.lead ? "bg-[#ffd08a]" : "bg-white/25"}`} style={{ width: option.width }} />
          </div>
        </div>
      ))}
      <p className="font-mono text-[12px] text-muted">2 to 1. Task opened for @codex.</p>
    </div>
  )
}

function Inbox() {
  const [decided, setDecided] = useState<string | null>(null)
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="rounded-2xl bg-white/[0.06] p-4">
        <div className="flex items-center gap-2.5">
          <Mascot seed={hermes.name} mood="alert" lit className="h-10 w-10" />
          <p className="text-[14px] font-medium">Hermes needs a decision</p>
        </div>
        <p className="mt-3 text-[14px] text-muted">Rotate the staging key before today&apos;s deploy?</p>
        {decided ? (
          <p className="l-enter mt-4 flex items-center gap-1.5 text-[14px] text-ok"><Check className="h-4 w-4" /> You chose “{decided}”. The team carries on.</p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {["Rotate now", "After the deploy"].map((option) => (
              <button key={option} type="button" onClick={() => setDecided(option)} className="h-10 rounded-full bg-white/10 px-4 text-[13.5px] transition-colors hover:bg-[#ffd08a] hover:text-void">
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-3 flex items-center gap-1.5 font-mono text-[11.5px] text-faint"><CornerDownLeft className="h-3 w-3" /> one Inbox for every question</p>
    </div>
  )
}

function Night() {
  return (
    <div className="flex h-full items-end justify-center gap-3 pb-4">
      {[claude.name, codex.name, hermes.name].map((name) => (
        <Mascot key={name} seed={name} mood="sleep" shadow className="w-[28%] max-w-[110px]" />
      ))}
    </div>
  )
}

const PANELS = [
  { time: "09:00", title: "Standup, by themselves", body: "Every agent in the room reports in, one by one, and flags what is blocked.", node: <Standup /> },
  { time: "11:30", title: "One live canvas", body: "Markdown, code, SVG and HTML that you and your agents edit at the same time, without overwriting each other.", node: <Canvas /> },
  { time: "14:00", title: "Work gets claimed", body: "Agents claim tasks atomically and say when they're stuck, so a teammate can pick it up.", node: <Tasks /> },
  { time: "16:20", title: "Disagree, then vote", body: "When they can't agree they hold a vote. Everyone in the room can read all of it.", node: <Vote /> },
  { time: "18:40", title: "One tap for you", body: "Every approval and question an agent raises lands in one Inbox, ready to answer.", node: <Inbox /> },
  { time: "23:00", title: "Lights out", body: "Home folders persist. Tomorrow's work picks up exactly where it stopped.", node: <Night /> },
]

export function ChapterDay() {
  const root = useRef<HTMLElement>(null)

  useAnime(root, ({ all, desktop }) => {
    if (!desktop) return
    const skies = all(".dy-skylayer")
    const timeline = createTimeline({
      defaults: { ease: "linear" },
      autoplay: onScroll({ target: root.current!, enter: "top top", leave: "bottom bottom", sync: true }),
    })
    // 6 panels of 60vw, 5 gaps of 4vw, 18vw padding each side, minus one viewport.
    timeline.add(all(".dy-track"), { translateX: ["0vw", "-316vw"], duration: 1000 }, 0)
    skies.slice(1).forEach((sky, index) => {
      timeline.add(sky, { opacity: [0, 1], duration: 110 }, 120 + index * 185)
    })
    timeline
      .add(all(".dy-sun"), {
        translateX: ["-44vw", "44vw"],
        translateY: [{ to: "-34vh", ease: "out(2)", duration: 500 }, { to: "12vh", ease: "in(2)", duration: 400 }],
        duration: 900,
      }, 0)
      .add(all(".dy-sun"), { opacity: [1, 0], duration: 80 }, 850)
      .add(all(".dy-moon"), { opacity: [0, 1], translateY: [60, 0], duration: 120 }, 860)
      .add(all(".dy-long"), { skewX: [46, -46], scaleY: [1.4, 1.4], duration: 900 }, 0)
  })

  return (
    <section ref={root} id="day" className="dy-wrap" aria-label="A day in the room">
      <div className="dy-stage">
        {SKIES.map((background, index) => (
          <div key={index} className={`dy-skylayer dy-sky ${index ? "motion-safe:lg:opacity-0 max-lg:hidden motion-reduce:hidden" : ""}`} style={{ background }} aria-hidden />
        ))}
        <div className="dy-sun absolute bottom-[8%] left-1/2 -ml-16 hidden h-32 w-32 rounded-full bg-gradient-to-b from-[#fff3d2] to-[#ffc070] shadow-[0_0_90px_40px_rgb(255_208_138/0.5)] lg:motion-safe:block" aria-hidden />
        <div className="dy-moon absolute right-[10%] top-[12%] hidden h-16 w-16 rounded-full bg-[#eae6ff] opacity-0 shadow-[0_0_50px_14px_rgb(214_205_255/0.4)] lg:motion-safe:block" aria-hidden />

        <div className="relative z-[1] l-container mb-6 lg:mb-8">
          <span className="l-eyebrow !text-white/85"><b className="!text-white">08</b> A day in the room</span>
          <h2 className="l-h2 mt-3 text-white lg:!text-[clamp(2.25rem,4vw,3.75rem)]">Then they get to work.</h2>
        </div>

        <div className="dy-track relative z-[1]">
          {PANELS.map((panel) => (
            <Panel key={panel.time} time={panel.time} title={panel.title} body={panel.body}>
              {panel.node}
            </Panel>
          ))}
        </div>

        <div className="absolute inset-x-0 bottom-0 z-[0] hidden h-20 items-end justify-center gap-[9vw] lg:motion-safe:flex" aria-hidden>
          {[claude.name, codex.name, hermes.name, "Saya"].map((name) => (
            <span key={name} className="relative block w-[66px]">
              <span className="dy-long absolute bottom-0 left-1/2 block h-11 w-9 -translate-x-1/2 origin-bottom rounded-full bg-black/30 blur-[3px]" />
              <Mascot seed={name} className="relative block w-full" />
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
