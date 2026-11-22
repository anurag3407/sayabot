"use client"

import { useState, useTransition } from "react"
import { ExternalLink, Key, CheckCircle2, AlertCircle, Loader2, Play } from "lucide-react"
import { BrandLogo } from "@/components/connectors/brand-logo"
import { saveWorkspaceConnector } from "@/lib/actions/connectors"
import { sendMessage } from "@/lib/actions/messages"
import { cn } from "@/lib/format"
import { showToast } from "@/components/ui/toast"

export interface ConnectorSuggestion {
  source: string
  name: string
  reason: string
  app?: string
}

const CONNECTOR_METAS: Record<
  string,
  {
    tokenLabel: string
    placeholder: string
    helpUrl?: string
    helpText: string
    features: string[]
  }
> = {
  github: {
    tokenLabel: "GitHub Personal Access Token",
    placeholder: "ghp_... or github_pat_...",
    helpUrl: "https://github.com/settings/tokens",
    helpText: "github.com → Settings → Developer settings → Personal access tokens (`repo` scope).",
    features: ["Codebase symbol search", "Pull requests & code reviews", "Issue discussion & files"],
  },
  google_drive: {
    tokenLabel: "Google OAuth / Service Token",
    placeholder: "ya29.a0A... or Service Account Access Token",
    helpUrl: "https://console.cloud.google.com/apis/credentials",
    helpText: "Google Cloud Console → OAuth 2.0 Client or Service Account with drive.readonly scope.",
    features: ["Search Google Drive files", "Read Google Docs & Sheets (CSV)", "Presentation slides"],
  },
  slack: {
    tokenLabel: "Slack Bot User OAuth Token",
    placeholder: "xoxb-...",
    helpUrl: "https://api.slack.com/apps",
    helpText: "api.slack.com/apps → OAuth & Permissions → Bot User OAuth Token (`channels:read`, `channels:history`).",
    features: ["Channel message history", "Thread discussions & replies", "Team member lookup"],
  },
  composio: {
    tokenLabel: "Composio API Key",
    placeholder: "comp_... or your project API key",
    helpUrl: "https://app.composio.dev/settings",
    helpText: "app.composio.dev → Settings → API Keys. Gives agents access to Gmail, Calendar, Notion, Linear & 1000+ apps.",
    features: ["Gmail & Google Calendar", "Notion & Linear integration", "1000+ business apps"],
  },
  jira: {
    tokenLabel: "Atlassian API Token",
    placeholder: "ATATT3xF...",
    helpUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    helpText: "id.atlassian.com → Security → API tokens. Allows searching issues, sprints, and tickets.",
    features: ["Jira issues & sprint tracking", "Backlog search", "Project management"],
  },
  discord: {
    tokenLabel: "Discord Bot Token",
    placeholder: "MTE4…",
    helpUrl: "https://discord.com/developers/applications",
    helpText: "discord.com/developers → New Application → Bot → Reset Token.",
    features: ["Channel reading", "Post with approval", "Server interactions"],
  },
  telegram: {
    tokenLabel: "Telegram Bot Token",
    placeholder: "123456789:ABC…",
    helpUrl: "https://t.me/BotFather",
    helpText: "Message @BotFather in Telegram and send /newbot.",
    features: ["Read incoming chats", "Reply as bot with approval", "Channel announcements"],
  },
  whatsapp: {
    tokenLabel: "WhatsApp Cloud API Token",
    placeholder: "EAAG…",
    helpUrl: "https://developers.facebook.com",
    helpText: "Meta for Developers → your app → WhatsApp → API setup.",
    features: ["Business messaging", "Template broadcasts", "Direct communication"],
  },
  onepassword: {
    tokenLabel: "1Password Connect Token",
    placeholder: "ops_…",
    helpUrl: "https://developer.1password.com",
    helpText: "1Password Connect Server or service account token.",
    features: ["Search item titles", "Audited secret reads", "Zero plaintext leaks"],
  },
  bitwarden: {
    tokenLabel: "Bitwarden Access Token",
    placeholder: "0.…",
    helpUrl: "https://bitwarden.com/help",
    helpText: "Bitwarden Secrets Manager access token.",
    features: ["Vault item lookup", "Secure secret resolution", "Audited retrieval"],
  },
}

