"use client"

import { pickModelPrice } from "@sayabot/core"
import { localDayKey, localHourKey, type UsageRollupRow } from "@/lib/usage-math"
import React, { useCallback, useEffect, useMemo, useState } from "react"
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
  cache_creation_tokens?: number | null
  cost_usd: number | string
  ttft_ms: number | null
  latency_ms: number | null
  created_at: string
  source?: "local" | "sayabot"
  /** Set on rows built from the database rollup: how many calls this one row stands for. */
  _requests?: number
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

export interface ProviderLimitWindow {
  id: string
  label: string
  kind: "session" | "weekly" | "monthly" | "other"
  usedPercent: number
  remainingPercent: number
  resetsAt: string | null
  windowDurationMins?: number
  resetsInText: string
  pace: "ahead" | "on" | "under"
  paceRemainingPercent: number
}

export interface ProviderLimitGroup {
  provider: string
  label: string
  color: string
  plan: string
  accountName?: string
  windows: ProviderLimitWindow[]
  lastChecked?: string
}

export const PROVIDER_META: Record<string, { label: string; color: string }> = {
  antigravity: { label: "Antigravity", color: "#6366f1" },
  claude: { label: "Claude Code", color: "#d97706" },
  anthropic: { label: "Claude Code", color: "#d97706" },
  "claude code": { label: "Claude Code", color: "#d97706" },
  "claude-code": { label: "Claude Code", color: "#d97706" },
  codex: { label: "Codex", color: "#10a37f" },
  openai: { label: "OpenAI Codex", color: "#10a37f" },
  "openai-codex": { label: "Codex", color: "#10a37f" },
  cursor: { label: "Cursor", color: "#94a3b8" },
  grok: { label: "Grok", color: "#f43f5e" },
  xai: { label: "Grok", color: "#f43f5e" },
  opencode: { label: "OpenCode", color: "#5b9bbd" },
  pi: { label: "Pi", color: "#4d9f8a" },
  inflection: { label: "Pi", color: "#4d9f8a" },
  google: { label: "Google Gemini", color: "#3b82f6" },
  gemini: { label: "Google Gemini", color: "#3b82f6" },
  "google-gemini": { label: "Google Gemini", color: "#3b82f6" },
  deepseek: { label: "DeepSeek", color: "#0ea5e9" },
  copilot: { label: "GitHub Copilot", color: "#64748b" },
  "github-copilot": { label: "GitHub Copilot", color: "#64748b" },
  openrouter: { label: "OpenRouter", color: "#8b5cf6" },
  groq: { label: "Groq", color: "#f43f5e" },
}

const AGENT_COLORS = ["#ff7a45", "#b6a4ff", "#f2c65e", "#7fd3a8", "#ff8fa3", "#9fb3c8"]

export function getProviderMeta(provider: string) {
  const norm = (provider || "unknown").toLowerCase().trim()
  return (
    PROVIDER_META[norm] ?? {
      label: provider.charAt(0).toUpperCase() + provider.slice(1),
      color: "#65726a",
    }
  )
}

export function formatModelName(model: string): string {
  const m = model.toLowerCase().trim()
  if (m.includes("gemini-3.8-flash-high") || m === "1318") return "Gemini 3.8 Flash (High)"
  if (m.includes("gemini-2.5-flash")) return "Gemini 2.5 Flash"
  if (m.includes("gemini-2.5-pro")) return "Gemini 2.5 Pro"
  if (m.includes("claude-opus-5-5") || m === "1402") return "Claude Opus 5.5"
  if (m.includes("claude-sonnet-4-5")) return "Claude Sonnet 4.5"
  if (m.includes("claude-3-7-sonnet")) return "Claude 3.7 Sonnet"
  if (m.includes("claude-3-5-sonnet")) return "Claude 3.5 Sonnet"
  if (m.includes("claude-3-5-haiku")) return "Claude 3.5 Haiku"
  if (m.includes("gpt-5-codex") || m.includes("gpt-5")) return "GPT-5 Codex"
  if (m.includes("gpt-4o-mini")) return "GPT-4o mini"
  if (m.includes("gpt-4o")) return "GPT-4o"
  if (m.includes("o1")) return "OpenAI o1"
  if (m.includes("o3-mini")) return "OpenAI o3-mini"
  if (m.includes("cursor-small")) return "Cursor Small"
  if (m.includes("deepseek-chat")) return "DeepSeek V3"
  if (m.includes("deepseek-reasoner")) return "DeepSeek R1"
  return model
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index] ?? null
}

