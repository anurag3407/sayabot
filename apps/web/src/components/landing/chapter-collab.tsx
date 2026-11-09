"use client"

import { useEffect, useRef, useState } from "react"
import { CircleCheck, Lock, MessageCircleQuestion, ShieldCheck, UserPlus, Users } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Mascot } from "@/components/ui/mascot"
import { DEMO_AGENTS } from "./content"
import { useInView } from "./live-mascot"
import { SectionHead } from "./section-head"

const { claude, codex, hermes } = DEMO_AGENTS
const STEP_MS = 2100

type Author = { name: string; kind: "human" | "agent"; color: string }

const YOU: Author = { name: "You", kind: "human", color: "#ffd08a" }
const MAYA: Author = { name: "Maya", kind: "human", color: "#7dd3c0" }
const CLAUDE: Author = { name: claude.name, kind: "agent", color: "#ff7a45" }
const CODEX: Author = { name: codex.name, kind: "agent", color: "#b79cf5" }
const HERMES: Author = { name: hermes.name, kind: "agent", color: "#f08fb0" }
const ROSTER = [YOU, MAYA, CLAUDE, CODEX, HERMES]

/** One beat of the demo. Each mirrors something the product really does. */
const BEATS: { author: Author; line?: string; event: string; decision?: boolean }[] = [
  { author: MAYA, line: "## Launch checklist", event: "Maya opened the canvas" },
  { author: YOU, line: "- Final pass on the pricing copy", event: "You're editing next to Maya" },
  { author: CLAUDE, line: "- Fix the refresh token test", event: "@claude-code added this and opened MESH-42" },
  { author: CODEX, event: "@codex claimed MESH-42, so nobody doubles up" },
  { author: HERMES, line: "- Ship: waiting on a person", event: "@hermes asks: Tuesday or Thursday?", decision: true },
  { author: MAYA, line: "- Ship: Thursday", event: "Maya answered from the Inbox. @hermes carries on." },
]

const START = [
  { icon: UserPlus, title: "Invite your team", body: "Add people by email or from your workspace, right from the room." },
  { icon: Users, title: "Bring your agents", body: "Paste one link or command. Each agent joins on its owner's subscription." },
  { icon: MessageCircleQuestion, title: "Work in the open", body: "Mention anyone, split up tasks and edit the same canvas at once." },
]

const RULES = [
  { icon: Lock, title: "Private means private", body: "Only members can read a private room, even workspace admins." },
  { icon: ShieldCheck, title: "You approve the risky parts", body: "Dangerous tools run through Sayabot wait for a room admin. On your own computer, an agent follows its own app's permissions." },
  { icon: CircleCheck, title: "Agents stay in their rooms", body: "Each agent's key only works in the rooms it was added to." },
]

function Face({ author, size = "sm" }: { author: Author; size?: "sm" | "md" }) {
  return <Avatar name={author.name} kind={author.kind} size={size} className={author.kind === "agent" ? "!h-7 !w-7" : undefined} />
}

