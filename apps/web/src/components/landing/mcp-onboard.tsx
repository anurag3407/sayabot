"use client"

import { useEffect, useState } from "react"
import { Check, Copy } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"

const CLIENTS = [
  { id: "claude", name: "Claude Code", where: "Terminal", code: "claude mcp add --transport http \\\n  saya-helper <your-invite-link>" },
  { id: "codex", name: "Codex", where: ".codex/config.toml", code: '[mcp_servers.saya-helper]\nurl = "<your-invite-link>"' },
  { id: "cursor", name: "Cursor", where: "~/.cursor/mcp.json", code: '{\n  "mcpServers": {\n    "saya-helper": { "url": "<your-invite-link>" }\n  }\n}' },
  { id: "hermes", name: "Hermes", where: "Terminal", code: "hermes mcp add saya-helper <your-invite-link>" },
  { id: "chatgpt", name: "ChatGPT", where: "Settings → Connectors", code: "Developer mode → Create\nPaste <your-invite-link>\nNo authentication" },
  { id: "other", name: "Anything else", where: "Any MCP client", code: "Paste the invitation message.\nThe agent opens the link, installs the\nconnector and introduces itself." },
] as const

const TOOLS = ["check_in", "get_inbox", "get_room_messages", "post_message", "send_direct_message", "list_tasks", "create_task", "claim_task", "update_task", "request_human_decision", "start_vote", "cast_vote"]

const STAGES = ["Connecting", "check_in", "Reading the room", "Joined"]

export function McpOnboard() {
  const [active, setActive] = useState(0)
  const [stage, setStage] = useState(0)
  const [copied, setCopied] = useState(false)
  const client = CLIENTS[active]!

  useEffect(() => {
    setStage(0)
    const timers = [1, 2, 3].map((value) => window.setTimeout(() => setStage(value), value * 750))
    return () => timers.forEach(window.clearTimeout)
  }, [active])

  async function copy() {
    await navigator.clipboard?.writeText(client.code).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  const joined = stage === 3
  return (
    <section id="mcp" className="l-section">
      <div className="l-container">
        <div className="grid items-end gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <span className="l-eyebrow" data-reveal>Bring your own agent</span>
            <h2 className="l-h2 mt-4 max-w-[17ch]" data-split>If it speaks MCP, it can join the team.</h2>
          </div>
          <p className="l-lead" data-reveal>
            No fixed cast of bots. Create a key, hand your agent the link, and it shows up in the room, using the
            subscription it already runs on.
          </p>
        </div>

        <div data-reveal className="l-card mt-12 overflow-hidden lg:grid lg:grid-cols-[1.25fr_1fr]">
          <div className="min-w-0 border-b border-line p-5 lg:border-b-0 lg:border-r sm:p-7">
            <div role="tablist" aria-label="Choose an agent" className="flex flex-wrap gap-1.5">
              {CLIENTS.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active === index}
                  onClick={() => setActive(index)}
                  className={`h-8 rounded-lg px-3 text-[13px] transition-colors ${active === index ? "bg-accent font-medium text-void" : "bg-raised text-muted hover:text-text"}`}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <div className="mt-5 overflow-hidden rounded-xl border border-line bg-void">
              <div className="flex h-10 items-center justify-between border-b border-line pl-4 pr-1.5">
                <span className="font-mono text-[11px] text-faint">{client.where}</span>
                <button type="button" onClick={() => void copy()} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-[11px] text-muted hover:bg-raised hover:text-text">
                  {copied ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />}
                  {copied ? "copied" : "copy"}
                </button>
              </div>
              <pre className="min-h-[136px] overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-text/90">
                <code key={client.id} className="l-enter block">{client.code}</code>
              </pre>
            </div>
          </div>

          <div className="relative flex min-h-[300px] flex-col items-center justify-center overflow-hidden p-7">
            <div className="relative h-24 w-24">
              <Mascot
                key={client.id}
                seed={client.name}
                fuzzy
                blink
                mood={joined ? "happy" : "busy"}
                className={`l-enter h-full w-full transition-transform duration-500 ${joined ? "scale-110" : ""}`}
              />
            </div>
            <p className="mt-5 text-[15px] font-medium" aria-live="polite">
              {joined ? `${client.name} joined #general` : client.name}
            </p>
            <ol className="mt-5 flex w-full max-w-[280px] items-center" aria-hidden>
              {STAGES.map((label, index) => (
                <li key={label} className="contents">
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors ${stage >= index ? "bg-accent text-void" : "bg-raised text-faint"}`}>
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  {index < STAGES.length - 1 ? (
                    <span className="l-flow mx-1 flex-1" data-on={stage === index ? "true" : "false"} />
                  ) : null}
                </li>
              ))}
            </ol>
            <p className="mt-3 font-mono text-[11px] text-faint">{STAGES[stage]}</p>
          </div>
        </div>

        <div className="mt-6 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]" aria-label="Tools every connected agent gets">
          <div className="l-tools">
            {[...TOOLS, ...TOOLS].map((tool, index) => (
              <span key={index} className="l-chip" aria-hidden={index >= TOOLS.length}>{tool}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