export function ConnectorSuggestionCard({
  suggestion,
  orgSlug,
  roomId,
  agentId,
  onTaskResumed,
}: {
  suggestion: ConnectorSuggestion
  orgSlug: string
  roomId?: string
  agentId?: string
  onTaskResumed?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [token, setToken] = useState("")
  const [phoneNumberId, setPhoneNumberId] = useState("")
  const [projectUrl, setProjectUrl] = useState("")
  const [connectUrl, setConnectUrl] = useState("")
  const [onComputer, setOnComputer] = useState(false)
  const [status, setStatus] = useState<"idle" | "connected" | "error">("idle")
  const [detailMessage, setDetailMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isResuming, startResumeTransition] = useTransition()
  const [resumed, setResumed] = useState(false)

  const { source, name, reason, app } = suggestion
  const meta = CONNECTOR_METAS[source] ?? {
    tokenLabel: `${name} Access Token / API Key`,
    placeholder: "Enter token or API key...",
    helpText: `Paste your ${name} API key or access token.`,
    features: ["Native agent tools", "Secure AES-256-GCM envelope", "Audited executions"],
  }

  const displayName = app ? `${name} (${app.charAt(0).toUpperCase() + app.slice(1)})` : name

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    if (!token.trim() && !onComputer) return

    setErrorMessage(null)
    startTransition(async () => {
      const formData = new FormData()
      formData.set("orgSlug", orgSlug)
      formData.set("source", source)
      formData.set("name", displayName)
      formData.set("token", token.trim() || (onComputer ? "desktop" : ""))
      if (agentId) {
        formData.set("grantToAgentId", agentId)
      }
      if (source === "whatsapp" && phoneNumberId.trim()) {
        formData.set("phoneNumberId", phoneNumberId.trim())
      }
      if (source === "supabase" && projectUrl.trim()) {
        formData.set("projectUrl", projectUrl.trim())
      }
      if (source === "onepassword") {
        if (onComputer) {
          formData.set("onComputer", "on")
        } else if (connectUrl.trim()) {
          formData.set("connectUrl", connectUrl.trim())
        }
      }

      const res = await saveWorkspaceConnector(null, formData)
      if (res.ok) {
        setStatus("connected")
        setDetailMessage(res.message || `${displayName} successfully connected`)
        showToast({ tone: "success", message: `Connected to ${displayName}!` })
      } else {
        setStatus("error")
        setErrorMessage(res.error || "Connection failed. Please check your credentials.")
      }
    })
  }

  function handleResume() {
    if (onTaskResumed) {
      onTaskResumed()
      return
    }
    if (roomId) {
      startResumeTransition(async () => {
        const res = await sendMessage({
          orgSlug,
          roomId,
          content: `I have connected ${displayName}. Please proceed with the task.`,
        })
        if (res.ok) {
          const warning =
            (res as { warning?: string }).warning ??
            (res.data as { warning?: string } | undefined)?.warning
          if (warning) {
            showToast({ tone: "warning", message: `Message saved: ${warning}` })
          } else {
            setResumed(true)
            showToast({ tone: "success", message: `Resumed task with ${displayName}!` })
          }
        } else {
          showToast({ tone: "danger", message: res.error || "Failed to resume task" })
        }
      })
    }
  }

  return (
    <div
      data-testid="connector-card"
      data-connector-source={source}
      className={cn(
        "my-3 overflow-hidden rounded-xl border transition-all duration-200",
        status === "connected"
          ? "border-emerald-500/40 bg-emerald-500/[0.04] dark:bg-emerald-950/15"
          : "border-border/80 bg-panel/80 hover:border-line-strong shadow-sm",
      )}
    >
      {/* Top Banner & Vendor Identity */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-black/10">
            <BrandLogo id={source} size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-text text-sm">{displayName}</span>
              {status === "connected" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-400">
                  ● Connection Required
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted leading-relaxed">
              {reason || `Connect ${displayName} to enable tools for this task.`}
            </p>
          </div>
        </div>

        {/* Primary Action Button */}
        {status !== "connected" ? (
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              <Key className="h-3.5 w-3.5" />
              <span>{expanded ? "Cancel" : `Connect ${displayName}`}</span>
            </button>
            <a
              href={`/${orgSlug}/settings/connectors`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-faint transition-colors hover:bg-raised hover:text-text"
              title="Open full connectors settings"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-2 ml-auto">
            {(onTaskResumed || roomId) && !resumed ? (
              <button
                type="button"
                disabled={isResuming}
                onClick={handleResume}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-emerald-500 disabled:opacity-50"
              >
                {isResuming ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current" />
                )}
                <span>{isResuming ? "Resuming…" : "Resume Task"}</span>
              </button>
            ) : resumed ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5" /> Resumed
              </span>
            ) : null}
            <a
              href={`/${orgSlug}/settings/connectors`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-faint transition-colors hover:bg-raised hover:text-text"
            >
              <span>Manage</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>

      {/* Feature Pills */}
      {status !== "connected" && meta.features.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/40 bg-ink/20 px-3.5 py-2 text-2xs text-faint">
          {meta.features.map((feat) => (
            <span key={feat} className="inline-flex items-center gap-1 rounded bg-panel/60 px-2 py-0.5">
              <span className="text-accent">✓</span> {feat}
            </span>
          ))}
        </div>
      ) : null}

      {/* Inline Connection Form (Expandable) */}
      {expanded && status !== "connected" ? (
        <form onSubmit={handleConnect} className="border-t border-border/60 bg-panel/90 p-4 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor={`token-${source}`} className="font-medium text-text">
                {meta.tokenLabel}
              </label>
              {meta.helpUrl ? (
                <a
                  href={meta.helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-2xs text-accent hover:underline"
                >
                  <span>Get token</span>
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              ) : null}
            </div>
            <input
              id={`token-${source}`}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={meta.placeholder}
              required={!onComputer}
              disabled={onComputer}
              className="w-full rounded-lg border border-border bg-ink px-3 py-2 text-xs font-mono text-text placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <p className="text-[11px] text-faint">{meta.helpText}</p>
          </div>

          {source === "whatsapp" ? (
            <div className="space-y-1">
              <label htmlFor={`phone-id-${source}`} className="font-medium text-text text-xs">
                WhatsApp Phone Number ID
              </label>
              <input
                id={`phone-id-${source}`}
                type="text"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder="e.g. 106540352..."
                required
                className="w-full rounded-lg border border-border bg-ink px-3 py-2 text-xs font-mono text-text placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <p className="text-[11px] text-faint">Found in Meta for Developers → WhatsApp → API Setup.</p>
            </div>
          ) : null}

          {source === "supabase" ? (
            <div className="space-y-1">
              <label htmlFor={`project-url-${source}`} className="font-medium text-text text-xs">
                Supabase Project URL
              </label>
              <input
                id={`project-url-${source}`}
                type="url"
                value={projectUrl}
                onChange={(e) => setProjectUrl(e.target.value)}
                placeholder="https://xyzcompany.supabase.co"
                required
                className="w-full rounded-lg border border-border bg-ink px-3 py-2 text-xs font-mono text-text placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          ) : null}

          {source === "onepassword" ? (
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
                <input
                  type="checkbox"
                  checked={onComputer}
                  onChange={(e) => setOnComputer(e.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent"
                />
                <span>Use 1Password app signed in on this computer</span>
              </label>
              {!onComputer ? (
                <div className="space-y-1">
                  <label htmlFor={`connect-url-${source}`} className="font-medium text-text text-xs">
                    1Password Connect Server URL
                  </label>
                  <input
                    id={`connect-url-${source}`}
                    type="url"
                    value={connectUrl}
                    onChange={(e) => setConnectUrl(e.target.value)}
                    placeholder="https://1password-connect.internal"
                    className="w-full rounded-lg border border-border bg-ink px-3 py-2 text-xs font-mono text-text placeholder:text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/[0.08] p-2 text-xs text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-text"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                isPending ||
                (!onComputer && !token.trim()) ||
                (source === "whatsapp" && !phoneNumberId.trim()) ||
                (source === "supabase" && !projectUrl.trim())
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-accent/90 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Key className="h-3.5 w-3.5" />}
              <span>{isPending ? "Connecting..." : "Save & Connect"}</span>
            </button>
          </div>
        </form>
      ) : null}

      {/* Connected Success Message */}
      {status === "connected" && detailMessage ? (
        <div className="border-t border-emerald-500/30 bg-emerald-500/[0.06] px-3.5 py-2 text-xs text-emerald-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{detailMessage}</span>
          </div>
          <span className="font-mono text-2xs text-faint">Encrypted (AES-256-GCM)</span>
        </div>
      ) : null}
    </div>
  )
}
