"use client"

import { useState } from "react"
import { startComputerAction, stopComputerAction } from "@/lib/actions/computers"

export interface ComputerInfo {
  agentId: string
  handle: string
  displayName: string
  status: "none" | "starting" | "running" | "stopped" | "error"
  profile: "standard" | "browser"
  lastActiveAt?: string | null
}

interface Props {
  orgSlug: string
  computers: ComputerInfo[]
}

export function ComputerPanel({ orgSlug, computers }: Props) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(computers[0]?.agentId || "")
  const [activeTab, setActiveTab] = useState<"logs" | "files" | "browser">("logs")
  const [loading, setLoading] = useState(false)

  const current = computers.find((c) => c.agentId === selectedAgentId) || computers[0]

  async function handleToggleStatus() {
    if (!current) return
    setLoading(true)
    const formData = new FormData()
    formData.append("orgSlug", orgSlug)
    formData.append("agentId", current.agentId)

    try {
      if (current.status === "running") {
        await stopComputerAction(null, formData)
      } else {
        await startComputerAction(null, formData)
      }
    } finally {
      setLoading(false)
    }
  }

  if (computers.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
        <p className="text-sm">No bot in this room has a persistent computer enabled.</p>
        <p className="text-xs mt-1">
          Enable Persistent Computer under agent capabilities to watch your bot work.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background border-l border-border">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium outline-none"
          >
            {computers.map((c) => (
              <option key={c.agentId} value={c.agentId}>
                @{c.handle} ({c.displayName})
              </option>
            ))}
          </select>

          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono ${
              current?.status === "running"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : current?.status === "starting"
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                current?.status === "running"
                  ? "bg-emerald-500 animate-pulse"
                  : current?.status === "starting"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-muted-foreground"
              }`}
            />
            {current?.status || "stopped"}
          </span>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={handleToggleStatus}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
            current?.status === "running"
              ? "border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
        >
          {loading ? "..." : current?.status === "running" ? "Stop Computer" : "Start Computer"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-3 pt-2 border-b border-border text-xs font-medium text-muted-foreground">
        <button
          type="button"
          onClick={() => setActiveTab("logs")}
          className={`pb-2 px-2 border-b-2 transition-colors ${
            activeTab === "logs"
              ? "border-primary text-foreground"
              : "border-transparent hover:text-foreground"
          }`}
        >
          Shell & Logs
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("files")}
          className={`pb-2 px-2 border-b-2 transition-colors ${
            activeTab === "files"
              ? "border-primary text-foreground"
              : "border-transparent hover:text-foreground"
          }`}
        >
          Files (/home/bot)
        </button>
        {current?.profile === "browser" && (
          <button
            type="button"
            onClick={() => setActiveTab("browser")}
            className={`pb-2 px-2 border-b-2 transition-colors ${
              activeTab === "browser"
                ? "border-primary text-foreground"
                : "border-transparent hover:text-foreground"
            }`}
          >
            Browser Screencast
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "logs" && (
          <div className="h-full rounded-xl bg-card border border-border p-3 font-mono text-xs text-foreground overflow-auto">
            <div className="text-muted-foreground text-[11px] mb-2">
              # Container initialized with gVisor sandbox. Proxy: egress:8080.
            </div>
            {current?.status === "running" ? (
              <div className="text-emerald-500">$ agentd ready on /run/agentd.sock</div>
            ) : (
              <div className="text-muted-foreground">
                Computer is stopped. Start it to run shell commands or view real-time logs.
              </div>
            )}
          </div>
        )}

        {activeTab === "files" && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Persistent files mounted at /home/bot
            </div>
            <div className="p-3 bg-card border border-border rounded-xl text-xs space-y-1">
              <div className="flex items-center justify-between py-1 border-b border-border">
                <span className="font-mono">.saaya/env</span>
                <span className="text-[11px] text-faint">Config</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="font-mono">workspace/</span>
                <span className="text-[11px] text-faint">Directory</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === "browser" && (
          <div className="h-full flex flex-col items-center justify-center p-6 border border-border rounded-xl bg-card text-center">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-2">
              🌐
            </div>
            <h4 className="text-sm font-medium text-foreground">Playwright Chromium Automation</h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              When @{current?.handle} executes browser tools, page snapshots and screenshots will
              stream here live.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
