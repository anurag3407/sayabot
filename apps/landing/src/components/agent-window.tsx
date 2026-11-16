"use client"

import { useRef, type CSSProperties } from "react"
import type { SayaMood, SayaShape } from "@sayabot/core/mascot"
import { useInView, useSequence } from "@/lib/motion"
import { CheckIcon, LockIcon, PhoneIcon, TerminalIcon } from "./icons"
import { Saya } from "./saya"

/** ms per beat: ask, start computer, run tests, patch, pass, approval, allowed. */
const BEATS = [1300, 1500, 1700, 1500, 1400, 3400, 3600] as const

const SIDEBAR: { shape: SayaShape; name: string; role: string; mood: SayaMood; note: string }[] = [
  { shape: "block", name: "Block", role: "Engineer", mood: "working", note: "" },
  {
    shape: "ledger",
    name: "Ledger",
    role: "Bookkeeper",
    mood: "waiting",
    note: "Send 3 reminders?",
  },
  { shape: "bubble", name: "Bubble", role: "Inbox", mood: "done", note: "Inbox at zero" },
  { shape: "hoot", name: "Hoot", role: "Research", mood: "thinking", note: "Reading 12 sources" },
  { shape: "sprout", name: "Sprout", role: "Growth & SEO", mood: "sleeping", note: "Mon 6:00" },
]

const TERMINAL: { at: number; text: string; kind?: "cmd" | "bad" | "good" | "dim" }[] = [
  { at: 1, text: "~/shop $ git pull", kind: "cmd" },
  { at: 1, text: "Already up to date.", kind: "dim" },
  { at: 2, text: "~/shop $ pnpm test checkout", kind: "cmd" },
  { at: 2, text: "✗ cart total rounds 19.999 to 19.99", kind: "bad" },
  { at: 3, text: "~/shop $ apply patch src/cart.ts", kind: "cmd" },
  { at: 3, text: "+ return roundHalfUp(total, 2)", kind: "good" },
  { at: 4, text: "~/shop $ pnpm test", kind: "cmd" },
  { at: 4, text: "✓ 48 passed (2.1s)", kind: "good" },
  { at: 6, text: "~/shop $ gh pr create --fill", kind: "cmd" },
  { at: 6, text: "https://github.com/acme/shop/pull/212", kind: "dim" },
]

function Step({
  show,
  done,
  children,
}: {
  show: boolean
  done: boolean
  children: React.ReactNode
}) {
  if (!show) return null
  return (
    <div className={`aw-step ${done ? "is-done" : ""}`}>
      <span className="aw-step-icon">{done ? <CheckIcon /> : <span className="aw-spinner" />}</span>
      {children}
    </div>
  )
}

export function AgentWindow() {
  const box = useRef<HTMLDivElement>(null)
  const visible = useInView(box)
  const step = useSequence(BEATS, visible)
  const blockMood: SayaMood =
    step === 0 ? "thinking" : step === 5 ? "waiting" : step === 6 ? "done" : "working"

  return (
    <div className="aw-stage" ref={box}>
      <div className="aw card">
        <div className="beam" />
        <div className="aw-bar">
          <span className="aw-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="aw-title">Sayabot</span>
          <span className="chip aw-machine">
            <span className="aw-live" /> Cloud computer · running
          </span>
        </div>

        <div className="aw-body">
          <aside className="aw-side" aria-label="Agents">
            <div className="aw-side-head">Agents</div>
            {SIDEBAR.map((agent, index) => {
              const mood = index === 0 ? blockMood : agent.mood
              return (
                <div key={agent.name} className={`aw-agent ${index === 0 ? "is-active" : ""}`}>
                  <Saya shape={agent.shape} mood={mood} className="aw-agent-face" />
                  <span className="aw-agent-text">
                    <strong>{agent.name}</strong>
                    <small className={mood === "waiting" ? "is-amber" : ""}>
                      {index === 0
                        ? step === 5
                          ? "Waiting on your yes"
                          : step === 6
                            ? "PR #212 opened"
                            : "Fixing checkout test"
                        : agent.note}
                    </small>
                  </span>
                </div>
              )
            })}
          </aside>

          <div className="aw-chat">
            <div className="aw-chat-head">
              <Saya shape="block" mood={blockMood} live className="aw-head-face" />
              <div>
                <strong>Block</strong>
                <small>Engineer · Claude</small>
              </div>
            </div>

            <div className="aw-thread">
              <div className="aw-msg aw-you">Fix the flaky checkout test and open a PR.</div>
              {step >= 1 ? <div className="aw-msg aw-bot">On it. Starting my computer.</div> : null}
              <Step show={step >= 1} done={step > 1}>
                Computer started · <code>/home/bot/shop</code>
              </Step>
              <Step show={step >= 2} done={step > 2}>
                Ran the checkout tests · 1 failing
              </Step>
              <Step show={step >= 3} done={step > 3}>
                Patched <code>src/cart.ts</code>
              </Step>
              <Step show={step >= 4} done={step > 4}>
                All 48 tests pass
              </Step>

              {step === 5 ? (
                <div className="aw-approve">
                  <div className="aw-approve-head">
                    <LockIcon />
                    <span>Needs your approval</span>
                    <span className="aw-clock" style={{ "--t": `${BEATS[5]}ms` } as CSSProperties}>
                      5 min, then no
                    </span>
                  </div>
                  <p>
                    Open pull request <strong>#212</strong> on <strong>acme/shop</strong>?
                  </p>
                  <div className="aw-approve-actions">
                    <span className="aw-btn">Deny</span>
                    <span className="aw-btn aw-btn-yes">Allow</span>
                  </div>
                </div>
              ) : null}

              {step === 6 ? (
                <>
                  <div className="aw-toast">
                    <PhoneIcon /> Allowed from your phone
                  </div>
                  <div className="aw-msg aw-bot">
                    Opened <span className="aw-link">PR #212</span>. Rounding fixed, tests green.
                    I&apos;ll watch CI and tell you if review asks for changes.
                  </div>
                </>
              ) : null}
            </div>

            <div className="aw-input" aria-hidden>
              Message Block…
            </div>
          </div>

          <div className="aw-computer" aria-label="Block's computer">
            <div className="aw-computer-head">
              <TerminalIcon /> block · /home/bot
            </div>
            <div className="aw-term">
              {TERMINAL.filter((line) => line.at <= step).map((line, index) => (
                <div key={`${line.text}-${index}`} className={`aw-line ${line.kind ?? ""}`}>
                  {line.text}
                </div>
              ))}
              <span className="aw-caret" />
            </div>
            <div className="aw-files">
              <span>shop/</span>
              <span className={step >= 3 ? "is-hot" : ""}>src/cart.ts</span>
              <span>notes.md</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
