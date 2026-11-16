"use client"

import { useRef } from "react"
import { useInView, useSequence } from "@/lib/motion"
import { CheckIcon, KeyIcon, LaptopIcon, ServerIcon, TerminalIcon } from "./icons"
import { Reveal } from "./reveal"
import { Saya } from "./saya"

const LINES: { text: string; kind?: "cmd" | "dim" | "good" | "key" }[] = [
  { text: "bot@ledger:~$ cd invoices && ls", kind: "cmd" },
  { text: "2026-03/  2026-04/  overdue.csv", kind: "dim" },
  { text: "bot@ledger:~/invoices$ python remind.py --dry-run", kind: "cmd" },
  { text: "4 overdue · 4 drafts written to drafts/", kind: "dim" },
  { text: 'bot@ledger:~$ curl -H "Authorization: Bearer $SECRET{STRIPE_KEY}" …', kind: "key" },
  { text: "200 OK · 4 invoices marked reminded", kind: "good" },
  { text: 'bot@ledger:~$ echo "March reconciled" >> notes.md', kind: "cmd" },
]

const BEATS = [900, 900, 1100, 900, 1600, 1000, 1200, 2600] as const

export function Computer() {
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref)
  const step = useSequence(BEATS, visible)

  return (
    <section className="section" id="computer" aria-labelledby="computer-title">
      <div className="wrap">
        <div className="computer card" ref={ref}>
          <div className="computer-copy">
            <Reveal>
              <span className="eyebrow">Computers</span>
              <h2 className="h2" id="computer-title">
                Every agent gets a computer.
              </h2>
              <p className="lede">
                A sandboxed Linux machine per agent, with a <code className="code">/home/bot</code>{" "}
                that survives restarts. It clones, builds, tests and keeps notes there. Start or
                stop it from the web or your phone.
              </p>
            </Reveal>
            <ul className="computer-points">
              <Reveal as="li" index={1}>
                <ServerIcon />{" "}
                <span>
                  <strong>Persistent and isolated.</strong> One machine per agent, never shared.
                </span>
              </Reveal>
              <Reveal as="li" index={2}>
                <KeyIcon />{" "}
                <span>
                  <strong>Keys stay in a broker.</strong> The agent writes{" "}
                  <code className="code">$SECRET&#123;NAME&#125;</code>; the real value is swapped
                  in on the way out.
                </span>
              </Reveal>
              <Reveal as="li" index={3}>
                <LaptopIcon />{" "}
                <span>
                  <strong>Or use your own machine.</strong> The desktop app runs Claude Code, Codex,
                  Gemini CLI and more on your Mac.
                </span>
              </Reveal>
            </ul>
          </div>

          <div className="desk" aria-hidden>
            <div className="desk-top">
              <span className="desk-live">
                <span /> Live
              </span>
              <span className="mono">ledger · cloud computer</span>
              <span className="desk-meters">
                <span className="desk-meter">
                  CPU <i style={{ animationDelay: "0s" }} />
                </span>
                <span className="desk-meter">
                  MEM <i style={{ animationDelay: "0.8s" }} />
                </span>
              </span>
            </div>
            <div className="desk-body">
              <div className="desk-files">
                <span className="desk-files-head">/home/bot</span>
                <span>invoices/</span>
                <span>receipts/</span>
                <span>drafts/</span>
                <span className={step >= 6 ? "is-hot" : ""}>notes.md</span>
                <span>.saaya/env</span>
              </div>
              <div className="desk-term mono">
                <div className="desk-term-head">
                  <TerminalIcon /> terminal
                </div>
                {LINES.slice(0, step).map((line, index) => (
                  <div key={index} className={`desk-line ${line.kind ?? ""}`}>
                    {line.text}
                  </div>
                ))}
                <span className="aw-caret" />
              </div>
            </div>
            {step >= 5 && step <= 6 ? (
              <div className="desk-toast">
                <KeyIcon />
                <span>
                  Broker injected <strong>STRIPE_KEY</strong>. The agent never saw it.
                </span>
              </div>
            ) : null}
            {step === 7 ? (
              <div className="desk-toast desk-toast-good">
                <CheckIcon />
                <span>Saved to /home/bot. Still there tomorrow.</span>
              </div>
            ) : null}
            <Saya
              shape="ledger"
              mood={step >= 7 ? "done" : "working"}
              live
              className="desk-agent"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
