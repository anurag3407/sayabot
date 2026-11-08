"use client"

import React, { useMemo, useState } from "react"
import Link from "next/link"
import {
  formatMs,
  formatNumber,
  formatPercent,
  formatTokens,
  formatUsd,
} from "@/lib/format"
import { ProviderIcon } from "@/components/room/model-picker/provider-icons"
import { UsageChart, type ChartDataPoint, type ChartSeries } from "./usage-chart"
import { UsageShareBar, type ShareSegment } from "./usage-share-bar"
import { EmptyState } from "@/components/ui/empty"

export interface UsageEventRow {
  agent_id: string | null
  room_id: string | null
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  cached_input_tokens?: number | null
  cost_usd: number | string
  ttft_ms: number | null
  latency_ms: number | null
  created_at: string
}

export interface AgentInfo {
  id: string
  handle: string
  displayName: string
  avatarUrl?: string | null
  role?: string | null
}

export interface RoomInfo {
  id: string
  name: string
}

export interface ModelPricingInfo {
  provider: string
  model: string
  inputPerMtok: number
  outputPerMtok: number
  cacheReadPerMtok?: number | null
}

export const PROVIDER_META: Record<string, { label: string; color: string }> = {
  openai: { label: "OpenAI", color: "#10a37f" },
  anthropic: { label: "Claude Code", color: "#d97706" },
  google: { label: "Google Gemini", color: "#3b82f6" },
  antigravity: { label: "Antigravity", color: "#6366f1" },
  codex: { label: "Codex", color: "#34d399" },
  groq: { label: "Groq", color: "#f43f5e" },
  openrouter: { label: "OpenRouter", color: "#8b5cf6" },
  copilot: { label: "GitHub Copilot", color: "#64748b" },
  deepseek: { label: "DeepSeek", color: "#0ea5e9" },
  cursor: { label: "Cursor", color: "#94a3b8" },
}

const AGENT_COLORS = ["#ff7a45", "#b6a4ff", "#f2c65e", "#7fd3a8", "#ff8fa3", "#9fb3c8"]

function getProviderMeta(provider: string) {
  const norm = provider.toLowerCase().trim()
  return (
    PROVIDER_META[norm] ?? {
      label: provider,
      color: "#65726a",
    }
  )
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index] ?? null
}

