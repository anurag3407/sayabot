import type { CSSProperties, ReactNode } from "react"
import { Reveal } from "./reveal"
import { Saya } from "./saya"
import {
  GitHubLogo,
  SlackLogo,
  GoogleDriveLogo,
  NotionLogo,
  LinearLogo,
  JiraLogo,
  StripeLogo,
  SentryLogo,
  DiscordLogo,
  TelegramLogo,
  WhatsAppLogo,
  VercelLogo,
  SupabaseLogo,
  CloudflareLogo,
  OnePasswordLogo,
  BitwardenLogo,
  ProtonPassLogo,
  GitLogo,
  McpLogo,
  ApiLogo,
  CronLogo,
  ClaudeLogo,
  OpenAiLogo,
  CursorLogo,
  GeminiLogo,
  HermesLogo,
  OpenCodeLogo,
  QwenLogo,
  CopilotLogo,
  ChatGptLogo,
} from "./brand-logos"

type Tool = { name: string; icon: ReactNode }

/** Connectors and channels Sayabot ships, plus anything that speaks MCP. */
const ROWS: Tool[][] = [
  [
    { name: "GitHub", icon: <GitHubLogo /> },
    { name: "Slack", icon: <SlackLogo /> },
    { name: "Google Drive", icon: <GoogleDriveLogo /> },
    { name: "Notion", icon: <NotionLogo /> },
    { name: "Linear", icon: <LinearLogo /> },
    { name: "Jira", icon: <JiraLogo /> },
    { name: "Stripe", icon: <StripeLogo /> },
  ],
  [
    { name: "Sentry", icon: <SentryLogo /> },
    { name: "Discord", icon: <DiscordLogo /> },
    { name: "Telegram", icon: <TelegramLogo /> },
    { name: "WhatsApp", icon: <WhatsAppLogo /> },
    { name: "Vercel", icon: <VercelLogo /> },
    { name: "Supabase", icon: <SupabaseLogo /> },
    { name: "Cloudflare", icon: <CloudflareLogo /> },
  ],
  [
    { name: "1Password", icon: <OnePasswordLogo /> },
    { name: "Bitwarden", icon: <BitwardenLogo /> },
    { name: "Proton Pass", icon: <ProtonPassLogo /> },
    { name: "Shell & git", icon: <GitLogo /> },
    { name: "Any MCP server", icon: <McpLogo /> },
    { name: "Your own API", icon: <ApiLogo /> },
    { name: "Cron schedules", icon: <CronLogo /> },
  ],
]

type CliAgent = {
  name: string
  icon: ReactNode
}

const CLIS: CliAgent[] = [
  { name: "Claude Code", icon: <ClaudeLogo /> },
  { name: "Codex", icon: <OpenAiLogo /> },
  { name: "Cursor", icon: <CursorLogo /> },
  { name: "Gemini CLI", icon: <GeminiLogo /> },
  { name: "Hermes", icon: <HermesLogo /> },
  { name: "OpenCode", icon: <OpenCodeLogo /> },
  { name: "Qwen Code", icon: <QwenLogo /> },
  { name: "Copilot", icon: <CopilotLogo /> },
  { name: "ChatGPT", icon: <ChatGptLogo /> },
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
                <span className="tool-mark">
                  {tool.icon}
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
          {[...CLIS, ...CLIS].map((cli, index) => (
            <span
              key={`${cli.name}-${index}`}
              className="marquee-item"
              aria-hidden={index >= CLIS.length}
            >
              <span className="marquee-icon">{cli.icon}</span>
              {cli.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