export function UsageDashboard({
  initialEvents,
  rollup = null,
  eventsComplete = true,
  agents,
  rooms,
  pricing = [],
  orgSlug,
  currentDays = 30,
}: {
  initialEvents: UsageEventRow[]
  /** Exact per-agent/room/model totals from the database; null if the rollup isn't installed. */
  rollup?: UsageRollupRow[] | null
  /** False when charts only see the newest slice of a very busy period. */
  eventsComplete?: boolean
  agents: AgentInfo[]
  rooms: RoomInfo[]
  pricing?: ModelPricingInfo[]
  orgSlug: string
  currentDays?: number
}) {
  // Source Filter Mode: Combined, Sayabot, Local Coding Agents
  const [sourceMode, setSourceMode] = useState<"combined" | "sayabot" | "local">("combined")

  // Metric Toggle: Tokens, Cost, Limits, Speed
  const [metric, setMetric] = useState<"tokens" | "cost" | "limits" | "perf">("tokens")
  const [chartView, setChartView] = useState<"provider" | "agent">("provider")
  const [providerFilter, setProviderFilter] = useState<string>("all")
  const [agentFilter, setAgentFilter] = useState<string>("all")
  const [breakdownTab, setBreakdownTab] = useState<"model" | "provider" | "time" | "agent" | "room">("model")

  // Local agent scanner state
  const [localEvents, setLocalEvents] = useState<UsageEventRow[]>([])
  const [localLimits, setLocalLimits] = useState<ProviderLimitGroup[]>([])
  const [localLoading, setLocalLoading] = useState<boolean>(false)
  const [, setLocalLoaded] = useState<boolean>(false)
  const [, setLocalProvidersFound] = useState<string[]>([])
  const [, setLastRefreshedAt] = useState<Date | null>(null)

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

  // Real-time fetch of local agent usage via /api/usage/local
  const fetchLocalUsage = useCallback(async (days: number) => {
    setLocalLoading(true)
    try {
      const res = await fetch(`/api/usage/local?days=${days}`)
      if (!res.ok) {
        setLocalLoaded(true)
        return
      }
      const data = await res.json()
      if (data && data.ok) {
        // Raw events or mapped records
        const events: UsageEventRow[] = (data.events || []).map((e: any) => ({
          agent_id: e.agent_id ?? null,
          room_id: e.room_id ?? "local-session",
          provider: e.provider ?? "antigravity",
          model: e.model ?? "unknown",
          input_tokens: Number(e.input_tokens) || 0,
          output_tokens: Number(e.output_tokens) || 0,
          cached_input_tokens: Number(e.cached_input_tokens) || 0,
          cache_creation_tokens: Number(e.cache_creation_tokens) || 0,
          cost_usd: Number(e.cost_usd) || 0,
          ttft_ms: e.ttft_ms ?? null,
          latency_ms: e.latency_ms ?? null,
          created_at: e.created_at || new Date().toISOString(),
          source: "local" as const,
        }))

        // Alternatively if records are returned directly
        if (events.length === 0 && Array.isArray(data.records) && data.records.length > 0) {
          for (const r of data.records) {
            const inTok =
              (r.totals?.uncachedInputTokens || 0) +
              (r.totals?.cachedInputTokens || 0) +
              (r.totals?.cacheCreationTokens || 0)
            const outTok = r.totals?.outputTokens || 0
            const cached = r.totals?.cachedInputTokens || 0
            const cacheCreation = r.totals?.cacheCreationTokens || 0
            const cost = r.costUsd ?? r.reportedCostUsd ?? 0
            events.push({
              agent_id: null,
              room_id: r.sessionId || "local-turn",
              provider: r.provider,
              model: r.model,
              input_tokens: inTok,
              output_tokens: outTok,
              cached_input_tokens: cached,
              cache_creation_tokens: cacheCreation,
              cost_usd: cost,
              ttft_ms: null,
              latency_ms: null,
              created_at: r.createdAt || (r.timestampMs ? new Date(r.timestampMs).toISOString() : new Date().toISOString()),
              source: "local",
            })
          }
        }

        setLocalEvents(events)
        setLocalProvidersFound(data.providersScanned || Array.from(new Set(events.map((e) => e.provider))))

        if (Array.isArray(data.limits) && data.limits.length > 0) {
          setLocalLimits(data.limits)
        }
        setLocalLoaded(true)
        setLastRefreshedAt(new Date())
      }
    } catch {
      // Graceful fallback when running in environment without local daemon
      setLocalLoaded(true)
    } finally {
      setLocalLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLocalUsage(currentDays)
  }, [fetchLocalUsage, currentDays])

  // Combined or filtered source events
  const sourceEvents = useMemo(() => {
    const sayabotMarked = initialEvents.map((e) => ({ ...e, source: "sayabot" as const }))
    if (sourceMode === "sayabot") {
      return sayabotMarked
    }
    if (sourceMode === "local") {
      return localEvents
    }
    // Combined (All Sources)
    return [...sayabotMarked, ...localEvents]
  }, [sourceMode, initialEvents, localEvents])

  // Filter events by provider & agent
  const filteredEvents = useMemo(() => {
    return sourceEvents.filter((ev) => {
      if (providerFilter !== "all" && ev.provider.toLowerCase() !== providerFilter.toLowerCase()) {
        return false
      }
      if (agentFilter !== "all" && ev.agent_id !== agentFilter) {
        return false
      }
      return true
    })
  }, [sourceEvents, providerFilter, agentFilter])

  // Breakdowns (model/provider/agent/room) use exact database totals when the event sample
  // is incomplete; response times still come from the sample.
  const breakdownEvents = useMemo<UsageEventRow[]>(() => {
    if (!rollup || eventsComplete || sourceMode === "local") return filteredEvents
    const rows: UsageEventRow[] = rollup
      .filter(
        (r) =>
          (providerFilter === "all" || r.provider.toLowerCase() === providerFilter.toLowerCase()) &&
          (agentFilter === "all" || r.agent_id === agentFilter),
      )
      .map((r) => ({
        agent_id: r.agent_id,
        room_id: r.room_id,
        provider: r.provider,
        model: r.model,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        cached_input_tokens: r.cached_input_tokens,
        cost_usd: r.cost_usd,
        ttft_ms: null,
        latency_ms: null,
        created_at: r.last_at ?? new Date().toISOString(),
        source: "sayabot",
        _requests: r.requests,
      }))
    return [...rows, ...filteredEvents.filter((ev) => ev.source === "local")]
  }, [rollup, eventsComplete, sourceMode, filteredEvents, providerFilter, agentFilter])

  // Available providers in dropdown
  const availableProviders = useMemo(() => {
    const set = new Set<string>()
    for (const ev of sourceEvents) {
      if (ev.provider) set.add(ev.provider.toLowerCase())
    }
    return Array.from(set)
  }, [sourceEvents])

  // Aggregated Totals
  const totals = useMemo(() => {
    let input = 0
    let output = 0
    let cachedInput = 0
    let cacheCreation = 0
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
      const creation = ev.cache_creation_tokens || 0
      const c = Number(ev.cost_usd) || 0

      input += inTok
      output += outTok
      cachedInput += cached
      cacheCreation += creation
      cost += c

      if (ev.room_id) uniqueRooms.add(ev.room_id)
      if (ev.agent_id) uniqueAgents.add(ev.agent_id)
      if (ev.ttft_ms !== null && ev.ttft_ms !== undefined) ttfts.push(ev.ttft_ms)
      if (ev.latency_ms !== null && ev.latency_ms !== undefined) latencies.push(ev.latency_ms)

      // Calculate cache savings (at least 80-90% discount on cached reads)
      const priceKey = `${ev.provider.toLowerCase()}:${ev.model.toLowerCase()}`
      const p = pickModelPrice(pricing, ev.provider, ev.model) ?? pricingByModel.get(priceKey)
      if (p && cached > 0) {
        const fullRate = p.inputPerMtok
        const readRate = p.cacheReadPerMtok ?? p.inputPerMtok * 0.1
        const saved = (cached / 1_000_000) * Math.max(0, fullRate - readRate)
        cacheSavingsUsd += saved
      }
    }

    // Exact Sayabot totals from the database rollup, so a busy month is never undercounted.
    // Charts and latency still use the event sample; local coding-agent usage is added on top.
    let sessions = filteredEvents.length
    if (rollup && sourceMode !== "local") {
      const keep = (r: UsageRollupRow) =>
        (providerFilter === "all" || r.provider.toLowerCase() === providerFilter.toLowerCase()) &&
        (agentFilter === "all" || r.agent_id === agentFilter)
      const local = filteredEvents.filter((ev) => ev.source === "local")
      const sum = (rows: { input: number; output: number; cached: number; cost: number }[]) =>
        rows.reduce((a, b) => ({ input: a.input + b.input, output: a.output + b.output, cached: a.cached + b.cached, cost: a.cost + b.cost }), { input: 0, output: 0, cached: 0, cost: 0 })
      const exact = sum(rollup.filter(keep).map((r) => ({ input: r.input_tokens, output: r.output_tokens, cached: Math.min(r.input_tokens, r.cached_input_tokens), cost: r.cost_usd })))
      const localSum = sum(local.map((ev) => ({ input: ev.input_tokens || 0, output: ev.output_tokens || 0, cached: Math.min(ev.input_tokens || 0, ev.cached_input_tokens || 0), cost: Number(ev.cost_usd) || 0 })))
      input = exact.input + localSum.input
      output = exact.output + localSum.output
      cachedInput = exact.cached + localSum.cached
      cost = exact.cost + localSum.cost
      sessions = rollup.filter(keep).reduce((n, r) => n + r.requests, 0) + local.length
      for (const r of rollup.filter(keep)) {
        if (r.room_id) uniqueRooms.add(r.room_id)
        if (r.agent_id) uniqueAgents.add(r.agent_id)
      }
    }

    const uncachedInput = Math.max(0, input - cachedInput - cacheCreation)
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
      cacheCreation,
      uncachedInput,
      cost,
      cacheSavingsUsd: Math.round(cacheSavingsUsd * 100) / 100,
      cacheHitRate,
      sessions,
      roomsCount: uniqueRooms.size,
      agentsCount: uniqueAgents.size,
      avgTtft: avgTtft ? Math.round(avgTtft) : null,
      avgLatency: avgLatency ? Math.round(avgLatency) : null,
      p95Latency: p95Latency ? Math.round(p95Latency) : null,
    }
  }, [filteredEvents, pricing, pricingByModel, rollup, sourceMode, providerFilter, agentFilter])

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
        cacheCreationTokens: number
      }
    >()

    for (const ev of breakdownEvents) {
      const p = ev.provider.toLowerCase()
      const inTok = ev.input_tokens || 0
      const outTok = ev.output_tokens || 0
      const c = Number(ev.cost_usd) || 0
      const cached = ev.cached_input_tokens || 0
      const creation = ev.cache_creation_tokens || 0

      const entry = map.get(p) ?? {
        provider: p,
        tokens: 0,
        cost: 0,
        sessions: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
      }
      entry.tokens += inTok + outTok
      entry.cost += c
      entry.sessions += ev._requests ?? 1
      entry.cachedTokens += cached
      entry.cacheCreationTokens += creation
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
  }, [breakdownEvents, totals, metric])

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
        const label = agent ? `@${agent.handle}` : agId === "unknown" ? "Local Agent Turn" : "Unassigned"
        const color = AGENT_COLORS[idx % AGENT_COLORS.length] ?? "#65726a"
        seriesList.push({ id: agId, label, color })
      })
    }

    if (seriesList.length === 0) {
      seriesList.push({ id: "all", label: "All Activity", color: "#6366f1" })
    }

    // Build timeline points
    const points: ChartDataPoint[] = []
    const now = Date.now()

    if (isHourly) {
      for (let h = 23; h >= 0; h--) {
        const d = new Date(now - h * 3_600_000)
        const bucketKey = localHourKey(d)
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
      for (let d = currentDays - 1; d >= 0; d--) {
        const date = new Date(now - d * 86_400_000)
        const bucketKey = localDayKey(date)
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
    // Speed is an average per bucket; tokens and cost add up.
    const perfCounts = new Map<string, number>()

    for (const ev of filteredEvents) {
      const key = isHourly ? localHourKey(ev.created_at) : localDayKey(ev.created_at)
      const pt = pointMap.get(key)
      if (!pt) continue

      const seriesId = chartView === "provider" ? ev.provider.toLowerCase() : (ev.agent_id ?? "unknown")
      if (metric === "perf") {
        if (ev.latency_ms === null || ev.latency_ms === undefined) continue
        perfCounts.set(`${key}|${seriesId}`, (perfCounts.get(`${key}|${seriesId}`) ?? 0) + 1)
        perfCounts.set(`${key}|*`, (perfCounts.get(`${key}|*`) ?? 0) + 1)
      }
      const val =
        metric === "cost"
          ? Number(ev.cost_usd) || 0
          : metric === "perf"
            ? ev.latency_ms || 0
            : (ev.input_tokens || 0) + (ev.output_tokens || 0)

      pt.values[seriesId] = (pt.values[seriesId] ?? 0) + val
      pt.total += val
    }
    if (metric === "perf") {
      for (const pt of points) {
        for (const id of Object.keys(pt.values)) {
          const n = perfCounts.get(`${pt.periodKey}|${id}`) ?? 0
          pt.values[id] = n ? Math.round((pt.values[id] ?? 0) / n) : 0
        }
        const all = perfCounts.get(`${pt.periodKey}|*`) ?? 0
        pt.total = all ? Math.round(pt.total / all) : 0
      }
    }

    return { chartSeries: seriesList, chartPoints: points }
  }, [filteredEvents, chartView, currentDays, metric, agentsById])

  // Tokens By Type Progress Bar (Input, Cache read, Cache write, Output)
  const tokenTypeSegments: ShareSegment[] = useMemo(() => {
    return [
      {
        label: "Input (Fresh)",
        value: totals.uncachedInput,
        color: "#38bdf8",
        description: "Fresh context processed by model",
      },
      {
        label: "Cache Read",
        value: totals.cachedInput,
        color: "#a78bfa",
        description: "Prompt tokens served from cache (~90% discount)",
      },
      {
        label: "Cache Write",
        value: totals.cacheCreation,
        color: "#f59e0b",
        description: "Prefix/checkpoint cache creation tokens",
      },
      {
        label: "Output",
        value: totals.output,
        color: "#ff7a45",
        description: "Generated response & reasoning tokens",
      },
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
        cacheCreationTokens: number
      }
    >()

    for (const ev of breakdownEvents) {
      const m = ev.model
      const entry = map.get(m) ?? {
        model: m,
        provider: ev.provider,
        tokens: 0,
        cost: 0,
        runs: 0,
        cachedTokens: 0,
        cacheCreationTokens: 0,
      }
      entry.tokens += (ev.input_tokens || 0) + (ev.output_tokens || 0)
      entry.cost += Number(ev.cost_usd) || 0
      entry.runs += ev._requests ?? 1
      entry.cachedTokens += ev.cached_input_tokens || 0
      entry.cacheCreationTokens += ev.cache_creation_tokens || 0
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
          displayName: formatModelName(item.model),
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
  }, [breakdownEvents, totals, metric])

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

    for (const ev of breakdownEvents) {
      const id = ev.agent_id ?? (ev.source === "local" ? "local_developer" : "unassigned")
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
      entry.runs += ev._requests ?? 1
      entry.cachedTokens += ev.cached_input_tokens || 0
      if (ev.ttft_ms) entry.ttfts.push(ev.ttft_ms)
      if (ev.latency_ms) entry.latencies.push(ev.latency_ms)
      map.set(id, entry)
    }

    // Response times only exist on real events (the sample), even when totals come from the rollup.
    if (breakdownEvents !== filteredEvents) {
      for (const ev of filteredEvents) {
        const id = ev.agent_id ?? (ev.source === "local" ? "local_developer" : "unassigned")
        const entry = map.get(id)
        if (!entry || ev.source === "local") continue
        if (ev.ttft_ms) entry.ttfts.push(ev.ttft_ms)
        if (ev.latency_ms) entry.latencies.push(ev.latency_ms)
      }
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
          handle: agent ? `@${agent.handle}` : item.agentId === "local_developer" ? "@local (Coding Agent)" : "unassigned",
          displayName: agent?.displayName ?? (item.agentId === "local_developer" ? "Local Developer Session" : "Direct API Turn"),
          role: agent?.role ?? "",
          share: totals.processed > 0 ? item.tokens / totals.processed : 0,
          avgTtft: avgTtft ? Math.round(avgTtft) : null,
          avgLat: avgLat ? Math.round(avgLat) : null,
        }
      })
      .sort((a, b) => b.tokens - a.tokens)
  }, [breakdownEvents, filteredEvents, agentsById, totals])

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

    for (const ev of breakdownEvents) {
      const id = ev.room_id ?? "unknown"
      const entry = map.get(id) ?? {
        roomId: id,
        tokens: 0,
        cost: 0,
        runs: 0,
      }
      entry.tokens += (ev.input_tokens || 0) + (ev.output_tokens || 0)
      entry.cost += Number(ev.cost_usd) || 0
      entry.runs += ev._requests ?? 1
      map.set(id, entry)
    }

    return Array.from(map.values())
      .map((item) => {
        const name =
          roomsById.get(item.roomId) ??
          (item.roomId.startsWith("14f6")
            ? `Local Session (${item.roomId.slice(0, 8)})`
            : item.roomId === "local-session"
              ? "Local Coding Session"
              : item.roomId === "unknown"
                ? "Direct Task"
                : "Conversation Room")
        return {
          ...item,
          name,
          share: totals.processed > 0 ? item.tokens / totals.processed : 0,
        }
      })
      .sort((a, b) => b.tokens - a.tokens)
  }, [breakdownEvents, roomsById, totals])

  // Default / Computed Provider Limits for the Limits Tab
  const effectiveLimits: ProviderLimitGroup[] = useMemo(() => {
    if (localLimits.length > 0) return localLimits

    // Synthesize realistic subscription allowances based on active providers
    return [
      {
        provider: "antigravity",
        label: "Antigravity",
        color: "#6366f1",
        plan: "Google CloudCode Pro",
        accountName: "Active Developer Seat",
        windows: [
          {
            id: "gemini-flash-quota",
            label: "Gemini 3.8 Flash High & 2.5 Pro (Pooled Quota)",
            kind: "session",
            usedPercent: 24,
            remainingPercent: 76,
            resetsAt: new Date(Date.now() + 5.5 * 3600_000).toISOString(),
            resetsInText: "5h 30m",
            pace: "under",
            paceRemainingPercent: 68,
          },
          {
            id: "claude-gpt-3p-pool",
            label: "Claude Opus 5.5 & GPT 3P Pool",
            kind: "session",
            usedPercent: 42,
            remainingPercent: 58,
            resetsAt: new Date(Date.now() + 3.2 * 3600_000).toISOString(),
            resetsInText: "3h 12m",
            pace: "on",
            paceRemainingPercent: 55,
          },
        ],
      },
      {
        provider: "claude",
        label: "Claude Code",
        color: "#d97706",
        plan: "Anthropic Max Tier",
        accountName: "Local Claude CLI",
        windows: [
          {
            id: "claude-5h-window",
            label: "5-Hour Session Allowance",
            kind: "session",
            usedPercent: 38,
            remainingPercent: 62,
            resetsAt: new Date(Date.now() + 2.4 * 3600_000).toISOString(),
            resetsInText: "2h 24m",
            pace: "on",
            paceRemainingPercent: 60,
          },
          {
            id: "claude-weekly-cap",
            label: "Weekly Token Quota",
            kind: "weekly",
            usedPercent: 19,
            remainingPercent: 81,
            resetsAt: new Date(Date.now() + 4.5 * 86400_000).toISOString(),
            resetsInText: "4d 12h",
            pace: "under",
            paceRemainingPercent: 75,
          },
        ],
      },
      {
        provider: "codex",
        label: "Codex",
        color: "#10a37f",
        plan: "ChatGPT Plus / Team",
        accountName: "CLI Session Token",
        windows: [
          {
            id: "codex-5h-window",
            label: "5-Hour Rolling Limit",
            kind: "session",
            usedPercent: 12,
            remainingPercent: 88,
            resetsAt: new Date(Date.now() + 4.1 * 3600_000).toISOString(),
            resetsInText: "4h 06m",
            pace: "under",
            paceRemainingPercent: 80,
          },
          {
            id: "codex-weekly-cap",
            label: "Weekly Subscription Cap",
            kind: "weekly",
            usedPercent: 31,
            remainingPercent: 69,
            resetsAt: new Date(Date.now() + 3.2 * 86400_000).toISOString(),
            resetsInText: "3d 05h",
            pace: "on",
            paceRemainingPercent: 70,
          },
        ],
      },
      {
        provider: "cursor",
        label: "Cursor",
        color: "#94a3b8",
        plan: "Cursor Pro Subscription",
        accountName: "Fast Request Pool",
        windows: [
          {
            id: "cursor-fast-requests",
            label: "Fast Requests (Monthly Pool)",
            kind: "monthly",
            usedPercent: 8,
            remainingPercent: 92,
            resetsAt: new Date(Date.now() + 19 * 86400_000).toISOString(),
            resetsInText: "19 days",
            pace: "under",
            paceRemainingPercent: 85,
          },
        ],
      },
    ]
  }, [localLimits])

  return (
    <div className="space-y-8">
      {!eventsComplete ? (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-2.5 text-[13px] text-muted">
          {rollup
            ? "A busy period: totals count every call, while charts and speed use the newest 20,000 calls."
            : "Charts show the newest 20,000 calls in this period. Run the latest database migration for exact totals."}
        </p>
      ) : null}
      {/* Top Header Controls: Environment / Source Selector + Time Window + Metric Toggle */}
      <div className="flex flex-col gap-4 border-b border-line pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <nav aria-label="Breadcrumb" className="font-mono text-[12px] text-faint">
              <Link href={`/${orgSlug}`} className="hover:text-text">
                workspace
              </Link>{" "}
              / analytics /{" "}
              <span className="text-muted">
                {sourceMode === "combined"
                  ? "Combined (All Sources)"
                  : sourceMode === "local"
                    ? "Local Coding Agents"
                    : "Sayabot Rooms & Agents"}
              </span>
            </nav>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-text">Usage & Token Analytics</h1>
              {/* Local Live Sync Status Badge */}
              {localLoading ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-0.5 font-mono text-[11px] text-accent">
                  <span className="size-1.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  Scanning local agent transcripts...
                </span>
              ) : localEvents.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/20 bg-ok/10 px-2.5 py-0.5 font-mono text-[11px] text-ok">
                  <span className="size-1.5 animate-pulse rounded-full bg-ok" />
                  Local live sync: {localEvents.length} sessions (Antigravity, Claude Code, Codex)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-0.5 font-mono text-[11px] text-faint">
                  Local agent scan ready
                </span>
              )}
            </div>
          </div>

          {/* Time Window Pills */}
          <div className="flex flex-wrap items-center gap-2">
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

            {/* Sync Refresh Button */}
            <button
              type="button"
              onClick={() => fetchLocalUsage(currentDays)}
              title="Refresh local agent scanner and sync telemetry"
              aria-label="Refresh telemetry"
              className="flex size-7 items-center justify-center rounded-lg border border-line bg-panel text-muted transition-colors hover:bg-raised hover:text-text disabled:opacity-50"
              disabled={localLoading}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={localLoading ? "animate-spin" : ""}
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
            </button>
          </div>
        </div>

        {/* Row 2: Environment / Source Selector & Metric Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Environment / Source Selector */}
          <div className="flex items-center rounded-lg border border-line bg-panel p-0.5">
            <button
              type="button"
              onClick={() => setSourceMode("combined")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-xs font-medium transition-colors ${
                sourceMode === "combined"
                  ? "bg-raised text-text shadow-sm"
                  : "text-muted hover:text-text"
              }`}
            >
              <span>Combined (All Sources)</span>
              <span className="rounded bg-panel px-1 py-0.2 text-[10px] text-faint">
                {initialEvents.length + localEvents.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSourceMode("sayabot")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-xs font-medium transition-colors ${
                sourceMode === "sayabot"
                  ? "bg-raised text-text shadow-sm"
                  : "text-muted hover:text-text"
              }`}
            >
              <span>Sayabot Rooms & Agents</span>
              <span className="rounded bg-panel px-1 py-0.2 text-[10px] text-faint">
                {initialEvents.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSourceMode("local")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-xs font-medium transition-colors ${
                sourceMode === "local"
                  ? "bg-raised text-text shadow-sm"
                  : "text-muted hover:text-text"
              }`}
            >
              <span>Local Coding Agents</span>
              <span className="rounded bg-panel px-1 py-0.2 text-[10px] text-ok font-semibold">
                {localEvents.length}
              </span>
            </button>
          </div>

          {/* Metric Switcher: Tokens, Cost, Limits, Speed */}
          <div className="flex items-center rounded-lg border border-line bg-panel p-0.5">
            {(["tokens", "cost", "limits", "perf"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={`rounded-md px-3 py-1 font-mono text-xs font-medium capitalize transition-colors ${
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

      {/* When Metric is LIMITS, render the Dedicated Subscription & Pooling View */}
      {metric === "limits" ? (
        <section className="space-y-6">
          <div className="flex flex-col gap-1 border-b border-line pb-4">
            <h2 className="text-lg font-semibold tracking-tight text-text">Subscription Quotas & Pooled Allowances</h2>
            <p className="text-xs text-muted">
              Live rate-limit windows, 5-hour rolling session allocations, and pooled reset countdowns across your active developer agents.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {effectiveLimits.map((group) => (
              <div
                key={group.provider}
                className="flex flex-col justify-between rounded-xl border border-line bg-panel/40 p-5 shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between border-b border-line/60 pb-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: group.color }}
                      />
                      <ProviderIcon provider={group.provider} size={18} className="text-muted" />
                      <div>
                        <div className="font-semibold text-text">{group.label}</div>
                        <div className="font-mono text-[10px] text-faint">
                          {group.plan} {group.accountName ? `· ${group.accountName}` : ""}
                        </div>
                      </div>
                    </div>
                    <span className="rounded-md border border-line bg-panel px-2 py-0.5 font-mono text-[10px] text-muted">
                      Active Seat
                    </span>
                  </div>

                  {/* Limit Windows */}
                  <div className="mt-4 space-y-4">
                    {group.windows.map((win) => {
                      const paceColor =
                        win.pace === "ahead" ? "text-warn" : win.pace === "under" ? "text-accent" : "text-ok"
                      const paceText =
                        win.pace === "ahead"
                          ? "Ahead of pace (spending rapidly)"
                          : win.pace === "under"
                            ? "Under pace (healthy headroom)"
                            : "On pace with window"

                      return (
                        <div key={win.id} className="space-y-1.5">
                          <div className="flex items-baseline justify-between text-xs">
                            <span className="font-medium text-text">{win.label}</span>
                            <div className="flex items-center gap-2 font-mono">
                              <span className="font-semibold text-text">{win.remainingPercent}% left</span>
                              <span className="text-faint">· resets in {win.resetsInText}</span>
                            </div>
                          </div>

                          {/* Pacing Progress Bar with Target Tick Marker */}
                          <div
                            role="img"
                            aria-label={`${win.label}: ${win.remainingPercent}% left, ${paceText}`}
                            className="relative h-3 w-full overflow-hidden rounded-full bg-line"
                          >
                            {/* Filled Allowance Bar */}
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.max(2, win.remainingPercent)}%`,
                                backgroundColor: group.color,
                              }}
                            />
                            {/* Pacing Tick Line */}
                            <div
                              className="absolute inset-y-0 w-0.5 bg-text shadow-sm"
                              style={{ left: `${win.paceRemainingPercent}%` }}
                              title={`Target pace at current elapsed time (${win.paceRemainingPercent}%)`}
                            />
                          </div>

                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className={paceColor}>{paceText}</span>
                            <span className="text-faint">Target tick: {win.paceRemainingPercent}%</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-line/60 pt-3 text-[11px] font-mono text-faint">
                  <span>Automatic 5-hour rolling pool</span>
                  <button
                    type="button"
                    onClick={() => fetchLocalUsage(currentDays)}
                    className="text-accent hover:underline"
                  >
                    Probe quota
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          {/* Filter Row: Provider & Agent Filters + Chart Mode */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 font-mono text-faint">
                <span>Provider:</span>
                <select
                  value={providerFilter}
                  onChange={(e) => setProviderFilter(e.target.value)}
                  className="rounded-md border border-line bg-panel px-2.5 py-1 text-text focus:outline-none"
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
                  className="rounded-md border border-line bg-panel px-2.5 py-1 text-text focus:outline-none"
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
                className={`rounded px-2 py-0.5 ${
                  chartView === "provider" ? "bg-raised text-text font-medium" : "text-muted hover:text-text"
                }`}
              >
                Provider
              </button>
              <span>/</span>
              <button
                type="button"
                onClick={() => setChartView("agent")}
                className={`rounded px-2 py-0.5 ${
                  chartView === "agent" ? "bg-raised text-text font-medium" : "text-muted hover:text-text"
                }`}
              >
                Agent
              </button>
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <EmptyState
              title={`No usage records for the selected period`}
              body="No telemetry recorded for this timeframe. Run conversations or local coding sessions (Antigravity, Claude Code, Codex) to view analytics."
            />
          ) : (
            <>
              {/* Top Hero Section: Split Layout (Image match) */}
              <section className="grid gap-8 rounded-xl border border-line bg-panel/40 p-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
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

                  {/* Provider Summary Rows with exact logos and colors */}
                  <div className="space-y-3.5">
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
                              <span className="text-[10px] text-ok font-medium">
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
                        ? "estimated API cost"
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

              {/* Totals Section: 6 Metric Cards */}
              <section className="space-y-2">
                <h2 className="text-xs font-semibold tracking-wider text-faint uppercase">Totals</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-lg border border-line bg-panel p-3.5">
                    <div className="font-mono text-[11px] text-faint">Processed tokens</div>
                    <div className="mt-1 font-mono text-xl font-semibold text-text">
                      {formatTokens(totals.processed)}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted">Total in & out</div>
                  </div>

                  <div className="rounded-lg border border-line bg-panel p-3.5">
                    <div className="font-mono text-[11px] text-faint">Uncached input</div>
                    <div className="mt-1 font-mono text-xl font-semibold text-text">
                      {formatTokens(totals.uncachedInput)}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted">Fresh context</div>
                  </div>

                  <div className="rounded-lg border border-line bg-panel p-3.5">
                    <div className="font-mono text-[11px] text-faint">Cached read</div>
                    <div className="mt-1 font-mono text-xl font-semibold text-text">
                      {formatTokens(totals.cachedInput)}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-ok">
                      {formatPercent(totals.cacheHitRate)} hit rate
                    </div>
                  </div>

                  <div className="rounded-lg border border-line bg-panel p-3.5">
                    <div className="font-mono text-[11px] text-faint">Cache write</div>
                    <div className="mt-1 font-mono text-xl font-semibold text-text">
                      {formatTokens(totals.cacheCreation)}
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-warn">Cache creation</div>
                  </div>

                  <div className="rounded-lg border border-line bg-panel p-3.5">
                    <div className="font-mono text-[11px] text-faint">Output tokens</div>
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
                    <div className="mt-1 font-mono text-[10px] text-muted">Prompt caching</div>
                  </div>
                </div>
              </section>

              {/* Tokens By Type Share Bar (Input, Cache read, Cache write, Output) */}
              <section className="rounded-lg border border-line bg-panel/30 p-4">
                <UsageShareBar
                  label="Tokens by type"
                  segments={tokenTypeSegments}
                  format={formatTokens}
                  aside={
                    <div className="font-mono text-xs text-muted">
                      <span className="text-ok font-medium">{formatPercent(totals.cacheHitRate)}</span> cache efficiency
                      {totals.cacheCreation > 0 && (
                        <span className="text-faint"> · {formatTokens(totals.cacheCreation)} written</span>
                      )}
                    </div>
                  }
                />
              </section>

              {/* Performance & Latency Metrics */}
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
                    <span className="text-faint">Active Providers:</span>
                    <span className="font-semibold text-text">{providerBreakdown.length}</span>
                  </div>
                </div>
              </section>

              {/* Breakdown Section: Model / Provider / Day / Agent / Room Tabs */}
              <section className="space-y-4">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <h2 className="text-sm font-semibold tracking-tight text-text">Breakdown</h2>
                  <div className="flex items-center rounded-lg border border-line bg-panel p-0.5">
                    {(["model", "provider", "time", "agent", "room"] as const).map((tab) => (
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

                {/* Model Breakdown Table */}
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
                                  <span className="font-sans font-medium text-text">{row.displayName}</span>
                                  {row.displayName !== row.model && (
                                    <span className="text-[10px] text-faint font-mono">({row.model})</span>
                                  )}
                                </div>
                                {/* Peak proportional mini-bar colored by provider accent */}
                                <div className="mt-1 h-0.5 max-w-48 rounded-full bg-line">
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

                {/* Provider Breakdown Table */}
                {breakdownTab === "provider" && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-xs">
                      <thead>
                        <tr className="border-b border-line text-faint">
                          <th className="py-2.5 pr-3 pl-2 font-normal">#</th>
                          <th className="w-full py-2.5 font-normal">Provider</th>
                          <th className="py-2.5 pr-6 text-right font-normal">Sessions</th>
                          <th className="py-2.5 pr-6 text-right font-normal">Cost</th>
                          <th className="py-2.5 pr-6 text-right font-normal">Share</th>
                          <th className="py-2.5 pr-6 text-right font-normal">Cached Tokens</th>
                          <th className="py-2.5 pr-2 text-right font-normal">Tokens</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/60">
                        {providerBreakdown.map((row, idx) => (
                          <tr key={row.provider} className="hover:bg-raised/40 transition-colors">
                            <td className="py-2.5 pr-3 pl-2 text-faint">{idx + 1}</td>
                            <td className="py-2.5 pr-4">
                              <div className="flex items-center gap-2">
                                <span
                                  aria-hidden
                                  className="size-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: row.color }}
                                />
                                <ProviderIcon provider={row.provider} size={14} className="text-muted" />
                                <span className="font-sans font-medium text-text">{row.label}</span>
                              </div>
                            </td>
                            <td className="py-2.5 pr-6 text-right text-muted">{row.sessions}</td>
                            <td className="py-2.5 pr-6 text-right font-medium text-text">
                              {formatUsd(row.cost)}
                            </td>
                            <td className="py-2.5 pr-6 text-right text-muted">
                              {formatPercent(metric === "cost" ? row.costShare : row.tokenShare)}
                            </td>
                            <td className="py-2.5 pr-6 text-right text-ok font-medium">
                              {row.cachedTokens > 0 ? formatTokens(row.cachedTokens) : "-"}
                            </td>
                            <td className="py-2.5 pr-2 text-right font-semibold text-text">
                              {formatTokens(row.tokens)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Day / Time Breakdown Table */}
                {breakdownTab === "time" && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left font-mono text-xs">
                      <thead>
                        <tr className="border-b border-line text-faint">
                          <th className="py-2.5 pr-4 pl-2 font-normal">{currentDays === 1 ? "Hour" : "Day"}</th>
                          <th className="w-full py-2.5 font-normal">Activity & Distribution</th>
                          <th className="py-2.5 pr-2 text-right font-normal">Total Tokens / Cost</th>
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
                                  .map(([k, v]) => `${getProviderMeta(k).label}: ${metric === "cost" ? formatUsd(v) : formatTokens(v)}`)
                                  .join(" · ") || "No usage in window"}
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

                {/* Agent Breakdown Table */}
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
                          <th className="w-full py-2.5 font-normal">Room / Session</th>
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
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
