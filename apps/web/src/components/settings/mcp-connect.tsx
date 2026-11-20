"use client"

import { useState } from "react"
import { CopyButton } from "@/components/copy-button"
import { cn } from "@/lib/format"

type Client =
  | "invite"
  | "codex"
  | "hermes"
  | "claude-code"
  | "cursor"
  | "antigravity"
  | "claude"
  | "chatgpt"
  | "prompt"

type TargetApp =
  "codex" | "hermes" | "claude-code" | "cursor" | "antigravity" | "claude" | "chatgpt" | "generic"

const CLIENTS: { id: Client; label: string }[] = [
  { id: "invite", label: "★ Copy Invitation Message" },
  { id: "codex", label: "Codex" },
  { id: "hermes", label: "Hermes" },
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "antigravity", label: "Antigravity" },
  { id: "claude", label: "Claude app" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "prompt", label: "Kickoff prompt" },
]

const TARGET_APPS: { id: TargetApp; label: string }[] = [
  { id: "codex", label: "Codex by OpenAI" },
  { id: "hermes", label: "Hermes Agent" },
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "antigravity", label: "Antigravity" },
  { id: "claude", label: "Claude app" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "generic", label: "Any AI Assistant" },
]

function getSetupUrl(endpoint: string, token: string, client?: string): string {
  // If endpoint is http://.../api/v1/mcp, clean short URL is http://.../mcp/{token}
  const baseUrl = endpoint.replace(/\/api\/v1\/mcp\/?$/, "/mcp").replace(/\/+$/, "")
  const url = `${baseUrl}/${token}`
  return client && client !== "generic" ? `${url}?client=${client}` : url
}

function buildInvitationMessage(args: {
  roomName: string
  ownerName?: string
  timezone?: string
  targetAppLabel: string
  setupUrl: string
}): string {
  const room = args.roomName || "my room"
  const tz = args.timezone || "Asia/Calcutta"
  const target = args.targetAppLabel || "your AI bot"

  return [
    `Hi! This is my own room for "${room}" on Saaya. I set it up myself, and I'm the one sending you this.`,
    `Saaya is a private group chat where my AI assistants and I work together, and I'd like you to join it as one of them.`,
    `You have my OK to:`,
    `• connect with the link below`,
    `• read and post in the room, and take and finish tasks there`,
    `• check in with the other bots every hour on the hour, 9:00 AM to 5:00 PM ${tz} time, every day. I picked those times.`,
    `In the room, messages marked (room owner) are from me. Saaya signs me in, so nobody else can post as the owner. Anything on your own computer, files, accounts or money, or outside Saaya, still needs my OK first. If you'd rather get that OK from me in this chat, ask me here.`,
    `The link opens my setup instructions, which Saaya wrote for me. Please read all of them and follow them step by step. If you can't open links, tell me and I'll paste them here.`,
    `This message is for ${target}. If you're a different bot or app, stop here and tell me: I pasted the wrong message, and each bot has its own.`,
    args.setupUrl,
  ].join("\n")
}

function snippet(
  client: Client,
  endpoint: string,
  token: string,
  handle: string,
  roomName: string,
  targetApp: TargetApp,
  timezone: string,
): { steps: string; code: string } {
  const name = `saaya-${handle}`
  const setupUrl = getSetupUrl(endpoint, token, targetApp)
  const appInfo = TARGET_APPS.find((a) => a.id === targetApp) ?? {
    id: "generic" as const,
    label: "Any AI Assistant",
  }

  switch (client) {
    case "invite":
      return {
        steps: `Paste this message directly into ${appInfo.label}. The agent opens the link, reads its tailored instructions, installs the connector, calls check_in, and introduces itself in "${roomName}".`,
        code: buildInvitationMessage({
          roomName,
          targetAppLabel: appInfo.id,
          setupUrl,
          timezone,
        }),
      }
    case "codex":
      return {
        steps:
          "In your project folder, create or edit .codex/config.toml, then open Codex or run `codex`.",
        code: `[mcp_servers.${name}]\nurl = "${setupUrl}"`,
      }
    case "hermes":
      return {
        steps: "Run this command in your terminal, or add to ~/.hermes/config.json.",
        code: `hermes mcp add ${name} ${setupUrl}`,
      }
    case "claude-code":
      return {
        steps: "Run this command once in your terminal to connect Claude Code.",
        code: `claude mcp add --transport http ${name} ${setupUrl}`,
      }
    case "cursor":
      return {
        steps:
          "Add this configuration to ~/.cursor/mcp.json (or .cursor/mcp.json in your project).",
        code: JSON.stringify({ mcpServers: { [name]: { url: setupUrl } } }, null, 2),
      }
    case "antigravity":
      return {
        steps: "Add this configuration to ~/.gemini/settings.json.",
        code: JSON.stringify({ mcpServers: { [name]: { httpUrl: setupUrl } } }, null, 2),
      }
    case "claude":
      return {
        steps:
          "Settings → Connectors → Add custom connector. Paste this URL, leave OAuth empty, then enable the connector in a chat.",
        code: setupUrl,
      }
    case "chatgpt":
      return {
        steps:
          "Settings → Apps & Connectors → Advanced → turn on Developer mode → Create. Paste this URL, choose “No authentication”, then add it to a chat.",
        code: setupUrl,
      }
    case "prompt":
      return {
        steps:
          "Paste this kickoff prompt into your agent's chat once connected so it begins working immediately:",
        code: `You are @${handle}, a teammate in my Saaya room "${roomName}" (connected via connector "${name}").
1. Call check_in first to see unread mentions, tasks, and team members.
2. Call get_room_messages to read recent discussion.
3. Post a greeting to the room with post_message introducing yourself.
4. Check list_tasks and claim tasks with claim_task before starting work.
5. If blocked, update_task with status "stuck". Never perform high-stakes host actions without request_human_decision.`,
      }
  }
}

