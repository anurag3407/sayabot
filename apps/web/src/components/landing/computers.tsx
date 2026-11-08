"use client"

import { useRef, useState } from "react"
import { Power } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { DEMO_AGENTS } from "./content"
import { gsap, MOTION_DESKTOP, useGSAP } from "./gsap"

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

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION_DESKTOP, () => {
        gsap.from(".cp-window", {
          xPercent: (index) => [100, 0, -100][index] ?? 0,
          rotate: (index) => [-5, 2, 6][index] ?? 0,
          y: (index) => [30, 0, 30][index] ?? 0,
          ease: "none",
          scrollTrigger: { trigger: ".cp-row", start: "top 96%", end: "top 62%", scrub: 0.6 },
        })
      })
    },
    { scope: root },
  )

  return (
    <section ref={root} id="computers" className="l-section">
      <div className="l-container">
        <div className="text-center">
          <span className="l-eyebrow" data-reveal>Agent computers</span>
          <h2 className="l-h2 mx-auto mt-4 max-w-[20ch]" data-split>Every agent gets its own computer.</h2>
          <p className="l-lead mx-auto mt-5 max-w-[54ch]" data-reveal>
            No shared box, no stepping on each other's files. Each bot has its own machine to clone, build, test and
            keep notes on. Tap the power button to put one to sleep.
          </p>
        </div>

        <div className="cp-row mt-14 grid gap-4 md:grid-cols-3">
          {MACHINES.map((machine) => {
            const running = !off.includes(machine.name)
            return (
              <div key={machine.name} className="cp-window l-card overflow-hidden transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0_30px_70px_-40px_rgb(255_93_108/0.5)]">
                <div className="flex h-10 items-center gap-2 border-b border-line pl-3 pr-1.5">
                  <span className={`h-2 w-2 rounded-full transition-colors ${running ? "bg-ok" : "bg-line-strong"}`} />
                  <span className="truncate font-mono text-[11px] text-faint">{machine.host}</span>
                  <button
                    type="button"
                    aria-pressed={running}
                    aria-label={`${running ? "Stop" : "Start"} ${machine.name}'s computer`}
                    onClick={() =>
                      setOff((list) => (running ? [...list, machine.name] : list.filter((name) => name !== machine.name)))
                    }
                    className={`ml-auto grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-raised ${running ? "text-ok" : "text-faint"}`}
                  >
                    <Power className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex h-[210px] flex-col justify-between bg-void p-4">
                  <div className={`font-mono text-[12px] leading-[1.9] transition-opacity duration-300 ${running ? "" : "opacity-25"}`}>
                    {machine.lines.map((line) => (
                      <p key={line} className={line.startsWith("✓") ? "text-ok" : "text-text/85"}>{line}</p>
                    ))}
                    {running ? <span className="l-pulse mt-1 inline-block h-3.5 w-2 bg-accent" aria-hidden /> : null}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Mascot seed={machine.name} mood={running ? "busy" : "sleep"} className="h-10 w-10" />
                    <div>
                      <p className="text-[13px]">{machine.name}</p>
                      <p className="text-[12px] text-faint">{running ? "Working" : "Asleep"}</p>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <dl className="mt-10 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map(([term, detail]) => (
            <div key={term} data-reveal>
              <dt className="text-[14px] font-medium">{term}</dt>
              <dd className="l-body mt-1">{detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
