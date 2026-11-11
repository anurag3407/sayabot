"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { RefreshCw } from "lucide-react"
import { Mascot } from "@/components/ui/mascot"
import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/format"

export interface StorageCategory {
  id: string
  label: string
  bytes: number
  count: number
  unit: string
  color: string
}

export interface StorageAgentRow {
  id: string
  name: string
  handle: string
  bytes: number
  messages: number
  memories: number
}

export interface StorageRoomRow {
  id: string
  name: string
  bytes: number
  messages: number
  files: number
}

export interface StorageComputer {
  id: string
  name: string
  measuredAt: string | null
  appBytes: number
  agents: Array<{ handle: string; bytes: number; files: number }>
}

function pct(part: number, total: number): string {
  if (!total || !part) return "0%"
  const p = (part / total) * 100
  return p < 0.1 ? "<0.1%" : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-raised" aria-hidden>
      <div className="h-full rounded-full bg-text/70" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%` }} />
    </div>
  )
}

/** OpenBot-style storage: one total, a stacked bar, then what takes the space by agent and by chat. */
export function StorageView({
  measuredAt,
  categories,
  agents,
  rooms,
  computers,
  unavailable,
}: {
  measuredAt: string | null
  categories: StorageCategory[]
  agents: StorageAgentRow[]
  rooms: StorageRoomRow[]
  computers: StorageComputer[]
  unavailable: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const total = categories.reduce((n, c) => n + c.bytes, 0)
  const maxAgent = Math.max(0, ...agents.map((a) => a.bytes))
  const measure = () => startTransition(() => router.refresh())

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[13px] text-muted">This workspace on Sayabot</p>
          <p className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.02em] text-text">{formatBytes(total)}</p>
          <p className="mt-2 text-[13px] text-faint">
            {measuredAt ? `Measured ${new Date(measuredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Not measured yet"}
          </p>
        </div>
        <Button variant="secondary" disabled={pending} onClick={measure}>
          <RefreshCw className={pending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Measure again
        </Button>
      </div>

      {unavailable ? (
        <p className="rounded-xl border border-warn/30 bg-warn/10 p-4 text-[13px] text-muted">
          Storage can&apos;t be measured until the latest database migration runs (pnpm db:migrate).
        </p>
      ) : (
        <div>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-raised" role="img" aria-label="Storage by type">
            {categories.map((c) =>
              c.bytes ? <div key={c.id} style={{ width: `${(c.bytes / (total || 1)) * 100}%`, background: c.color, minWidth: 3 }} /> : null,
            )}
          </div>
          <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((c) => (
              <li key={c.id} className="flex items-baseline gap-2 text-[13px]">
                <span className="h-2.5 w-2.5 shrink-0 translate-y-0.5 rounded-full" style={{ background: c.color }} />
                <span className="text-muted">{c.label}</span>
                <span className="ml-auto font-medium text-text">{formatBytes(c.bytes)}</span>
                <span className="w-12 text-right text-faint">{pct(c.bytes, total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section aria-labelledby="storage-agents">
        <h3 id="storage-agents" className="mb-2 text-[15px] font-medium text-text">
          Agents
        </h3>
        {agents.length === 0 ? (
          <p className="text-[13px] text-faint">No agents yet.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <Mascot seed={a.handle} className="h-9 w-9 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-text">{a.name}</p>
                  <p className="text-[12px] text-faint">
                    {a.messages.toLocaleString()} {a.messages === 1 ? "message" : "messages"} · {a.memories.toLocaleString()}{" "}
                    {a.memories === 1 ? "memory" : "memories"}
                  </p>
                </div>
                <Bar value={a.bytes} max={maxAgent} />
                <div className="w-20 text-right">
                  <p className="text-[13px] text-text">{formatBytes(a.bytes)}</p>
                  <p className="text-[11px] text-faint">{pct(a.bytes, total)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="storage-chats">
        <h3 id="storage-chats" className="mb-2 text-[15px] font-medium text-text">
          Largest chats
        </h3>
        {rooms.length === 0 ? (
          <p className="text-[13px] text-faint">No chats yet.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {rooms.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-text">{r.name}</p>
                  <p className="text-[12px] text-faint">
                    {r.messages.toLocaleString()} messages · {r.files} {r.files === 1 ? "file" : "files"}
                  </p>
                </div>
                <p className="text-[13px] text-text">{formatBytes(r.bytes)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {computers.length ? (
        <section aria-labelledby="storage-computers">
          <h3 id="storage-computers" className="mb-2 text-[15px] font-medium text-text">
            On your computers
          </h3>
          <ul className="space-y-3">
            {computers.map((c) => {
              const agentTotal = c.agents.reduce((n, a) => n + a.bytes, 0)
              return (
                <li key={c.id} className="rounded-xl border border-line bg-panel p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[14px] font-medium text-text">Sayabot on {c.name}</p>
                    <p className="text-[14px] font-semibold text-text">{formatBytes(c.appBytes + agentTotal)}</p>
                  </div>
                  <p className="text-[12px] text-faint">
                    {c.measuredAt ? `Measured ${new Date(c.measuredAt).toLocaleString()}` : "Open the Sayabot app on it to measure"} · app
                    data {formatBytes(c.appBytes)} · agent folders {formatBytes(agentTotal)}
                  </p>
                  {c.agents.length ? (
                    <ul className="mt-2 space-y-1">
                      {c.agents.slice(0, 8).map((a) => (
                        <li key={a.handle} className="flex justify-between text-[12px] text-muted">
                          <span>~/Sayabot/agents/{a.handle}</span>
                          <span>
                            {formatBytes(a.bytes)} · {a.files} files
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