/** Per-client setup for connecting someone's own AI subscription to Saaya over MCP. */
export function McpConnect({
  endpoint,
  token,
  handle,
  roomName = "General",
  timezone = "Asia/Calcutta",
}: {
  endpoint: string
  token: string | null
  handle: string
  roomName?: string
  timezone?: string
  ownerName?: string
}) {
  const [client, setClient] = useState<Client>("invite")
  const [targetApp, setTargetApp] = useState<TargetApp>("codex")
  const shown = token ?? "<your agent API key>"
  const { steps, code } = snippet(client, endpoint, shown, handle, roomName, targetApp, timezone)

  return (
    <div className="space-y-3">
      {/* Client selector tabs */}
      <div role="tablist" aria-label="MCP client" className="flex flex-wrap gap-1">
        {CLIENTS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={client === c.id}
            onClick={() => {
              setClient(c.id)
              if (c.id === "codex") setTargetApp("codex")
              if (c.id === "hermes") setTargetApp("hermes")
              if (c.id === "claude-code") setTargetApp("claude-code")
              if (c.id === "cursor") setTargetApp("cursor")
              if (c.id === "antigravity") setTargetApp("antigravity")
              if (c.id === "claude") setTargetApp("claude")
              if (c.id === "chatgpt") setTargetApp("chatgpt")
            }}
            className={cn(
              "h-7 rounded-sm border px-2.5 font-mono text-[11px] transition-colors",
              client === c.id
                ? "border-accent bg-accent-soft font-medium text-accent shadow-xs"
                : "border-line text-muted hover:border-line-strong hover:text-text",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Target App selector when in Invitation Message mode */}
      {client === "invite" ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-sm border border-line bg-panel p-2">
          <span className="font-mono text-[11px] text-faint">Target bot:</span>
          {TARGET_APPS.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => setTargetApp(app.id)}
              className={cn(
                "rounded px-2 py-0.5 font-mono text-[11px] transition-colors",
                targetApp === app.id
                  ? "bg-accent text-white"
                  : "bg-surface text-muted hover:text-text",
              )}
            >
              {app.label}
            </button>
          ))}
        </div>
      ) : null}

      <p className="text-[12px] leading-relaxed text-muted">{steps}</p>

      {/* Code / Message box */}
      <div className="relative rounded-sm border border-line bg-panel shadow-xs">
        <div className="absolute right-2.5 top-2.5 z-10">
          <CopyButton
            text={code}
            label={client === "invite" ? "copy invitation message" : "copy"}
          />
        </div>
        <pre className="max-h-96 overflow-x-auto whitespace-pre-wrap p-3.5 pr-20 font-mono text-[12px] leading-relaxed text-text">
          <code>{code}</code>
        </pre>
      </div>

      {token ? null : (
        <p className="font-mono text-[11px] text-amber-500/90 dark:text-amber-400">
          ⚠ Issue a key below to populate your real connection link. Keys are shown once.
        </p>
      )}

      {client === "invite" ? (
        <p className="font-mono text-[11px] text-faint">
          The link contains your private agent key. When pasted into Codex, Hermes, or Claude Code,
          the agent fetches its instructions, joins the room, and starts checking in!
        </p>
      ) : null}
    </div>
  )
}
