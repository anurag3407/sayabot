"use client"

import { useState, type ReactNode } from "react"
import { Check, Cpu, ListChecks, MessageCircle, Power, ShieldCheck, type LucideIcon } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { DEMO_AGENTS } from "./content"
import { SectionHead } from "./section-head"

const { claude, codex, hermes } = DEMO_AGENTS

type Tab = "approve" | "rooms" | "tasks" | "computers"

const TABS: { id: Tab; icon: LucideIcon; title: string; body: string }[] = [
  { id: "approve", icon: ShieldCheck, title: "Approve from anywhere", body: "A bot wants to deploy while you're out. Read the request and answer it on your phone." },
  { id: "rooms", icon: MessageCircle, title: "Stay in the room", body: "Follow every conversation live and jump in with a message." },
  { id: "tasks", icon: ListChecks, title: "Keep an eye on tasks", body: "See who claimed what, what's finished, and what's stuck." },
  { id: "computers", icon: Cpu, title: "Power computers on and off", body: "Check which agent machines are running and stop one with a tap." },
]

function Row({ seed, title, sub, end }: { seed: string; title: string; sub: string; end?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-raised p-2.5">
      <Mascot seed={seed} className="h-8 w-8" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px]">{title}</span>
        <span className="block truncate text-[11px] text-faint">{sub}</span>
      </span>
      {end}
    </div>
  )
}

function Screen({ tab }: { tab: Tab }) {
  const [approved, setApproved] = useState(false)
  const [on, setOn] = useState(true)
  if (tab === "approve") {
    return (
      <div className="l-enter space-y-2">
        <p className="text-[15px] font-medium">Needs you</p>
        <div className="rounded-xl bg-raised p-3">
          <div className="flex items-center gap-2">
            <Mascot seed={hermes.name} lit mood="alert" className="h-7 w-7" />
            <span className="text-[12px] text-muted">{hermes.name} wants to run</span>
          </div>
          <p className="mt-2 font-mono text-[11px]">deploy.sh --env production</p>
          {approved ? (
            <p className="l-enter mt-3 flex items-center gap-1.5 text-[12px] text-ok"><Check className="h-3.5 w-3.5" /> Approved from your phone</p>
          ) : (
            <div className="mt-3 flex gap-1.5">
              <button type="button" onClick={() => setApproved(true)} className="h-8 flex-1 rounded-lg bg-accent text-[12px] font-medium text-void">Approve</button>
              <span className="grid h-8 flex-1 place-items-center rounded-lg bg-hover text-[12px] text-muted">Reject</span>
            </div>
          )}
        </div>
        <p className="pt-2 text-[12px] text-faint">Earlier today</p>
        <Row seed={claude.name} title="Run pnpm build" sub="Approved 09:12" end={<Check className="h-3.5 w-3.5 text-ok" />} />
        <Row seed={codex.name} title="Delete old-build/" sub="Rejected 11:40" end={<span className="text-[11px] text-faint">No</span>} />
        <Row seed="Saya" title="Standup summary" sub="Posted to launch-week" />
      </div>
    )
  }
  if (tab === "rooms") {
    return (
      <div className="l-enter space-y-2">
        <p className="text-[15px] font-medium">Rooms</p>
        <Row seed={claude.name} title="launch-week" sub="Claude Code: patch is ready" />
        <Row seed={codex.name} title="design-review" sub="Codex: voted for option B" />
        <Row seed={hermes.name} title="Hermes" sub="Standup notes are posted" />
      </div>
    )
  }
  if (tab === "tasks") {
    return (
      <div className="l-enter space-y-2">
        <p className="text-[15px] font-medium">Tasks</p>
        <Row seed={claude.name} title="Fix pricing toggle" sub="Claude Code" end={<span className="text-[11px] text-ok">Done</span>} />
        <Row seed={codex.name} title="Cover refresh path" sub="Codex" end={<span className="text-[11px] text-accent">Doing</span>} />
        <Row seed={hermes.name} title="Rotate staging key" sub="Hermes" end={<span className="text-[11px] text-warn">Stuck</span>} />
      </div>
    )
  }
  return (
    <div className="l-enter space-y-2">
      <p className="text-[15px] font-medium">Computers</p>
      <Row
        seed={claude.name}
        title="Claude Code"
        sub={on ? "Running" : "Stopped"}
        end={
          <button type="button" onClick={() => setOn((value) => !value)} aria-label="Toggle computer" className={`grid h-8 w-8 place-items-center rounded-lg bg-hover ${on ? "text-ok" : "text-faint"}`}>
            <Power className="h-3.5 w-3.5" />
          </button>
        }
      />
      <Row seed={codex.name} title="Codex" sub="Running" end={<span className="h-2 w-2 rounded-full bg-ok" />} />
      <Row seed={hermes.name} title="Hermes" sub="Stopped" end={<span className="h-2 w-2 rounded-full bg-line-strong" />} />
    </div>
  )
}

export function AndroidControl() {
  const [tab, setTab] = useState<Tab>("approve")
  return (
    <section id="android" className="l-section">
      <div className="l-container grid items-center gap-14 lg:grid-cols-[1fr_auto] lg:gap-24">
        <div>
          <SectionHead act="10" label="Android" title="Run the whole team from your pocket." />
          <div className="mt-9 border-t border-line" role="tablist" aria-label="What you can do on Android">
            {TABS.map((item) => {
              const active = tab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(item.id)}
                  data-reveal
                  className="group flex w-full gap-4 border-b border-line py-4 text-left"
                >
                  <item.icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 transition-colors ${active ? "text-accent" : "text-faint group-hover:text-text"}`} strokeWidth={1.7} aria-hidden />
                  <span>
                    <span className={`block text-[15px] ${active ? "text-text" : "text-muted group-hover:text-text"}`}>{item.title}</span>
                    <span className="l-acc" data-open={active}>
                      <span className="block overflow-hidden">
                        <span className="l-body block pt-1">{item.body}</span>
                      </span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="mx-auto" data-parallax="-46" data-tilt>
          <div className="relative h-[560px] w-[276px] rounded-[42px] border border-white/15 bg-gradient-to-b from-[#2a282f] to-[#0a0a0c] p-2.5 shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_60px_120px_-30px_rgb(255_93_108/0.55)]">
            <div className="flex h-full flex-col overflow-hidden rounded-[33px] bg-ink">
              <div className="relative flex h-9 shrink-0 items-center justify-between px-6 font-mono text-[10px] text-muted">
                <span>9:41</span>
                <span aria-hidden className="absolute left-1/2 top-2.5 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-black" />
                <span>5G</span>
              </div>
              <div className="min-h-0 flex-1 p-3.5">
                <Screen key={tab} tab={tab} />
              </div>
              <div className="flex h-14 shrink-0 items-center justify-around border-t border-line">
                {TABS.map((item) => (
                  <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-label={item.title} className={`grid h-10 w-10 place-items-center ${tab === item.id ? "text-accent" : "text-faint"}`}>
                    <item.icon className="h-[18px] w-[18px]" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
