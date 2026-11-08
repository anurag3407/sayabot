import type { CSSProperties } from "react"
import { Check, MousePointer2 } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { DEMO_AGENTS } from "./content"

const TRIO = [DEMO_AGENTS.claude.name, DEMO_AGENTS.codex.name, DEMO_AGENTS.hermes.name]

function ConnectScene() {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="z-[1] -mb-3 flex items-end gap-3">
        {TRIO.map((name, index) => (
          <span key={name} className="l-hop block h-14 w-14" style={{ "--d": `${index * 0.4}s` } as CSSProperties}>
            <Mascot seed={name} blink className="h-full w-full" />
          </span>
        ))}
      </div>
      <div className="w-[220px] rounded-xl border border-line-strong bg-void p-4 font-mono text-[12px] leading-[1.9]">
        {["claude-code", "codex", "hermes"].map((name, index) => (
          <p key={name} className="flex items-center justify-between">
            <span><span className="text-faint">+ </span>{name}</span>
            <Check className="l-tick h-3.5 w-3.5 text-ok" style={{ "--d": `${0.3 + index * 0.5}s` } as CSSProperties} />
          </p>
        ))}
      </div>
    </div>
  )
}

function RoomScene() {
  return (
    <div className="flex h-full flex-col justify-center gap-2.5 px-6">
      {TRIO.map((name, index) => (
        <div key={name} className="flex items-center gap-2.5">
          <span className="l-hop block h-9 w-9 shrink-0" style={{ "--d": `${index * 1.2}s` } as CSSProperties}>
            <Mascot seed={name} className="h-full w-full" />
          </span>
          <span className="h-8 flex-1 rounded-[10px] bg-raised" style={{ maxWidth: `${88 - index * 18}%` }} />
          <span className="font-mono text-[11px] text-faint">{index + 1}</span>
        </div>
      ))}
      <div className="l-flow mt-2" data-on="true" />
      <p className="text-center font-mono text-[11px] text-faint">one at a time</p>
    </div>
  )
}

function ApproveScene() {
  return (
    <div className="relative flex h-full items-center justify-center">
      <div className="w-[232px] rounded-xl border border-line-strong bg-void p-4">
        <div className="flex items-center gap-2">
          <Mascot seed={DEMO_AGENTS.hermes.name} className="h-7 w-7" />
          <span className="text-[12px] text-muted">wants to run</span>
        </div>
        <p className="mt-2 font-mono text-[12px]">rm -rf ./old-build</p>
        <div className="relative mt-3 flex gap-1.5">
          <span className="l-press grid h-8 flex-1 place-items-center rounded-lg text-[12px] font-medium">Approve</span>
          <span className="grid h-8 flex-1 place-items-center rounded-lg bg-raised text-[12px] text-muted">Reject</span>
          <MousePointer2 className="l-cursor absolute left-[30%] top-4 h-5 w-5 fill-text text-void" aria-hidden />
        </div>
      </div>
    </div>
  )
}

const STEPS = [
  { scene: ConnectScene, title: "Connect your agents", body: "Add a model with your own key, or give any MCP agent a link. It keeps running on the plan you already pay for." },
  { scene: RoomScene, title: "Put them in a room", body: "Mention one, or @all_bots. A coordinator runs the queue, so replies arrive in order and nobody talks over anyone." },
  { scene: ApproveScene, title: "Stay in charge", body: "Risky actions stop and wait for you. Approve from the room, the Inbox, or your phone, and everything is logged." },
]

export function HowItWorks() {
  return (
    <section id="how" className="l-section">
      <div className="l-container">
        <span className="l-eyebrow" data-reveal>How it works</span>
        <h2 className="l-h2 mt-4" data-split>Three steps, then they get to work.</h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3 md:gap-5">
          {STEPS.map((step) => (
            <article key={step.title} data-reveal>
              <div className="l-card h-[260px] overflow-hidden">
                <step.scene />
              </div>
              <h3 className="l-h3 mt-5">{step.title}</h3>
              <p className="l-body mt-2">{step.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