export function UsageDashboard({
  initialEvents,
  agents,
  rooms,
  pricing = [],
  orgSlug,
  currentDays = 30,
}: {
  initialEvents: UsageEventRow[]
  agents: AgentInfo[]
  rooms: RoomInfo[]
  pricing?: ModelPricingInfo[]
  orgSlug: string
  currentDays?: number
}) {
  const [metric, setMetric] = useState<"tokens" | "cost" | "perf">("tokens")
  const [chartView, setChartView] = useState<"provider" | "agent">("provider")
  const [providerFilter, setProviderFilter] = useState<string>("all")
  const [agentFilter, setAgentFilter] = useState<string>("all")
  const [breakdownTab, setBreakdownTab] = useState<"model" | "agent" | "room" | "time">("model")

  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const roomsById = useMemo(() => new Map(rooms.map((r) => [r.id, r.name])), [rooms])
  const pricingByModel = useMemo(() => {
    const map = new Map<string, ModelPricingInfo>()
    for (const p of pricing) {
      map.set(`${p.provider.toLowerCase()}:${p.model.toLowerCase()}`, p)
      map.set(p.model.toLowerCase(), p)
    }
    return map
  }, [pricing])

  // Filter events
  const filteredEvents = useMemo(() => {
    return initialEvents.filter((ev) => {
      if (providerFilter !== "all" && ev.provider.toLowerCase() !== providerFilter.toLowerCase()) {
        return false
      }
      if (agentFilter !== "all" && ev.agent_id !== agentFilter) {
        return false
      }
      return true
    })
  }, [initialEvents, providerFilter, agentFilter])

  // Unique lists for dropdowns
  const availableProviders = useMemo(() => {
    const set = new Set<string>()
    for (const ev of initialEvents) {
      if (ev.provider) set.add(ev.provider.toLowerCase())
    }
    return Array.from(set)
  }, [initialEvents])

  // Aggregated Totals
  const totals = useMemo(() => {
    let input = 0
    let output = 0
    let cachedInput = 0
    let cost = 0
    let cacheSavingsUsd = 0
    const ttfts: number[] = []
    const latencies: number[] = []
    const uniqueRooms = new Set<string>()
    const uniqueAgents = new Set<string>()

    for (const ev of filteredEvents) {
      const inTok = ev.input_tokens || 0
      const outTok = ev.output_tokens || 0
      const cached = Math.min(inTok, ev.cached_input_tokens || 0)
      const c = Number(ev.cost_usd) || 0

      input += inTok
      output += outTok
      cachedInput += cached
      cost += c

      if (ev.room_id) uniqueRooms.add(ev.room_id)
      if (ev.agent_id) uniqueAgents.add(ev.agent_id)
      if (ev.ttft_ms !== null && ev.ttft_ms !== undefined) ttfts.push(ev.ttft_ms)
      if (ev.latency_ms !== null && ev.latency_ms !== undefined) latencies.push(ev.latency_ms)

      // Calculate cache savings
      const priceKey = `${ev.provider.toLowerCase()}:${ev.model.toLowerCase()}`
      const p = pricingByModel.get(priceKey) ?? pricingByModel.get(ev.model.toLowerCase())
      if (p && cached > 0) {
        const fullRate = p.inputPerMtok
        const readRate = p.cacheReadPerMtok ?? p.inputPerMtok * 0.1
        const saved = (cached / 1_000_000) * Math.max(0, fullRate - readRate)
        cacheSavingsUsd += saved
      } else if (cached > 0) {
        // Fallback estimated savings (~80% discount on cached tokens at typical $1.5/Mtok)
        cacheSavingsUsd += (cached / 1_000_000) * 1.2
      }
    }

    const uncachedInput = Math.max(0, input - cachedInput)
    const processedTokens = input + output
    const avgTtft = ttfts.length ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : null
    const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null
    const p95Latency = percentile(latencies, 95)
    const cacheHitRate = input > 0 ? cachedInput / input : 0

    return {
      processed: processedTokens,
      input,
      output,
      cachedInput,
      uncachedInput,
      cost,
      cacheSavingsUsd: Math.round(cacheSavingsUsd * 100) / 100,
      cacheHitRate,
      sessions: filteredEvents.length,
      roomsCount: uniqueRooms.size,
      agentsCount: uniqueAgents.size,
      avgTtft: avgTtft ? Math.round(avgTtft) : null,
      avgLatency: avgLatency ? Math.round(avgLatency) : null,
      p95Latency: p95Latency ? Math.round(p95Latency) : null,
    }
  }, [filteredEvents, pricingByModel])

  // Provider breakdown (Left Hero list)
  const providerBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        provider: string
        tokens: number
        cost: number
        sessions: number
        cachedTokens: number
      }
    >()

    for (const ev of filteredEvents) {
      const p = ev.provider.toLowerCase()
      const inTok = ev.input_tokens || 0
      const outTok = ev.output_tokens || 0
      const c = Number(ev.cost_usd) || 0
      const cached = ev.cached_input_tokens || 0

      const entry = map.get(p) ?? {
        provider: p,
        tokens: 0,
        cost: 0,
        sessions: 0,
        cachedTokens: 0,
      }
      entry.tokens += inTok + outTok
      entry.cost += c
      entry.sessions += 1
      entry.cachedTokens += cached
      map.set(p, entry)
    }

    return Array.from(map.values())
      .map((entry) => {
        const meta = getProviderMeta(entry.provider)
        const tokenShare = totals.processed > 0 ? entry.tokens / totals.processed : 0
        const costShare = totals.cost > 0 ? entry.cost / totals.cost : 0
        return {
          ...entry,
          label: meta.label,
          color: meta.color,
          tokenShare,
          costShare,
        }
      })
      .sort((a, b) => (metric === "cost" ? b.cost - a.cost : b.tokens - a.tokens))
  }, [filteredEvents, totals, metric])

  // Chart Series & Points
  const { chartSeries, chartPoints } = useMemo(() => {
    const isHourly = currentDays === 1
    const seriesList: ChartSeries[] = []

    if (chartView === "provider") {
      const uniqueProv = Array.from(new Set(filteredEvents.map((e) => e.provider.toLowerCase())))
      for (const prov of uniqueProv) {
        const meta = getProviderMeta(prov)
        seriesList.push({ id: prov, label: meta.label, color: meta.color })
      }
    } else {
      // By Agent
      const uniqueAg = Array.from(new Set(filteredEvents.map((e) => e.agent_id ?? "unknown")))
      uniqueAg.forEach((agId, idx) => {
        const agent = agentsById.get(agId)
        const label = agent ? `@${agent.handle}` : "unassigned"
        const color = AGENT_COLORS[idx % AGENT_COLORS.length] ?? "#65726a"
        seriesList.push({ id: agId, label, color })
      })
    }

    if (seriesList.length === 0) {
      seriesList.push({ id: "all", label: "All Activity", color: "#ff7a45" })
    }

    // Build timeline points
    const points: ChartDataPoint[] = []
    const now = Date.now()

    if (isHourly) {
      // 24 hourly buckets
      for (let h = 23; h >= 0; h--) {
        const d = new Date(now - h * 3_600_000)
        const bucketKey = d.toISOString().slice(0, 13) // YYYY-MM-DDTHH
        const periodLabel = d.toLocaleTimeString([], { hour: "numeric" })
        points.push({
          periodKey: bucketKey,
          periodLabel,
          timestampMs: d.getTime(),
          values: {},
          total: 0,
        })
      }
    } else {
      // Daily buckets
      for (let d = currentDays - 1; d >= 0; d--) {
        const date = new Date(now - d * 86_400_000)
        const bucketKey = date.toISOString().slice(0, 10)
        const periodLabel = date.toLocaleDateString([], { month: "short", day: "numeric" })
        points.push({
          periodKey: bucketKey,
          periodLabel,
          timestampMs: date.getTime(),
          values: {},
          total: 0,
        })
      }
    }

    const pointMap = new Map(points.map((p) => [p.periodKey, p]))

    for (const ev of filteredEvents) {
      const key = isHourly ? ev.created_at.slice(0, 13) : ev.created_at.slice(0, 10)
      const pt = pointMap.get(key)
      if (!pt) continue

      const seriesId = chartView === "provider" ? ev.provider.toLowerCase() : (ev.agent_id ?? "unknown")
      const val =
        metric === "cost"
          ? Number(ev.cost_usd) || 0
          : metric === "perf"
            ? ev.latency_ms || 0
            : (ev.input_tokens || 0) + (ev.output_tokens || 0)

      pt.values[seriesId] = (pt.values[seriesId] ?? 0) + val
      pt.total += val
    }

    return { chartSeries: seriesList, chartPoints: points }
  }, [filteredEvents, chartView, currentDays, metric, agentsById])

  // Token Types for ShareBar
  const tokenTypeSegments: ShareSegment[] = useMemo(() => {
    return [
      { label: "Uncached Input", value: totals.uncachedInput, color: "#8fbf9f" },
      { label: "Cache Read", value: totals.cachedInput, color: "#b6a4ff" },
      { label: "Output", value: totals.output, color: "#ff7a45" },
    ]
  }, [totals])

  // Breakdown by Model
  const modelBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        model: string
        provider: string
        tokens: number
        cost: number
        runs: number
        cachedTokens: number
      }
    >()

    for (const ev of filteredEvents) {
      const m = ev.model
      const entry = map.get(m) ?? {
        model: m,
        provider: ev.provider,
        tokens: 0,
        cost: 0,
        runs: 0,
        cachedTokens: 0,
      }
      entry.tokens += (ev.input_tokens || 0) + (ev.output_tokens || 0)
      entry.cost += Number(ev.cost_usd) || 0
      entry.runs += 1
      entry.cachedTokens += ev.cached_input_tokens || 0
      map.set(m, entry)
    }

    const list = Array.from(map.values())
    const peakTokens = list.reduce((max, item) => Math.max(max, item.tokens), 0)
    const peakCost = list.reduce((max, item) => Math.max(max, item.cost), 0)

    return list
      .map((item) => {
        const share = totals.processed > 0 ? item.tokens / totals.processed : 0
        const costShare = totals.cost > 0 ? item.cost / totals.cost : 0
        const hitRate = item.tokens > 0 ? item.cachedTokens / item.tokens : 0
        return {
          ...item,
          share,
          costShare,
          hitRate,
          peakRatio:
            metric === "cost"
              ? peakCost > 0
                ? item.cost / peakCost
                : 0
              : peakTokens > 0
                ? item.tokens / peakTokens
                : 0,
        }
      })
      .sort((a, b) => (metric === "cost" ? b.cost - a.cost : b.tokens - a.tokens))
  }, [filteredEvents, totals, metric])

  // Breakdown by Agent
  const agentBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        agentId: string
        tokens: number
        cost: number
        runs: number
        cachedTokens: number
        ttfts: number[]
        latencies: number[]
      }
    >()

    for (const ev of filteredEvents) {
      const id = ev.agent_id ?? "unknown"
      const entry = map.get(id) ?? {
        agentId: id,
        tokens: 0,
        cost: 0,
        runs: 0,
        cachedTokens: 0,
        ttfts: [],
        latencies: [],
      }
      entry.tokens += (ev.input_tokens || 0) + (ev.output_tokens || 0)
      entry.cost += Number(ev.cost_usd) || 0
      entry.runs += 1
      entry.cachedTokens += ev.cached_input_tokens || 0
      if (ev.ttft_ms) entry.ttfts.push(ev.ttft_ms)
      if (ev.latency_ms) entry.latencies.push(ev.latency_ms)
      map.set(id, entry)
    }

    return Array.from(map.values())
      .map((item) => {
        const agent = agentsById.get(item.agentId)
        const avgTtft = item.ttfts.length ? item.ttfts.reduce((a, b) => a + b, 0) / item.ttfts.length : null
        const avgLat = item.latencies.length
          ? item.latencies.reduce((a, b) => a + b, 0) / item.latencies.length
          : null
        return {
          ...item,
          handle: agent ? `@${agent.handle}` : "unassigned",
          displayName: agent?.displayName ?? "Unassigned agent",
          role: agent?.role ?? "",
          share: totals.processed > 0 ? item.tokens / totals.processed : 0,
          avgTtft: avgTtft ? Math.round(avgTtft) : null,
          avgLat: avgLat ? Math.round(avgLat) : null,
        }
      })
      .sort((a, b) => b.tokens - a.tokens)
  }, [filteredEvents, agentsById, totals])

  // Breakdown by Room
  const roomBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        roomId: string
        tokens: number
        cost: number
        runs: number
      }
    >()

    for (const ev of filteredEvents) {
      const id = ev.room_id ?? "unknown"
      const entry = map.get(id) ?? {
        roomId: id,
        tokens: 0,
        cost: 0,
        runs: 0,
      }
      entry.tokens += (ev.input_tokens || 0) + (ev.output_tokens || 0)
      entry.cost += Number(ev.cost_usd) || 0
      entry.runs += 1
      map.set(id, entry)
    }

    return Array.from(map.values())
      .map((item) => {
        const name = roomsById.get(item.roomId) ?? (item.roomId === "unknown" ? "direct" : "private room")
        return {
          ...item,
          name,
          share: totals.processed > 0 ? item.tokens / totals.processed : 0,
        }
      })
      .sort((a, b) => b.tokens - a.tokens)
  }, [filteredEvents, roomsById, totals])

  return (
    <div className="space-y-8">
      {/* Top Header Controls */}
      <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <nav aria-label="Breadcrumb" className="font-mono text-[12px] text-faint">
            <Link href={`/${orgSlug}`} className="hover:text-text">
              workspace
            </Link>{" "}
            / analytics /{" "}
            <span className="text-muted">
              {providerFilter === "all" ? "All providers" : providerFilter}
            </span>
          </nav>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">Token Usage</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Time Window Pills */}
          <div className="flex items-center rounded-lg border border-line bg-panel p-0.5">
            {[
              { days: 1, label: "Past 24h" },
              { days: 7, label: "7 days" },
              { days: 30, label: "30 days" },
              { days: 90, label: "90 days" },
            ].map((option) => (
              <Link
                key={option.days}
                href={`/${orgSlug}/analytics?days=${option.days}`}
                className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                  currentDays === option.days
                    ? "bg-raised text-text shadow-sm"
                    : "text-muted hover:text-text"
                }`}
              >
                {option.label}
              </Link>
            ))}
          </div>

          {/* Metric Switcher */}
          <div className="flex items-center rounded-lg border border-line bg-panel p-0.5">
            {(["tokens", "cost", "perf"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-medium capitalize transition-colors ${
                  metric === m
                    ? "bg-raised text-text shadow-sm"
                    : "text-muted hover:text-text"
                }`}
              >
                {m === "perf" ? "Speed" : m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filter Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 font-mono text-faint">
            <span>Provider:</span>
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="rounded-md border border-line bg-panel px-2 py-1 text-text focus:outline-none"
            >
              <option value="all">All providers</option>
              {availableProviders.map((prov) => (
                <option key={prov} value={prov}>
                  {getProviderMeta(prov).label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 font-mono text-faint">
            <span>Agent:</span>
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="rounded-md border border-line bg-panel px-2 py-1 text-text focus:outline-none"
            >
              <option value="all">All agents</option>
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  @{ag.handle} ({ag.displayName})
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Chart Series Mode Toggle */}
        <div className="flex items-center gap-1 font-mono text-[11px] text-faint">
          <span>Chart by:</span>
          <button
            type="button"
            onClick={() => setChartView("provider")}
            className={`rounded px-1.5 py-0.5 ${
              chartView === "provider" ? "bg-raised text-text" : "text-muted hover:text-text"
            }`}
          >
            Provider
          </button>
          <span>/</span>
          <button
            type="button"
            onClick={() => setChartView("agent")}
            className={`rounded px-1.5 py-0.5 ${
              chartView === "agent" ? "bg-raised text-text" : "text-muted hover:text-text"
            }`}
          >
            Agent
          </button>
        </div>
      </div>

      {filteredEvents.length === 0 ? (
        <EmptyState
          title={`No usage records for the selected period`}
          body="Start conversations with agents or invoke tasks to stream model requests and view token analytics."
        />
      ) : (
        <>
          {/* Top Hero Section: Split Layout (Image match) */}
          <section className="grid gap-8 rounded-xl border border-line bg-panel/40 p-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            {/* Left Column: Big aggregate and ranked providers */}
            <div className="flex min-w-0 flex-col justify-between gap-6">
              <div>
                <div className="font-mono text-4xl font-semibold tracking-tight text-text">
                  {metric === "cost"
                    ? formatUsd(totals.cost)
                    : metric === "perf"
                      ? formatMs(totals.avgTtft)
                      : formatTokens(totals.processed)}
                </div>
                <div className="mt-1 font-mono text-xs text-muted">
                  <span>{formatNumber(totals.sessions)} sessions</span>
                  <span className="text-faint"> · {totals.roomsCount} conversations</span>
                  {metric === "cost" && <span className="text-faint"> · API estimate</span>}
                </div>
              </div>

              {/* Provider Rows */}
              <div className="space-y-3">
                {providerBreakdown.map((p) => {
                  return (
                    <div key={p.provider} className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: p.color }}
                          />
                          <ProviderIcon provider={p.provider} size={14} className="shrink-0 text-muted" />
                          <span className="truncate font-medium text-text">{p.label}</span>
                          <span className="font-mono text-[10px] text-faint">
                            {p.sessions} {p.sessions === 1 ? "session" : "sessions"}
                          </span>
                        </div>
                        <span className="font-mono font-medium text-text">
                          {metric === "cost" ? formatUsd(p.cost) : formatTokens(p.tokens)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pl-6 font-mono text-[11px] text-muted">
                        <span>
                          {formatPercent(p.tokenShare)} of tokens · {formatUsd(p.cost)}
                        </span>
                        {p.cachedTokens > 0 && (
                          <span className="text-[10px] text-ok">
                            {formatTokens(p.cachedTokens)} cached
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Right Column: Hourly / Daily Spline Curve Chart */}
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-muted">
                  {currentDays === 1 ? "Hourly" : "Daily"}{" "}
                  {metric === "cost"
                    ? "estimated cost"
                    : metric === "perf"
                      ? "latency trends"
                      : "processed tokens"}
                </h2>
                <span className="font-mono text-[11px] text-faint">
                  {chartView === "provider" ? "Layered by provider" : "Layered by agent"}
                </span>
              </div>
              <div className="h-[230px] w-full">
                <UsageChart points={chartPoints} series={chartSeries} metric={metric} />
              </div>
            </div>
          </section>

          {/* Totals Section: 5 Metric Cards (Matching Screenshot) */}
          <section className="space-y-2">
            <h2 className="text-xs font-semibold tracking-wider text-faint uppercase">Totals</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <div className="rounded-lg border border-line bg-panel p-3.5">
                <div className="font-mono text-[11px] text-faint">Processed tokens</div>
                <div className="mt-1 font-mono text-xl font-semibold text-text">
                  {formatTokens(totals.processed)}
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted">Total in & out</div>
              </div>

              <div className="rounded-lg border border-line bg-panel p-3.5">
                <div className="font-mono text-[11px] text-faint">Cached input</div>
                <div className="mt-1 font-mono text-xl font-semibold text-text">
                  {formatTokens(totals.cachedInput)}
                </div>
                <div className="mt-1 font-mono text-[10px] text-ok">
                  {formatPercent(totals.cacheHitRate)} hit rate
                </div>
              </div>

              <div className="rounded-lg border border-line bg-panel p-3.5">
                <div className="font-mono text-[11px] text-faint">Uncached input</div>
                <div className="mt-1 font-mono text-xl font-semibold text-text">
                  {formatTokens(totals.uncachedInput)}
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted">Fresh context</div>
              </div>

              <div className="rounded-lg border border-line bg-panel p-3.5">
                <div className="font-mono text-[11px] text-faint">Output</div>
                <div className="mt-1 font-mono text-xl font-semibold text-text">
                  {formatTokens(totals.output)}
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted">Generated tokens</div>
              </div>

              <div className="rounded-lg border border-line bg-panel p-3.5">
                <div className="font-mono text-[11px] text-faint">Cache savings</div>
                <div className="mt-1 font-mono text-xl font-semibold text-accent">
                  {formatUsd(totals.cacheSavingsUsd)}
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted">From prompt caching</div>
              </div>
            </div>
          </section>

          {/* Tokens By Type Share Bar */}
          <section className="rounded-lg border border-line bg-panel/30 p-4">
            <UsageShareBar
              label="Tokens by type"
              segments={tokenTypeSegments}
              format={formatTokens}
              aside={
                <div className="font-mono text-xs text-muted">
                  <span className="text-ok font-medium">{formatPercent(totals.cacheHitRate)}</span> cache efficiency
                </div>
              }
            />
          </section>

          {/* Sayabot Performance & Speed Stats (Bonus Detail) */}
          <section className="rounded-lg border border-line bg-panel/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-accent" />
                <span className="text-faint">Avg TTFT:</span>
                <span className="font-semibold text-text">{formatMs(totals.avgTtft)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-ok" />
                <span className="text-faint">Avg Latency:</span>
                <span className="font-semibold text-text">{formatMs(totals.avgLatency)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-warn" />
                <span className="text-faint">P95 Latency:</span>
                <span className="font-semibold text-text">{formatMs(totals.p95Latency)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-pixel" />
                <span className="text-faint">Active Agents:</span>
                <span className="font-semibold text-text">{totals.agentsCount}</span>
              </div>
            </div>
          </section>

          {/* Breakdown Section: Model / Agent / Room / Time Tabs */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <h2 className="text-sm font-semibold tracking-tight text-text">Breakdown</h2>
              <div className="flex items-center rounded-lg border border-line bg-panel p-0.5">
                {(["model", "agent", "room", "time"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setBreakdownTab(tab)}
                    className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-medium capitalize transition-colors ${
                      breakdownTab === tab
                        ? "bg-raised text-text shadow-sm"
                        : "text-muted hover:text-text"
                    }`}
                  >
                    {tab === "time" ? (currentDays === 1 ? "Hour" : "Day") : tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Model Breakdown Table (Image Match with Colored Proportional Bars) */}
            {breakdownTab === "model" && (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-line text-faint">
                      <th className="py-2.5 pr-3 pl-2 font-normal">#</th>
                      <th className="w-full py-2.5 font-normal">Model</th>
                      <th className="py-2.5 pr-6 text-right font-normal">Cost</th>
                      <th className="py-2.5 pr-6 text-right font-normal">Share</th>
                      <th className="py-2.5 pr-6 text-right font-normal">Cache Hit</th>
                      <th className="py-2.5 pr-2 text-right font-normal">Tokens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {modelBreakdown.map((row, idx) => {
                      const meta = getProviderMeta(row.provider)
                      return (
                        <tr key={row.model} className="hover:bg-raised/40 transition-colors">
                          <td className="py-2.5 pr-3 pl-2 text-faint">{idx + 1}</td>
                          <td className="py-2.5 pr-4">
                            <div className="flex items-center gap-2">
                              <ProviderIcon provider={row.provider} size={13} className="text-muted" />
                              <span className="font-sans font-medium text-text">{row.model}</span>
                            </div>
                            {/* Peak proportional mini-bar matching t3code image */}
                            <div className="mt-1 h-0.5 max-w-44 rounded-full bg-line">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${Math.max(4, Math.round(row.peakRatio * 100))}%`,
                                  backgroundColor: meta.color,
                                }}
                              />
                            </div>
                          </td>
                          <td className="py-2.5 pr-6 text-right font-medium text-text">
                            {row.cost > 0 ? formatUsd(row.cost) : <span className="text-faint">Unpriced</span>}
                          </td>
                          <td className="py-2.5 pr-6 text-right text-muted">
                            {formatPercent(metric === "cost" ? row.costShare : row.share)}
                          </td>
                          <td className="py-2.5 pr-6 text-right text-ok">
                            {row.hitRate > 0 ? formatPercent(row.hitRate) : "-"}
                          </td>
                          <td className="py-2.5 pr-2 text-right font-semibold text-text">
                            {formatTokens(row.tokens)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Agent Breakdown Table (Sayabot Special Detail) */}
            {breakdownTab === "agent" && (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-line text-faint">
                      <th className="py-2.5 pr-3 pl-2 font-normal">#</th>
                      <th className="w-full py-2.5 font-normal">Agent</th>
                      <th className="py-2.5 pr-6 text-right font-normal">Runs</th>
                      <th className="py-2.5 pr-6 text-right font-normal">Cost</th>
                      <th className="py-2.5 pr-6 text-right font-normal">Share</th>
                      <th className="py-2.5 pr-6 text-right font-normal">Avg TTFT</th>
                      <th className="py-2.5 pr-2 text-right font-normal">Tokens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {agentBreakdown.map((row, idx) => (
                      <tr key={row.agentId} className="hover:bg-raised/40 transition-colors">
                        <td className="py-2.5 pr-3 pl-2 text-faint">{idx + 1}</td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="font-sans font-medium text-accent">{row.handle}</span>
                            <span className="text-faint">· {row.displayName}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-6 text-right text-muted">{row.runs}</td>
                        <td className="py-2.5 pr-6 text-right font-medium text-text">
                          {formatUsd(row.cost)}
                        </td>
                        <td className="py-2.5 pr-6 text-right text-muted">{formatPercent(row.share)}</td>
                        <td className="py-2.5 pr-6 text-right text-muted">{formatMs(row.avgTtft)}</td>
                        <td className="py-2.5 pr-2 text-right font-semibold text-text">
                          {formatTokens(row.tokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Room Breakdown Table */}
            {breakdownTab === "room" && (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-line text-faint">
                      <th className="py-2.5 pr-3 pl-2 font-normal">#</th>
                      <th className="w-full py-2.5 font-normal">Room / Conversation</th>
                      <th className="py-2.5 pr-6 text-right font-normal">Runs</th>
                      <th className="py-2.5 pr-6 text-right font-normal">Cost</th>
                      <th className="py-2.5 pr-6 text-right font-normal">Share</th>
                      <th className="py-2.5 pr-2 text-right font-normal">Tokens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {roomBreakdown.map((row, idx) => (
                      <tr key={row.roomId} className="hover:bg-raised/40 transition-colors">
                        <td className="py-2.5 pr-3 pl-2 text-faint">{idx + 1}</td>
                        <td className="py-2.5 pr-4 font-sans font-medium text-text">{row.name}</td>
                        <td className="py-2.5 pr-6 text-right text-muted">{row.runs}</td>
                        <td className="py-2.5 pr-6 text-right font-medium text-text">
                          {formatUsd(row.cost)}
                        </td>
                        <td className="py-2.5 pr-6 text-right text-muted">{formatPercent(row.share)}</td>
                        <td className="py-2.5 pr-2 text-right font-semibold text-text">
                          {formatTokens(row.tokens)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Time Breakdown Table */}
            {breakdownTab === "time" && (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-line text-faint">
                      <th className="py-2.5 pr-4 pl-2 font-normal">Period</th>
                      <th className="w-full py-2.5 font-normal">Activity</th>
                      <th className="py-2.5 pr-2 text-right font-normal">Tokens / Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {chartPoints
                      .slice()
                      .reverse()
                      .map((pt) => (
                        <tr key={pt.periodKey} className="hover:bg-raised/40 transition-colors">
                          <td className="py-2.5 pr-4 pl-2 text-muted">{pt.periodLabel}</td>
                          <td className="py-2.5 pr-4 text-faint">
                            {Object.entries(pt.values)
                              .filter(([, v]) => v > 0)
                              .map(([k, v]) => `${k}: ${metric === "cost" ? formatUsd(v) : formatTokens(v)}`)
                              .join(" · ") || "No usage"}
                          </td>
                          <td className="py-2.5 pr-2 text-right font-semibold text-text">
                            {metric === "cost" ? formatUsd(pt.total) : formatTokens(pt.total)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
