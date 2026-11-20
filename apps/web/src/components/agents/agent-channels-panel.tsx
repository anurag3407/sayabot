"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * The agent's own chat accounts. One bot token per agent per platform: a token is an identity, so
 * sharing one between two agents would make every DM ambiguous. Connecting a Telegram bot points
 * its webhook at this deployment; a Discord bot is picked up by the orchestrator's socket loop.
 */

interface Channel {
  id: string
  source: "telegram" | "discord"
  name: string
  status: string
  last4: string
  config: { allowedChats?: string[]; allowedUserIds?: string[] }
  lastSeenAt: string | null
  lastError: string | null
  webhookUrl: string | null
  boundChatId?: string | null
}

const SOURCES = [
  { id: "telegram", label: "Telegram", hint: "Bot token from @BotFather, e.g. 123456789:AA…" },
  { id: "discord", label: "Discord", hint: "Bot token from the Discord developer portal" },
] as const

export function AgentChannelsPanel({
  orgSlug,
  agentId,
  canEdit,
}: {
  orgSlug: string
  agentId: string
  canEdit: boolean
}) {
  const base = `/api/workspaces/${orgSlug}/agents/${agentId}/channels`
  const [channels, setChannels] = useState<Channel[]>([])
  const [source, setSource] = useState<"telegram" | "discord">("telegram")
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store" })
    if (!response.ok) return
    const body = (await response.json()) as { channels?: Channel[] }
    setChannels(body.channels ?? [])
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  async function connect() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, token: token.trim() }),
      })
      const body = (await response.json().catch(() => null)) as {
        error?: string
        channel?: Channel
      } | null
      if (!response.ok) {
        setError(body?.error ?? "Could not connect this channel")
        return
      }
      setToken("")
      setNotice(`${source === "telegram" ? "Telegram" : "Discord"} connected`)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function disconnect(id: string) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`${base}/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? "Could not disconnect this channel")
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  const hint = SOURCES.find((option) => option.id === source)?.hint ?? ""

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Chat channels</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Give this bot its own Telegram or Discord account. The app and that chat are the same
          conversation: the first message binds it, and any later chat gets a short refusal.
        </p>
      </div>

      <div className="space-y-2">
        {channels.length === 0 ? (
          <p className="text-xs text-faint">No channel connected yet.</p>
        ) : (
          channels.map((channel) => (
            <div
              key={channel.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold capitalize text-foreground">
                    {channel.source}
                  </span>
                  <span className="font-mono text-[10px] text-muted bg-muted px-1.5 py-0.5 rounded">
                    {channel.status}
                  </span>
                  <span className="font-mono text-[10px] text-faint">••••{channel.last4}</span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">{channel.name}</div>
                <div className="text-[10px] text-faint mt-0.5">
                  {channel.boundChatId
                    ? "Bound to one chat. Replies from the app go there too."
                    : "Waiting for the first message. That chat becomes the only one."}
                </div>
                {channel.lastError ? (
                  <div className="text-[11px] text-red-500 mt-0.5">{channel.lastError}</div>
                ) : null}
                {channel.webhookUrl ? (
                  <div className="text-[10px] text-faint font-mono truncate mt-0.5">
                    webhook set
                  </div>
                ) : null}
              </div>
              {canEdit ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void disconnect(channel.id)}
                  className="text-[11px] text-red-500 hover:underline disabled:opacity-50"
                >
                  Disconnect
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>

      {canEdit ? (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex gap-2">
            {SOURCES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSource(option.id)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                  source === option.id
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={hint}
            type="password"
            autoComplete="off"
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || token.trim().length < 10}
              onClick={() => void connect()}
              className="rounded-md bg-foreground px-3 py-1.5 text-[11px] font-semibold text-background disabled:opacity-50"
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
            {error ? <span className="text-[11px] text-red-500">{error}</span> : null}
            {notice ? <span className="text-[11px] text-emerald-500">{notice}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
