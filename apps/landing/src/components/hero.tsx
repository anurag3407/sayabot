"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import type { SayaMood, SayaShape } from "@sayabot/core/mascot"
import { LINKS } from "@/lib/links"
import { useInView } from "@/lib/motion"
import { DownloadButton } from "./download-button"
import { ArrowRight } from "./icons"
import { Saya } from "./saya"

const WHILE = ["asleep", "offline", "in meetings", "on a flight", "with family"]

type Beat = { mood: SayaMood; text: string }
type Member = {
  shape: SayaShape
  name: string
  beats: Beat[]
  size: "sm" | "md" | "lg"
  hideSm?: boolean
}

/** The cast on the hero floor. Each cycles through what a remote agent's day actually looks like. */
const LINEUP: Member[] = [
  {
    shape: "sprout",
    name: "Sprout",
    size: "sm",
    hideSm: true,
    beats: [
      { mood: "sleeping", text: "Next run Mon 6:00" },
      { mood: "working", text: "Auditing 40 pages" },
      { mood: "done", text: "SEO report sent" },
    ],
  },
  {
    shape: "bubble",
    name: "Bubble",
    size: "md",
    beats: [
      { mood: "working", text: "Sorting 214 emails" },
      { mood: "done", text: "Inbox at zero" },
      { mood: "idle", text: "5 drafts held for you" },
    ],
  },
  {
    shape: "ledger",
    name: "Ledger",
    size: "md",
    beats: [
      { mood: "thinking", text: "Matching receipts" },
      { mood: "waiting", text: "Send 3 reminders?" },
      { mood: "done", text: "Sent · receipts filed" },
    ],
  },
  {
    shape: "ghost",
    name: "Saya",
    size: "lg",
    beats: [
      { mood: "idle", text: "Ask me anything" },
      { mood: "thinking", text: "Planning your week" },
      { mood: "done", text: "Brief is in your inbox" },
    ],
  },
  {
    shape: "block",
    name: "Block",
    size: "md",
    beats: [
      { mood: "working", text: "Running 48 tests" },
      { mood: "waiting", text: "Open PR #212?" },
      { mood: "done", text: "PR opened" },
    ],
  },
  {
    shape: "hoot",
    name: "Hoot",
    size: "md",
    beats: [
      { mood: "thinking", text: "Reading 12 sources" },
      { mood: "working", text: "Writing the brief" },
      { mood: "done", text: "Brief ready" },
    ],
  },
  {
    shape: "bloom",
    name: "Bloom",
    size: "sm",
    hideSm: true,
    beats: [
      { mood: "working", text: "Drafting posts" },
      { mood: "waiting", text: "Post 4 drafts?" },
      { mood: "done", text: "Queued for the week" },
    ],
  },
]

const TONE: Record<SayaMood, string> = {
  idle: "var(--muted)",
  thinking: "var(--accent-2)",
  working: "var(--accent-2)",
  waiting: "var(--amber)",
  done: "var(--green)",
  sleeping: "var(--faint)",
}

function useCycle(length: number, every: number, offset: number, active: boolean) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!active || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let interval = 0
    const start = window.setTimeout(() => {
      setIndex((value) => (value + 1) % length)
      interval = window.setInterval(() => setIndex((value) => (value + 1) % length), every)
    }, offset)
    return () => {
      window.clearTimeout(start)
      window.clearInterval(interval)
    }
  }, [length, every, offset, active])
  return index
}

function Agent({ member, index, active }: { member: Member; index: number; active: boolean }) {
  const beat = useCycle(member.beats.length, 4200, 1800 + index * 650, active)
  const now = member.beats[beat] ?? member.beats[0]
  if (!now) return null
  return (
    <div
      className={`lineup-agent lineup-${member.size} ${member.hideSm ? "hide-sm" : ""}`}
      style={
        { "--i": index, "--bob": `${index * 0.45}s`, "--blink": `${index * 0.9}s` } as CSSProperties
      }
    >
      <div
        className="lineup-status"
        key={now.text}
        style={{ "--dot": TONE[now.mood] } as CSSProperties}
      >
        <span className="lineup-dot" />
        <span className="lineup-text">{now.text}</span>
      </div>
      <Saya
        shape={member.shape}
        mood={now.mood}
        follow
        live
        pool
        lit={member.size === "lg"}
        label={`${member.name}: ${now.text}`}
      />
      <div className="lineup-name">{member.name}</div>
    </div>
  )
}

export function Hero() {
  const stage = useRef<HTMLDivElement>(null)
  const visible = useInView(stage)
  const word = useCycle(WHILE.length, 2600, 2600, true)
  const headline = ["Agents", "that", "keep", "working", "while", "you're"]

  return (
    <section className="hero" id="top">
      <div className="hero-grid" aria-hidden />
      <div className="wrap hero-inner">
        <a className="hero-chip" href={LINKS.github} target="_blank" rel="noreferrer">
          <span className="hero-chip-dot" />
          Open source remote agents
          <span className="hero-chip-sep" />
          <span className="hero-chip-cta">Star on GitHub</span>
        </a>

        <h1 className="hero-title">
          <span className="sr-only">Agents that keep working while you&apos;re away.</span>
          <span aria-hidden className="hero-words">
            {headline.map((part, index) => (
              <span key={part} className="hero-word" style={{ "--i": index } as CSSProperties}>
                {part}
              </span>
            ))}
            <span className="hero-swap" style={{ "--i": headline.length } as CSSProperties}>
              <span key={WHILE[word]} className="hero-swap-word">
                {WHILE[word]}
              </span>
            </span>
          </span>
        </h1>

        <p className="hero-sub">
          Give each agent a job, a computer of its own and your tools. Reach them from your Mac,
          your phone or the web. Anything risky waits for your yes.
        </p>

        <div className="hero-ctas">
          <DownloadButton />
          <a className="btn btn-ghost" href={LINKS.selfHost}>
            Self-host <ArrowRight className="arrow" />
          </a>
        </div>
        <p className="hero-fine">
          Free and open source · Bring your own model: Claude, GPT, Gemini, DeepSeek or Ollama
        </p>
      </div>

      <div className="lineup" ref={stage} id="mascots">
        <div className="lineup-word" aria-hidden>
          sayabot
        </div>
        <div className="lineup-row">
          {LINEUP.map((member, index) => (
            <Agent key={member.name} member={member} index={index} active={visible} />
          ))}
        </div>
        <div className="lineup-floor" aria-hidden />
      </div>
    </section>
  )
}
