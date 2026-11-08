"use client"

import { useRef, type CSSProperties } from "react"
import { createTimeline, onScroll, stagger, utils } from "animejs"
import { Mascot } from "@/components/ui/mascot"
import { useAnime } from "./motion"

const WINDOWS = [
  { name: "Claude Code", x: "3%", y: "11%", rotate: -6, lines: ["$ edit auth/session.ts", "✗ file changed on disk"] },
  { name: "Codex", x: "71%", y: "9%", rotate: 5, lines: ["$ edit auth/session.ts", "✗ conflict, 3 hunks"] },
  { name: "Hermes", x: "2%", y: "63%", rotate: 4, lines: ["$ deploy main", "! tests were not run"] },
  { name: "Cursor", x: "73%", y: "62%", rotate: -5, lines: ["who owns the refresh path?", "… waiting on you"] },
  { name: "ChatGPT", x: "37%", y: "76%", rotate: 2, lines: ["pasted from Claude Code", "pasted from Codex"] },
]

const CLIPS = [
  { from: 0, to: 1, label: "⌘C session.ts" },
  { from: 1, to: 3, label: "⌘V the error" },
  { from: 3, to: 2, label: "⌘C the plan" },
]

export function ChapterChaos() {
  const root = useRef<HTMLElement>(null)

  useAnime(root, ({ all }) => {
    const wrap = root.current!
    const windows = all(".ch-win")
    const stage = all(".ch-stage")[0]!
    const say = all(".ch-line")
    const centre = () => {
      const box = stage.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }
    const towardsDoor = (axis: "x" | "y") => (target: unknown) => {
      const element = target as HTMLElement
      const stageBox = stage.getBoundingClientRect()
      const middle = centre()
      const left = stageBox.left + element.offsetLeft + element.offsetWidth / 2
      const top = stageBox.top + element.offsetTop + element.offsetHeight / 2
      return axis === "x" ? middle.x - left : middle.y - top
    }
    const clips = all(".ch-clip")
    const point = (index: number) => {
      const element = windows[index]!
      return { x: element.offsetLeft + element.offsetWidth / 2, y: element.offsetTop + element.offsetHeight / 2 }
    }

    utils.set(all(".ch-door"), { scale: 0 })
    utils.set(windows, { opacity: 0, scale: 0.55 })

    const timeline = createTimeline({
      defaults: { ease: "linear" },
      autoplay: onScroll({ target: wrap, enter: "top top", leave: "bottom bottom", sync: true }),
    })

    timeline
      .add(windows, { scale: [0.55, 1], opacity: [0, 1], duration: 170, delay: stagger(26) }, 0)
      .add(windows, { translateY: [{ to: -12 }, { to: 10 }, { to: -6 }, { to: 8 }], rotate: { to: (target: unknown) => (windows.indexOf(target as HTMLElement) % 2 ? -7 : 7) }, duration: 340 }, 240)
      .add(say[0]!, { opacity: [{ to: 1, duration: 60 }, { to: 1, duration: 200 }, { to: 0, duration: 50 }] }, 40)

    CLIPS.forEach((clip, index) => {
      const from = point(clip.from)
      const to = point(clip.to)
      timeline.add(
        clips[index]!,
        { left: [from.x, to.x], top: [from.y, to.y], duration: 140, opacity: [{ to: 1, duration: 22 }, { to: 1, duration: 94 }, { to: 0, duration: 24 }] },
        330 + index * 110,
      )
    })

    timeline
      .add(say[1]!, { opacity: [{ to: 1, duration: 50 }, { to: 1, duration: 180 }, { to: 0, duration: 40 }] }, 340)
      .add(all(".ch-door"), { scale: [0, 1], duration: 130, ease: "out(3)" }, 620)
      .add(say[2]!, { opacity: [{ to: 1, duration: 60 }, { to: 1, duration: 80 }, { to: 0, duration: 30 }] }, 680)
      .add(windows, { translateX: towardsDoor("x"), translateY: towardsDoor("y"), scale: 0.06, rotate: 40, opacity: { to: 0, delay: 100 }, duration: 170, delay: stagger(12), ease: "in(2)" }, 650)
      .add(all(".ch-door"), { scale: 15, duration: 170, ease: "in(3)" }, 830)
      .add(all(".ch-flood"), { opacity: [0, 1], duration: 40 }, 960)
  })

  return (
    <section ref={root} className="ch-wrap" aria-label="Today, your agents don't know about each other">
      <div className="ch-stage l-grain bg-void">
        <div className="l-dots absolute inset-0" aria-hidden />

        {WINDOWS.map((item) => (
          <div key={item.name} className="ch-win" aria-hidden style={{ "--x": item.x, "--y": item.y, rotate: `${item.rotate}deg` } as CSSProperties}>
            <div className="flex h-8 items-center gap-2 border-b border-white/10 px-2.5">
              <Mascot seed={item.name} mood="alert" className="h-5 w-5" />
              <span className="truncate text-text/90">{item.name}</span>
              <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
            </div>
            <div className="px-3 py-2.5">
              {item.lines.map((line) => (
                <p key={line} className={`truncate ${/^[✗!]/.test(line) ? "text-danger" : "text-muted"}`}>{line}</p>
              ))}
            </div>
          </div>
        ))}

        {CLIPS.map((clip) => (
          <span key={clip.label} aria-hidden className="ch-clip l-chip absolute -translate-x-1/2 -translate-y-1/2 opacity-0 !text-[#1a1016] ![background:#ffd08a]">
            {clip.label}
          </span>
        ))}

        <div className="ch-door motion-reduce:hidden" aria-hidden />

        <div className="ch-say">
          <p className="ch-line l-h2 max-w-[13ch] motion-safe:opacity-0">Five agents. None of them have met.</p>
        </div>
        <div className="ch-say motion-reduce:hidden" aria-hidden>
          <p className="ch-line l-h2 max-w-[13ch] opacity-0">So you became the copy-paste.</p>
        </div>
        <div className="ch-say motion-reduce:hidden" aria-hidden>
          <p className="ch-line l-h2 max-w-[13ch] -translate-y-[25svh] opacity-0">What if they shared a room?</p>
        </div>

        <div className="ch-flood pointer-events-none absolute inset-0 bg-accent opacity-0" aria-hidden />
      </div>
    </section>
  )
}
