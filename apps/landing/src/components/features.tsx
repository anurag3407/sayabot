"use client"

import { useRef, type CSSProperties } from "react"
import type { SayaShape } from "@sayabot/core/mascot"
import { useInView, useSequence } from "@/lib/motion"
import { CheckIcon, ClockIcon, KeyIcon, ListIcon } from "./icons"
import { Reveal } from "./reveal"
import { Saya } from "./saya"

const MODELS = [
  { name: "Claude", by: "Anthropic" },
  { name: "GPT", by: "OpenAI" },
  { name: "Gemini", by: "Google" },
  { name: "DeepSeek", by: "DeepSeek" },
  { name: "Llama, Qwen…", by: "Ollama, on your machine" },
]

const LOG = [
  ["09:01", "block", "bash · pnpm test", "allowed"],
  ["09:02", "ledger", "stripe · send reminder", "approved by you"],
  ["09:02", "hoot", "web · fetch 12 pages", "allowed"],
  ["09:04", "bubble", "slack · post reply", "approved by you"],
  ["09:05", "block", "github · open PR #212", "approved by you"],
  ["09:07", "sprout", "bash · rm -rf build/", "denied"],
]

const ROOM: SayaShape[] = ["block", "ghost", "hoot", "ledger"]

function useOn() {
  const ref = useRef<HTMLDivElement>(null)
  return [ref, useInView(ref)] as const
}

export function Features() {
  const [modelRef, modelOn] = useOn()
  const model = useSequence([1800, 1800, 1800, 1800, 1800], modelOn)
  const [roomRef, roomOn] = useOn()
  const turn = useSequence([1500, 1500, 1500, 1500], roomOn)

  return (
    <section className="section" id="features" aria-labelledby="features-title">
      <div className="wrap">
        <Reveal>
          <span className="eyebrow">Built for trust</span>
          <h2 className="h2" id="features-title">
            Autonomous, <em>not unsupervised</em>.
          </h2>
          <p className="lede">
            Agents that run on their own still answer to you. Every choice below is the default, not
            a setting you have to find.
          </p>
        </Reveal>

        <div className="bento">
          <Reveal className="bento-card card bento-wide" index={0}>
            <div ref={modelRef} className="bento-inner bento-split">
              <div>
                <h3>Bring your own model</h3>
                <p>
                  Pick a model per agent with your own API keys, or let the desktop app use the
                  Claude Code and Codex subscriptions you already pay for.
                </p>
              </div>
              <div className="models" aria-hidden>
                {MODELS.map((item, index) => (
                  <div key={item.name} className={`model ${index === model ? "is-on" : ""}`}>
                    <span className="model-dot" />
                    <span className="model-name">{item.name}</span>
                    <span className="model-by">{item.by}</span>
                    {index === model ? <CheckIcon className="model-check" /> : null}
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal className="bento-card card" index={1}>
            <div className="bento-inner">
              <h3>Schedules and triggers</h3>
              <p>Every morning, every Monday, or whenever a message lands in a connected chat.</p>
              <div className="routine" aria-hidden>
                <div className="routine-head">
                  <Saya shape="ledger" mood="sleeping" className="routine-face" />
                  <strong>Chase unpaid invoices</strong>
                  <span className="routine-soon">in 34m</span>
                </div>
                <div className="routine-row">
                  <ClockIcon /> Every weekday · 07:00
                </div>
                <div className="routine-row routine-hook">
                  Reply goes to <strong>Telegram</strong>
                </div>
                <span className="routine-bar" />
              </div>
            </div>
          </Reveal>

          <Reveal className="bento-card card" index={2}>
            <div className="bento-inner">
              <h3>Secrets stay sealed</h3>
              <p>Encrypted with AES-256-GCM. Agents only ever see a placeholder.</p>
              <div className="secret mono" aria-hidden>
                <KeyIcon />
                <span className="secret-swap">
                  <span className="secret-a">$SECRET&#123;STRIPE_KEY&#125;</span>
                  <span className="secret-b">sk_live_••••••••••••</span>
                </span>
              </div>
              <span className="secret-note">
                swapped in on the way out, never shown to the model
              </span>
            </div>
          </Reveal>

          <Reveal className="bento-card card" index={3}>
            <div className="bento-inner">
              <h3>Every action on the record</h3>
              <p>Each tool call is logged, with who allowed it.</p>
              <div className="log mono" aria-hidden>
                <div className="log-track">
                  {[...LOG, ...LOG].map(([time, who, what, result], index) => (
                    <div
                      key={index}
                      className={`log-row ${result === "denied" ? "is-bad" : result?.startsWith("approved") ? "is-amber" : ""}`}
                    >
                      <span className="log-time">{time}</span>
                      <span className="log-who">{who}</span>
                      <span className="log-what">{what}</span>
                      <span className="log-result">{result}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal className="bento-card card" index={4}>
            <div className="bento-inner">
              <h3>Talk where you already are</h3>
              <p>Message your agents from Slack, Discord, Telegram or WhatsApp, or the apps.</p>
              <div className="channels" aria-hidden>
                {["Slack", "Discord", "Telegram", "WhatsApp"].map((name, index) => (
                  <span key={name} className="channel" style={{ "--i": index } as CSSProperties}>
                    {name}
                  </span>
                ))}
                <span className="channel-bubble">@ledger did Northwind pay?</span>
                <span className="channel-bubble channel-reply">Yes, $1,280 this morning.</span>
              </div>
            </div>
          </Reveal>

          <Reveal className="bento-card card bento-full" index={5}>
            <div ref={roomRef} className="bento-inner bento-split">
              <div>
                <h3>And when one agent isn&apos;t enough: rooms</h3>
                <p>
                  Put several agents in a room with your team. They take turns, so nobody talks over
                  anyone, and they share one thread, one task list and one live canvas.
                </p>
              </div>
              <div className="room" aria-hidden>
                <div className="room-row">
                  {ROOM.map((shape, index) => (
                    <div key={shape} className={`room-seat ${index === turn ? "is-turn" : ""}`}>
                      <Saya
                        shape={shape}
                        mood={index === turn ? "working" : "idle"}
                        lit={index === turn}
                        live
                      />
                      <span className="room-tag">{index === turn ? "speaking" : "waiting"}</span>
                    </div>
                  ))}
                </div>
                <div className="room-token">
                  <ListIcon /> one turn at a time
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
