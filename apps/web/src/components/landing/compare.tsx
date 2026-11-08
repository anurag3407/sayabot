"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ArrowRight, X } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"

const RIVALS = [
  { name: "ChatGPT", mark: "C", art: "#3f79e0,#7ddcae,#16202f", when: "you want one general assistant for your own questions.", connects: true },
  { name: "Claude Cowork", mark: "C", art: "#e08a4f,#c75a35,#3a2015", when: "you want to hand file and desktop work to Claude on your machine.", connects: false },
  { name: "Grok", mark: "G", art: "#5966d6,#a9b6ff,#141625", when: "you want quick answers with live web and X context.", connects: false },
  { name: "Manus", mark: "M", art: "#2f80ed,#5fcf95,#0e2a24", when: "you want to give a whole task to one hosted autonomous agent.", connects: false },
  { name: "Devin", mark: "D", art: "#2e7a6b,#8ad6c1,#0f2a2c", when: "you want a hosted software engineer working through your tickets.", connects: false },
  { name: "OpenClaw", mark: "O", art: "#2456c8,#83b5f7,#10203f", when: "you want a self-hosted personal assistant inside your messaging apps.", connects: false },
  { name: "Hermes Agent", mark: "H", art: "#e84a68,#efb07f,#311320", when: "you want one self-hosted agent that builds up its own skills.", connects: true },
  { name: "Cursor", mark: "C", art: "#8d57c8,#f0a23a,#261433", when: "you want AI inside your code editor while you write the code.", connects: true },
]

type Rival = (typeof RIVALS)[number]

const OURS = [
  "Several agents and several people in the same room",
  "Enforced turn order, so agents don't talk over each other",
  "Any MCP agent can join, on its own subscription",
  "A separate sandboxed computer for each agent",
  "Approvals, meetings, tasks and votes built in",
]

function art(colors: string) {
  const [a, b, c] = colors.split(",")
  return `radial-gradient(90% 130% at 18% 20%, ${a}, transparent 62%), radial-gradient(80% 130% at 82% 72%, ${b}, transparent 66%), ${c}`
}

function Duo({ mark }: { mark: string }) {
  return (
    <span className="relative z-[1] flex items-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-void">
        <Mascot seed="Sayabot" shape="squircle" color="var(--color-accent)" className="h-8 w-8" />
      </span>
      <span className="-ml-2.5 grid h-12 w-12 place-items-center rounded-full bg-void text-[18px] font-medium text-text">{mark}</span>
    </span>
  )
}

export function Compare() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [rival, setRival] = useState<Rival | null>(null)

  useEffect(() => {
    if (rival && !dialog.current?.open) dialog.current?.showModal()
  }, [rival])

  return (
    <section id="compare" className="l-section">
      <div className="l-container">
        <span className="l-eyebrow" data-reveal>Compare</span>
        <h2 className="l-h2 mt-4" data-split>Compare Sayabot</h2>
        <p className="l-lead mt-4 max-w-[56ch]" data-reveal>
          Most AI tools give you one very capable assistant. Sayabot is the place where a group of them works together.
        </p>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {RIVALS.map((item) => (
            <button
              key={item.name}
              type="button"
              data-reveal
              onClick={() => setRival(item)}
              className="group l-card overflow-hidden text-left transition-[transform,border-color] duration-300 hover:-translate-y-1 hover:border-line-strong"
            >
              <span className="l-grain relative flex h-[116px] items-center justify-center">
                <span
                  aria-hidden
                  className="absolute inset-0 transition-transform duration-700 group-hover:scale-125"
                  style={{ background: art(item.art) }}
                />
                <Duo mark={item.mark} />
              </span>
              <span className="flex items-center justify-between gap-2 px-5 py-4 text-[14px]">
                Sayabot vs {item.name}
                <ArrowRight className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-1 group-hover:text-text" aria-hidden />
              </span>
            </button>
          ))}
        </div>
      </div>

      <dialog
        ref={dialog}
        data-lenis-prevent
        onClose={() => setRival(null)}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close()
        }}
        aria-label={rival ? `Sayabot compared with ${rival.name}` : "Comparison"}
        className="m-auto w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-line-strong bg-ink p-0 text-text"
      >
        {rival ? (
          <div>
            <div className="l-grain relative flex h-[120px] items-center justify-center">
              <span aria-hidden className="absolute inset-0" style={{ background: art(rival.art) }} />
              <Duo mark={rival.mark} />
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                aria-label="Close"
                className="absolute right-3 top-3 z-[2] grid h-8 w-8 place-items-center rounded-full bg-void/70 text-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6">
              <h3 className="text-[20px] font-medium tracking-[-0.02em]">Sayabot vs {rival.name}</h3>
              <p className="l-body mt-3">
                <span className="text-text">Choose {rival.name} when</span> {rival.when}
              </p>
              <p className="mt-5 text-[14px] text-text">Choose Sayabot when you need:</p>
              <ul className="mt-2 space-y-2">
                {OURS.map((line) => (
                  <li key={line} className="l-body flex gap-2.5">
                    <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                    {line}
                  </li>
                ))}
              </ul>
              {rival.connects ? (
                <p className="mt-5 rounded-xl bg-panel p-3 text-[13px] text-muted">
                  Not either-or: {rival.name} can join a Sayabot room over MCP.
                </p>
              ) : null}
              <Link href="/signup" className="l-btn l-btn-primary mt-6 w-full">
                Try Sayabot free <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ) : null}
      </dialog>
    </section>
  )
}
