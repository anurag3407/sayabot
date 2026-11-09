"use client"

import { useRef, useState } from "react"
import { animate, onScroll } from "animejs"
import { Power } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { DEMO_AGENTS } from "./content"
import { useAnime } from "./motion"
import { SectionHead } from "./section-head"

const MACHINES = [
  { name: DEMO_AGENTS.claude.name, host: "claude-code@sandbox", lines: ["$ git clone repo", "$ pnpm build", "✓ built in 41s"] },
  { name: DEMO_AGENTS.codex.name, host: "codex@sandbox", lines: ["$ pnpm test --watch", "✓ 212 passing", "watching for changes"] },
  { name: DEMO_AGENTS.hermes.name, host: "hermes@sandbox", lines: ["$ cat notes/plan.md", "$ ls /home/bot", "notes/ repo/ logs/"] },
]

const FACTS = [
  ["Isolated", "Each machine is sandboxed with gVisor, away from the host and from other agents."],
  ["Persistent", "/home/bot survives restarts, so work picks up where it stopped."],
  ["No raw secrets", "Credentials go through a broker instead of being handed to the bot."],
  ["Yours to power", "Start or stop any agent's computer, from the web or your phone."],
]

export function Computers() {
  const root = useRef<HTMLElement>(null)
  const [off, setOff] = useState<string[]>([])

  useAnime(root, ({ all, desktop }) => {
    if (!desktop) return
    const units = all(".cp-unit")
    const start = (values: number[]) => (target: unknown) => values[units.indexOf(target as HTMLElement)] ?? 0
    animate(units, {
      translateX: { from: start([180, 0, -180]), to: 0 },
      translateY: { from: start([50, 0, 50]), to: 0 },
      rotate: { from: start([-7, 0, 7]), to: 0 },
      ease: "linear",
      autoplay: onScroll({ target: all(".cp-row")[0]!, enter: "bottom top", leave: "center center", sync: true }),
    })
  })

  return (
    <section ref={root} id="computers" className="l-section">
      <div className="l-container">
        <SectionHead
          center
          act="10"
          label="Agent computers"
          title="Every agent gets its own computer."
          lead="No shared box, no stepping on each other's files. Each bot has a machine to clone, build, test and keep notes on. Tap power to put one to sleep."
        />

        <div className="cp-row mt-16 grid gap-6 md:grid-cols-3" style={{ perspective: "1400px" }}>
          {MACHINES.map((machine) => {
            const running = !off.includes(machine.name)
            return (
              <div key={machine.name} className="cp-unit" data-tilt>
                <div className="rounded-[20px] bg-gradient-to-b from-[#34323a] to-[#17161b] p-[10px] shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_40px_70px_-30px_rgb(0_0_0/0.95)]">
                  <div className="l-well overflow-hidden">
                    <div className="flex h-10 items-center gap-2 border-b border-white/[0.07] pl-3 pr-1.5">
                      <span className={`h-2 w-2 rounded-full transition-colors ${running ? "bg-ok shadow-[0_0_8px_var(--color-ok)]" : "bg-line-strong"}`} />
                      <span className="truncate font-mono text-[11.5px] text-faint">{machine.host}</span>
                      <button
                        type="button"
                        aria-pressed={running}
                        aria-label={`${running ? "Stop" : "Start"} ${machine.name}'s computer`}
                        onClick={() => setOff((list) => (running ? [...list, machine.name] : list.filter((name) => name !== machine.name)))}
                        className={`ml-auto grid h-8 w-8 place-items-center rounded-lg transition-colors hover:bg-white/10 ${running ? "text-ok" : "text-faint"}`}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className={`h-[150px] p-4 font-mono text-[12.5px] leading-[1.9] transition-opacity duration-300 ${running ? "" : "opacity-20"}`}>
                      {machine.lines.map((line) => (
                        <p key={line} className={line.startsWith("✓") ? "text-ok" : "text-text/85"}>{line}</p>
                      ))}
                      {running ? <span className="l-pulse mt-1 inline-block h-3.5 w-2 bg-[#ffd08a]" aria-hidden /> : null}
                    </div>
                  </div>
                </div>
                <div className="mx-auto h-5 w-16 bg-gradient-to-b from-[#26242b] to-[#121115]" aria-hidden />
                <div className="mx-auto h-2.5 w-32 rounded-t-lg bg-gradient-to-b from-[#3a3840] to-[#1a191e]" aria-hidden />
                <div className="-mt-5 flex items-end justify-between gap-2 px-2">
                  <div className="translate-y-1">
                    <Mascot seed={machine.name} shadow blink lit={running} mood={running ? "busy" : "sleep"} className="h-[72px] w-[72px]" />
                  </div>
                  <div className="pb-1 text-right">
                    <p className="text-[14px] font-medium">{machine.name}</p>
                    <p className="text-[12.5px] text-faint">{running ? "Working" : "Asleep"}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <dl className="mt-16 grid gap-x-8 gap-y-6 border-t border-white/10 pt-10 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map(([term, detail]) => (
            <div key={term} data-reveal>
              <dt className="text-[16px] font-medium">{term}</dt>
              <dd className="l-body mt-1.5">{detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
