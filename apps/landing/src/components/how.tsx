"use client"

import { useRef, type ReactNode } from "react"
import { useInView } from "@/lib/motion"
import { CheckIcon, LockIcon } from "./icons"
import { Reveal } from "./reveal"
import { Saya } from "./saya"

/** A card whose scene only animates while it is on screen. */
function Scene({
  index,
  title,
  children,
  body,
}: {
  index: number
  title: string
  children: ReactNode
  body: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const on = useInView(ref)
  return (
    <Reveal index={index} className="how-item">
      <div ref={ref} className={`how-scene card ${on ? "is-on" : ""}`} aria-hidden>
        {children}
      </div>
      <h3 className="how-title">
        <span className="how-num">{index + 1}.</span> {title}
      </h3>
      <p className="how-body">{body}</p>
    </Reveal>
  )
}

export function How() {
  return (
    <section className="section" id="how" aria-labelledby="how-title">
      <div className="wrap">
        <Reveal>
          <span className="eyebrow">How it works</span>
          <h2 className="h2" id="how-title">
            From a sentence to a <em>teammate</em>.
          </h2>
          <p className="lede">Four steps, no setup wizard. Start with one agent and one job.</p>
        </Reveal>

        <div className="how-grid">
          <Scene
            index={0}
            title="Hire an agent"
            body="Name it, pick a role and a model. It gets a face, a memory and its own place in your workspace."
          >
            <div className="sc-form">
              <span className="sc-label">New agent</span>
              <span className="sc-field">
                <span className="sc-type">Ledger</span>
                <span className="sc-caret" />
              </span>
              <span className="sc-chips">
                <span className="sc-chip">Bookkeeper</span>
                <span className="sc-chip sc-chip-model">Claude</span>
              </span>
              <span className="sc-create">Create</span>
            </div>
            <div className="sc-pop">
              <Saya shape="ledger" mood="done" />
            </div>
          </Scene>

          <Scene
            index={1}
            title="It gets a computer"
            body="A sandboxed Linux machine of its own. Files in /home/bot stay put between runs, like a real desk."
          >
            <div className="sc-box">
              <div className="sc-box-top">
                <span className="sc-led" />
                <span className="mono">ledger · /home/bot</span>
              </div>
              <div className="sc-lines mono">
                <span>$ ls</span>
                <span className="dim">invoices/ receipts/ notes.md</span>
                <span>$ python match.py</span>
                <span className="good">✓ 41 receipts matched</span>
              </div>
            </div>
          </Scene>

          <Scene
            index={2}
            title="Give it a schedule"
            body="Every morning, every Monday, every 30 minutes, in your timezone. It wakes up, does the job and reports back."
          >
            <div className="sc-routines">
              {[
                ["Chase unpaid invoices", "Weekdays 07:00"],
                ["File new receipts", "Every 30 min"],
                ["Month-end summary", "1st of month"],
              ].map(([name, when], index) => (
                <div
                  key={name}
                  className="sc-routine"
                  style={{ animationDelay: `${index * 1.1}s` }}
                >
                  <span className="sc-routine-dot" />
                  <span className="sc-routine-name">{name}</span>
                  <span className="sc-routine-when mono">{when}</span>
                </div>
              ))}
              <span className="sc-sweep" />
            </div>
          </Scene>

          <Scene
            index={3}
            title="Say yes from anywhere"
            body="Shell commands, deletes, sends and pull requests stop and wait. Approve from the app, the web or your phone. Silence for five minutes means no."
          >
            <div className="sc-phone">
              <div className="sc-card">
                <span className="sc-card-head">
                  <span className="sc-lock">
                    <LockIcon />
                  </span>
                  Ledger asks
                </span>
                <span className="sc-card-text">Send 4 payment reminders?</span>
                <span className="sc-card-actions">
                  <span>Deny</span>
                  <span className="sc-allow">
                    Allow
                    <span className="sc-ripple" />
                  </span>
                </span>
              </div>
              <span className="sc-done">
                <CheckIcon /> Sent
              </span>
            </div>
          </Scene>
        </div>
      </div>
    </section>
  )
}
