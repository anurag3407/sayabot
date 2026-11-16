import type { CSSProperties } from "react"
import { Reveal } from "./reveal"
import { Saya } from "./saya"

type Tool = { name: string; mark: string; color: string }

/** Connectors and channels Sayabot ships, plus anything that speaks MCP. */
const ROWS: Tool[][] = [
  [
    { name: "GitHub", mark: "GH", color: "#e6e6e6" },
    { name: "Slack", mark: "Sl", color: "#e8a3ff" },
    { name: "Google Drive", mark: "Dr", color: "#7fb3ff" },
    { name: "Notion", mark: "N", color: "#f2f2f2" },
    { name: "Linear", mark: "Li", color: "#a8a3ff" },
    { name: "Jira", mark: "Ji", color: "#6aa8ff" },
    { name: "Stripe", mark: "St", color: "#9d8cff" },
  ],
  [
    { name: "Sentry", mark: "Se", color: "#c9a6ff" },
    { name: "Discord", mark: "Di", color: "#8c9bff" },
    { name: "Telegram", mark: "Tg", color: "#6cc6ff" },
    { name: "WhatsApp", mark: "Wa", color: "#78dc8c" },
    { name: "Vercel", mark: "Ve", color: "#f2f2f2" },
    { name: "Supabase", mark: "Sb", color: "#6fdca2" },
    { name: "Cloudflare", mark: "Cf", color: "#ffad5c" },
  ],
  [
    { name: "1Password", mark: "1P", color: "#7fb3ff" },
    { name: "Bitwarden", mark: "Bw", color: "#7f9cff" },
    { name: "Proton Pass", mark: "Pp", color: "#b49cff" },
    { name: "Shell & git", mark: "$_", color: "#ffb547" },
    { name: "Any MCP server", mark: "+", color: "#9d8cff" },
    { name: "Your own API", mark: "{}", color: "#e6e6e6" },
    { name: "Cron schedules", mark: "Cr", color: "#8bd46e" },
  ],
]

const CLIS = [
  "Claude Code",
  "Codex",
  "Cursor",
  "Gemini CLI",
  "Hermes",
  "OpenCode",
  "Qwen Code",
  "Copilot",
  "ChatGPT",
]

export function Tools() {
  return (
    <section className="section tools" aria-labelledby="tools-title">
      <div className="wrap head-center">
        <Reveal>
          <h2 className="h2 tools-title" id="tools-title">
            <span className="tools-pill">
              <Saya shape="block" follow className="tools-pill-face" />
              Agents
            </span>{" "}
            work with your tools.
          </h2>
          <p className="lede">
            Connect an app once for the whole workspace, then grant each agent exactly what it may
            touch. Read-only by default.
          </p>
        </Reveal>
      </div>

      <div className="tools-wall" aria-label="Supported tools">
        {ROWS.map((row, rowIndex) => (
          <div key={rowIndex} className="tools-row" style={{ "--r": rowIndex } as CSSProperties}>
            {row.map((tool) => (
              <div key={tool.name} className="tool">
                <span className="tool-mark" style={{ color: tool.color }}>
                  {tool.mark}
                </span>
                <span className="tool-name">{tool.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="wrap">
        <p className="tools-cli-label">
          …and bring the agents you already pay for, over one MCP invite link
        </p>
      </div>
      <div className="marquee" aria-label="Agent clients that can join">
        <div className="marquee-track">
          {[...CLIS, ...CLIS].map((name, index) => (
            <span
              key={`${name}-${index}`}
              className="marquee-item"
              aria-hidden={index >= CLIS.length}
            >
              <span className="marquee-dot" />
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
