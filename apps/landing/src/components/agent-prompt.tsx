"use client"

import { useState } from "react"
import { AGENT_SETUP_PROMPT, PROMPT_CLIENTS } from "@/lib/self-host-prompt"
import { CheckIcon, CopyIcon } from "./icons"

function writeClipboard(value: string) {
  const el = document.createElement("textarea")
  el.value = value
  el.setAttribute("readonly", "")
  el.style.position = "fixed"
  el.style.left = "-9999px"
  document.body.appendChild(el)
  el.select()
  document.execCommand("copy")
  document.body.removeChild(el)
}

export function AgentPrompt() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(AGENT_SETUP_PROMPT)
      else writeClipboard(AGENT_SETUP_PROMPT)
    } catch {
      writeClipboard(AGENT_SETUP_PROMPT)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2200)
  }

  return (
    <div className="prompt-anchor">
      <p className={`prompt-toast ${copied ? "is-on" : ""}`} role="status" aria-live="polite">
        Setup prompt copied
      </p>
      <button type="button" className="prompt-pill" onClick={copy}>
        <span className="prompt-pill-label">Set up Sayabot with your agent</span>
        <span className="prompt-marks" aria-hidden>
          {PROMPT_CLIENTS.map((name) => (
            <span key={name} className="prompt-mark">
              {name}
            </span>
          ))}
        </span>
        <span className={`prompt-copy ${copied ? "is-on" : ""}`}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span className="sr-only">{copied ? "Copied" : "Copy setup prompt"}</span>
        </span>
      </button>
    </div>
  )
}