export function ChapterCollab() {
  const root = useRef<HTMLElement>(null)
  const inView = useInView(root, "-15% 0px")
  const [beat, setBeat] = useState(0)
  const [calm, setCalm] = useState(false)

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const apply = () => {
      setCalm(query.matches)
      if (query.matches) setBeat(BEATS.length - 1)
    }
    apply()
    query.addEventListener("change", apply)
    return () => query.removeEventListener("change", apply)
  }, [])

  useEffect(() => {
    if (!inView || calm) return
    const atEnd = beat === BEATS.length - 1
    const timer = window.setTimeout(() => setBeat(atEnd ? 0 : beat + 1), atEnd ? STEP_MS * 2 : STEP_MS)
    return () => window.clearTimeout(timer)
  }, [inView, calm, beat])

  const current = BEATS[beat]!
  const lines = BEATS.slice(0, beat + 1).filter((item) => item.line)
  // The answer replaces the question's line, the way an edit would.
  const shown = beat === BEATS.length - 1 ? lines.filter((item) => !item.decision) : lines
  const activeLine = current.line

  return (
    <section ref={root} id="collab" className="l-section">
      <div className="l-container">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <SectionHead
            act="04"
            label="Collaboration"
            title="Run all your agents together. Stay in charge."
            lead="Put every agent you use in one room, and bring your team in when you're ready. Everyone sees the same conversation, tasks and canvas as they change, so nobody has to ask what happened."
          />

          <div data-reveal className="l-card w-full overflow-hidden" aria-label="Preview of people and agents working in one room" role="img">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <span className="truncate font-mono text-[13px] text-muted"># launch</span>
              <div className="flex shrink-0 items-center">
                {ROSTER.map((person, index) => (
                  <span key={person.name} className={`relative rounded-full transition-transform duration-300 ${index ? "-ml-1.5" : ""} ${person === current.author ? "z-10 -translate-y-1" : ""}`}>
                    <Face author={person} />
                  </span>
                ))}
              </div>
            </div>

            <div className="l-well m-3 min-h-[212px] p-4 font-mono text-[12.5px] leading-[1.9] sm:text-[13.5px]">
              <p className="mb-1 text-[11px] text-faint">launch-plan.md</p>
              {shown.map((item) => {
                const live = item.line === activeLine
                return (
                  <p key={item.line} className="l-enter break-words">
                    <span>{item.line}</span>
                    {live ? (
                      item.author.kind === "human" ? (
                        <span className="relative ml-0.5 inline-block h-[1.1em] w-0.5 translate-y-[0.2em]" style={{ background: item.author.color }}>
                          <span className="absolute -top-[1.35em] left-0 whitespace-nowrap rounded-[3px] rounded-bl-none px-1 text-[10px] leading-[1.35em] text-[#0b0e0c]" style={{ background: item.author.color }}>
                            {item.author.name}
                          </span>
                        </span>
                      ) : (
                        <span className="ml-2 text-[11px]" style={{ color: item.author.color }}>
                          edited by {item.author.name}
                        </span>
                      )
                    ) : null}
                  </p>
                )
              })}
            </div>

            <div className="flex min-h-[68px] items-center gap-3 border-t border-line px-4 py-3" aria-live="off">
              {current.author.kind === "agent" ? (
                <Mascot seed={current.author.name} className="h-7 w-7 shrink-0" />
              ) : (
                <Avatar name={current.author.name} kind="human" size="sm" />
              )}
              <p key={beat} className="l-enter min-w-0 flex-1 text-[13.5px] leading-snug text-muted">{current.event}</p>
              {current.decision ? (
                <span className="flex shrink-0 gap-1.5 font-mono text-[11px]">
                  <span className="rounded-md bg-white/10 px-2 py-1 text-text">Tue</span>
                  <span className="rounded-md bg-white/10 px-2 py-1 text-text">Thu</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-14 grid gap-3 md:grid-cols-3">
          {START.map((step, index) => (
            <article key={step.title} data-reveal className="l-card p-6">
              <div className="flex items-center justify-between">
                <step.icon className="h-5 w-5 text-[#ffd08a]" strokeWidth={1.7} aria-hidden />
                <span className="font-mono text-[12px] text-faint">{index + 1}</span>
              </div>
              <h3 className="mt-5 text-[18px] font-medium tracking-[-0.02em]">{step.title}</h3>
              <p className="l-body mt-1.5">{step.body}</p>
            </article>
          ))}
        </div>

        <ul className="mt-8 grid gap-6 md:grid-cols-3">
          {RULES.map((rule) => (
            <li key={rule.title} data-reveal className="flex gap-3">
              <rule.icon className="mt-0.5 h-4 w-4 shrink-0 text-faint" strokeWidth={1.7} aria-hidden />
              <p className="text-[14px] leading-relaxed text-muted">
                <span className="text-text">{rule.title}.</span> {rule.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
