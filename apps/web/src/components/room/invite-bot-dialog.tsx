"use client"

import { useState } from "react"
import { createRoomBotKey } from "@/lib/actions/invites"

interface Props {
  orgSlug: string
  roomId: string
  roomName: string
}

const CLIENTS = [
  { id: "claude-code", label: "Claude Code", desc: "Anthropic's terminal agent" },
  { id: "cursor", label: "Cursor", desc: "AI code editor (.cursor/mcp.json)" },
  { id: "claude", label: "Claude Desktop", desc: "Desktop app with MCP connectors" },
  { id: "codex", label: "Codex CLI", desc: "OpenAI developer CLI" },
  { id: "antigravity", label: "Gemini / Antigravity", desc: "Google agent platform" },
  { id: "hermes", label: "Hermes", desc: "Autonomous background loop bot" },
] as const

export function InviteBotDialog({ orgSlug, roomId, roomName }: Props) {
  const [open, setOpen] = useState(false)
  const [selectedClient, setSelectedClient] = useState<string>("claude-code")
  const [handle, setHandle] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    apiKey?: string
    connectionUrl?: string
    snippet?: string
    handle?: string
  } | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleGenerate() {
    setLoading(true)
    const formData = new FormData()
    formData.append("orgSlug", orgSlug)
    formData.append("roomId", roomId)
    formData.append("client", selectedClient)
    if (handle) formData.append("handle", handle)

    try {
      const res = await createRoomBotKey(null, formData)
      if (res.ok && res.data) {
        setResult(res.data as any)
      }
    } finally {
      setLoading(false)
    }
  }

  function handleCopy() {
    if (!result?.snippet) return
    navigator.clipboard.writeText(result.snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setResult(null)
        }}
        className="inline-flex h-11 items-center gap-1.5 rounded-sm px-3 text-[13px] text-muted transition-colors hover:bg-raised hover:text-text md:h-9"
      >
        <span>+ Invite Bot</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <h2 className="text-base font-semibold text-foreground">Invite Outside Bot to #{roomName}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  One pasted command lets any local or external agent join this room.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-mono px-2"
              >
                ✕
              </button>
            </div>

            {!result ? (
              <div className="py-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-2">Select Agent Platform</label>
                  <div className="grid grid-cols-2 gap-2">
                    {CLIENTS.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => setSelectedClient(c.id)}
                        className={`p-3 rounded-xl border cursor-pointer text-left transition-all ${
                          selectedClient === c.id
                            ? "border-primary bg-primary/5 shadow-xs"
                            : "border-border bg-background hover:border-muted-foreground/30"
                        }`}
                      >
                        <div className="text-xs font-semibold text-foreground">{c.label}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{c.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Bot Handle (Optional)
                  </label>
                  <div className="flex items-center rounded-lg border border-border bg-background px-3 py-1.5 focus-within:ring-1 focus-within:ring-primary">
                    <span className="text-muted-foreground text-sm select-none">@</span>
                    <input
                      type="text"
                      value={handle}
                      onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                      placeholder={selectedClient.replace(/_/g, "-")}
                      className="w-full bg-transparent px-1 text-sm outline-none"
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleGenerate}
                    className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium text-xs hover:opacity-90 disabled:opacity-50"
                  >
                    {loading ? "Generating..." : "Generate Connection Command"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-4 space-y-4">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-600 dark:text-emerald-400">
                  Bot registered as <strong className="font-semibold">@{result.handle}</strong> with a room-scoped key.
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground">Run this in your terminal:</span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="text-xs text-primary font-medium hover:underline"
                    >
                      {copied ? "Copied!" : "Copy Command"}
                    </button>
                  </div>
                  <pre className="p-3 rounded-lg bg-muted font-mono text-xs text-foreground overflow-x-auto whitespace-pre-wrap break-all">
                    {result.snippet}
                  </pre>
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Once started, the bot will join this room, respond when mentioned with @{result.handle}, and can claim tasks from the task board.
                </p>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium text-xs hover:opacity-90"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
