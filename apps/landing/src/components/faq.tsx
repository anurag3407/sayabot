"use client"

import { useState } from "react"
import type { SayaMood } from "@sayabot/core/mascot"
import { Saya } from "./saya"

interface FaqItem {
  q: string
  a: string
  remark: string
  mood: SayaMood
}

const ITEMS: FaqItem[] = [
  {
    q: "Do I need an account or a subscription?",
    a: "No. You don't need a Sayabot account or any paid subscription. You bring your own model API keys (OpenAI, Anthropic, Gemini, DeepSeek, Ollama) or log into the Claude Code / ChatGPT plans you already pay for. Sayabot has zero per-seat fees and zero token markup.",
    remark: "Nope. No account needed to get started.",
    mood: "done",
  },
  {
    q: "Is it free?",
    a: "Yes. The entire core platform is free and open source under AGPL-3.0. You can download the desktop app, run the web workspace, or self-host the entire stack with Docker. Model costs stay between you and your provider.",
    remark: "100% free and open source under AGPL-3.0.",
    mood: "done",
  },
  {
    q: "Does my code leave my Mac?",
    a: "Never without your explicit approval. Workloads execute inside an isolated Linux container or local sandbox bounded strictly to /home/bot and /tmp. Outbound network requests are filtered through an SSRF-hardened proxy and dangerous actions require your confirmation.",
    remark: "Never. Sandboxed in /home/bot on your machine.",
    mood: "working",
  },
  {
    q: "What if nobody answers an approval?",
    a: "After five minutes the request counts as a no. The tool does not run, the agent is told, and the decision stays on the permanent audit record. A restart does not leave an old request hanging.",
    remark: "After 5 minutes it safely defaults to a No.",
    mood: "waiting",
  },
  {
    q: "Can an agent see my API keys?",
    a: "No. Keys are sealed with AES-256-GCM envelope encryption using MESH_KEK. The agent only sees placeholder tokens like $SECRET{STRIPE_KEY}. The real secret is injected strictly outbound by the orchestrator proxy for approved calls.",
    remark: "Zero plaintext keys. Sealed with AES-256.",
    mood: "working",
  },
  {
    q: "How does a bot keep working while my Mac is off?",
    a: "You can point Sayabot at an external Linux computer or server over SSH/Docker. Sayabot Cloud, where persistent agent computers keep running while your laptop is closed, is coming soon.",
    remark: "On your own server or droplet with Docker.",
    mood: "thinking",
  },
  {
    q: "Which models can I use?",
    a: "Any model you have an API key or subscription for: Claude (Opus, Sonnet, Haiku), OpenAI (GPT-4o, o3-mini), Google Gemini 2.5, DeepSeek R1, or local models running on Ollama. The desktop app connects to your existing Claude Code and Codex logins directly.",
    remark: "Claude, GPT, Gemini, DeepSeek, or local Ollama!",
    mood: "done",
  },
  {
    q: "Can I run it myself?",
    a: "Yes. The complete monorepo is public on GitHub under AGPL-3.0. You can spin up the orchestrator, database, computer daemon, and web app with a single docker-compose up.",
    remark: "Yes! Spin up the whole stack with Docker.",
    mood: "done",
  },
]

const PLAYFUL_REMARKS: { remark: string; mood: SayaMood }[] = [
  { remark: "Fair questions. I'd ask them too.", mood: "idle" },
  { remark: "Click any question to peek inside!", mood: "thinking" },
  { remark: "Zero per-seat fees. No token markups.", mood: "done" },
  { remark: "Keys sealed with AES-256 envelope.", mood: "working" },
  { remark: "Risky actions pause for your approval.", mood: "waiting" },
  { remark: "Everything runs in isolated sandboxes.", mood: "working" },
  { remark: "100% open source on GitHub!", mood: "done" },
]

export function Faq() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [clickCount, setClickCount] = useState(0)
  const [bubbleKey, setBubbleKey] = useState(0)
  const [mascotHovered, setMascotHovered] = useState(false)

  // Current mood & remark determination
  let currentMood: SayaMood = "idle"
  let currentRemark = "Fair questions. I'd ask them too."

  if (openIndex !== null && ITEMS[openIndex]) {
    currentMood = ITEMS[openIndex].mood
    currentRemark = ITEMS[openIndex].remark
  } else if (clickCount > 0) {
    const cycle = PLAYFUL_REMARKS[clickCount % PLAYFUL_REMARKS.length]!
    currentMood = cycle.mood
    currentRemark = cycle.remark
  }

  if (mascotHovered && currentMood === "idle") {
    currentMood = "done"
  }

  function handleMascotClick() {
    setOpenIndex(null)
    setClickCount((c) => c + 1)
    setBubbleKey((k) => k + 1)
  }

  function handleToggle(index: number, isOpen: boolean) {
    if (isOpen) {
      setOpenIndex(index)
      setBubbleKey((k) => k + 1)
    } else if (openIndex === index) {
      setOpenIndex(null)
      setBubbleKey((k) => k + 1)
    }
  }

  return (
    <section className="section" id="faq" aria-labelledby="faq-title">
      <div className="wrap faq-wrap">
        <div className="faq-head">
          <span className="eyebrow">Questions</span>
          <h2 className="h2 faq-title" id="faq-title">
            <span>Good to know.</span>
            <span className="faq-title-sub">Before you download.</span>
          </h2>

          <div className="faq-mascot-card">
            <button
              type="button"
              className="faq-mascot-btn"
              onClick={handleMascotClick}
              onMouseEnter={() => setMascotHovered(true)}
              onMouseLeave={() => setMascotHovered(false)}
              aria-label="Click to interact with Saya"
              title="Click me!"
            >
              <Saya
                shape="ghost"
                tone="lilac"
                mood={currentMood}
                follow
                live
                pool
                lit={openIndex !== null || mascotHovered}
                className="faq-saya-face"
              />
            </button>
            <div
              className="faq-bubble"
              key={bubbleKey}
              onClick={handleMascotClick}
              role="status"
              aria-live="polite"
            >
              <span className="faq-bubble-text">{currentRemark}</span>
              <span className="faq-bubble-tail" aria-hidden="true" />
            </div>
          </div>
        </div>

        <div className="faq-list">
          {ITEMS.map((item, index) => (
            <details
              key={item.q}
              className="faq-item"
              name="faq"
              open={openIndex === index}
              onToggle={(e) => {
                const target = e.currentTarget as HTMLDetailsElement
                handleToggle(index, target.open)
              }}
            >
              <summary>
                <span>{item.q}</span>
                <span className="faq-plus" aria-hidden="true">
                  +
                </span>
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
