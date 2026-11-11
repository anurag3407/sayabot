import type {
  DailySummary,
  LocalProvider,
  ModelSummary,
  ProviderSummary,
  ScanOptions,
  ScannedUsageEventRow,
  ScannedUsageRecord,
  ScannedUsageResult,
  ScannedUsageSummary,
} from "./types"
import { scanAntigravityUsage } from "./antigravity"
import { scanClaudeUsage } from "./claude"
import { scanCodexUsage } from "./codex"
import { estimateLocalLimits } from "./limits"

export * from "./types"
export * from "./pricing"
export * from "./antigravity"
export * from "./claude"
export * from "./codex"
export * from "./limits"

/**
 * High-performance orchestrator that scans all local developer agent stores
 * (Antigravity SQLite, Claude Code JSONLs, Codex sessions) and produces
 * unified usage records, aggregations, and dashboard event rows.
 */
export async function scanLocalUsage(
  options: ScanOptions = {},
): Promise<ScannedUsageResult> {
  const days = options.days !== undefined && options.days > 0 ? options.days : 30
  const sinceMs =
    options.sinceMs !== undefined ? options.sinceMs : Date.now() - days * 86_400_000

  const activeProviders: LocalProvider[] =
    options.includeProviders && options.includeProviders.length > 0
      ? options.includeProviders
      : ["antigravity", "claude", "codex"]

  const tasks: Promise<ScannedUsageRecord[]>[] = []

  if (activeProviders.includes("antigravity")) {
    tasks.push(
      Promise.resolve().then(() =>
        scanAntigravityUsage({
          sinceMs,
          directories: options.antigravityDirs,
        }),
      ),
    )
  }

  if (activeProviders.includes("claude")) {
    tasks.push(
      scanClaudeUsage({
        sinceMs,
        directories: options.claudeDirs,
      }),
    )
  }

  if (activeProviders.includes("codex")) {
    tasks.push(
      scanCodexUsage({
        sinceMs,
        directories: options.codexDirs,
      }),
    )
  }

  const results = await Promise.allSettled(tasks)

  const records: ScannedUsageRecord[] = []
  const seenIds = new Set<string>()

  for (const res of results) {
    if (res.status === "fulfilled") {
      for (const rec of res.value) {
        if (!seenIds.has(rec.id)) {
          seenIds.add(rec.id)
          records.push(rec)
        }
      }
    }
  }

  // Sort ascending by timestamp
  records.sort((a, b) => a.timestampMs - b.timestampMs)

  // Aggregate metrics
  let totalTokens = 0
  let uncachedInputTokens = 0
  let cachedInputTokens = 0
  let cacheCreationTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let costUsd = 0
  let cacheSavingsUsd = 0

  const sessionIds = new Set<string>()
  const byProviderMap = new Map<
    string,
    {
      tokens: number
      costUsd: number
      cacheSavingsUsd: number
      sessions: Set<string>
      uncachedInputTokens: number
      cachedInputTokens: number
      cacheCreationTokens: number
      outputTokens: number
      reasoningTokens: number
    }
  >()

  const byModelMap = new Map<
    string,
    {
      provider: string
      tokens: number
      costUsd: number
      sessions: Set<string>
    }
  >()

  const byDayMap = new Map<
    string,
    {
      tokens: number
      costUsd: number
      uncachedInputTokens: number
      cachedInputTokens: number
      cacheCreationTokens: number
      outputTokens: number
      sessions: Set<string>
    }
  >()

  for (const rec of records) {
    const t = rec.totals
    const recTokens =
      t.uncachedInputTokens +
      t.cachedInputTokens +
      t.cacheCreationTokens +
      t.outputTokens

    totalTokens += recTokens
    uncachedInputTokens += t.uncachedInputTokens
    cachedInputTokens += t.cachedInputTokens
    cacheCreationTokens += t.cacheCreationTokens
    outputTokens += t.outputTokens
    reasoningTokens += t.reasoningTokens
    costUsd += rec.costUsd
    cacheSavingsUsd += rec.cacheSavingsUsd
    sessionIds.add(rec.sessionId)

    // Provider aggregation
    let pGroup = byProviderMap.get(rec.provider)
    if (!pGroup) {
      pGroup = {
        tokens: 0,
        costUsd: 0,
        cacheSavingsUsd: 0,
        sessions: new Set(),
        uncachedInputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      }
      byProviderMap.set(rec.provider, pGroup)
    }
    pGroup.tokens += recTokens
    pGroup.costUsd += rec.costUsd
    pGroup.cacheSavingsUsd += rec.cacheSavingsUsd
    pGroup.sessions.add(rec.sessionId)
    pGroup.uncachedInputTokens += t.uncachedInputTokens
    pGroup.cachedInputTokens += t.cachedInputTokens
    pGroup.cacheCreationTokens += t.cacheCreationTokens
    pGroup.outputTokens += t.outputTokens
    pGroup.reasoningTokens += t.reasoningTokens

    // Model aggregation
    let mGroup = byModelMap.get(rec.model)
    if (!mGroup) {
      mGroup = {
        provider: rec.provider,
        tokens: 0,
        costUsd: 0,
        sessions: new Set(),
      }
      byModelMap.set(rec.model, mGroup)
    }
    mGroup.tokens += recTokens
    mGroup.costUsd += rec.costUsd
    mGroup.sessions.add(rec.sessionId)

    // Daily aggregation
    let dGroup = byDayMap.get(rec.isoDate)
    if (!dGroup) {
      dGroup = {
        tokens: 0,
        costUsd: 0,
        uncachedInputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
        sessions: new Set(),
      }
      byDayMap.set(rec.isoDate, dGroup)
    }
    dGroup.tokens += recTokens
    dGroup.costUsd += rec.costUsd
    dGroup.uncachedInputTokens += t.uncachedInputTokens
    dGroup.cachedInputTokens += t.cachedInputTokens
    dGroup.cacheCreationTokens += t.cacheCreationTokens
    dGroup.outputTokens += t.outputTokens
    dGroup.sessions.add(rec.sessionId)
  }

  const byProvider: Record<string, ProviderSummary> = {}
  for (const [pName, group] of byProviderMap.entries()) {
    byProvider[pName] = {
      provider: pName,
      tokens: group.tokens,
      costUsd: Math.round(group.costUsd * 1e4) / 1e4,
      cacheSavingsUsd: Math.round(group.cacheSavingsUsd * 1e4) / 1e4,
      sessions: group.sessions.size,
      sharePercent:
        totalTokens > 0 ? Math.round((group.tokens / totalTokens) * 1000) / 10 : 0,
      tokenMix: {
        uncachedInputTokens: group.uncachedInputTokens,
        cachedInputTokens: group.cachedInputTokens,
        cacheCreationTokens: group.cacheCreationTokens,
        outputTokens: group.outputTokens,
        reasoningTokens: group.reasoningTokens,
      },
    }
  }

  const byModel: Record<string, ModelSummary> = {}
  for (const [mName, group] of byModelMap.entries()) {
    byModel[mName] = {
      model: mName,
      provider: group.provider,
      tokens: group.tokens,
      costUsd: Math.round(group.costUsd * 1e4) / 1e4,
      sessions: group.sessions.size,
      sharePercent:
        totalTokens > 0 ? Math.round((group.tokens / totalTokens) * 1000) / 10 : 0,
    }
  }

  const byDay: DailySummary[] = Array.from(byDayMap.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, group]) => ({
      date,
      tokens: group.tokens,
      costUsd: Math.round(group.costUsd * 1e4) / 1e4,
      uncachedInputTokens: group.uncachedInputTokens,
      cachedInputTokens: group.cachedInputTokens,
      cacheCreationTokens: group.cacheCreationTokens,
      outputTokens: group.outputTokens,
      sessions: group.sessions.size,
    }))

  const summary: ScannedUsageSummary = {
    totalTokens,
    uncachedInputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    reasoningTokens,
    costUsd: Math.round(costUsd * 1e4) / 1e4,
    cacheSavingsUsd: Math.round(cacheSavingsUsd * 1e4) / 1e4,
    sessionCount: sessionIds.size,
    byProvider,
    byModel,
    byDay,
  }

  // Format events to mirror Sayabot DB usage_events
  const events: ScannedUsageEventRow[] = records.map((r) => ({
    agent_id: null,
    room_id: null,
    provider: r.provider,
    model: r.model,
    input_tokens: r.totals.uncachedInputTokens + r.totals.cachedInputTokens,
    output_tokens: r.totals.outputTokens,
    cached_input_tokens: r.totals.cachedInputTokens,
    cost_usd: r.costUsd,
    ttft_ms: null,
    latency_ms: null,
    created_at: r.createdAt,
  }))

  const limits = estimateLocalLimits(records)

  return {
    records,
    summary,
    events,
    limits,
    scannedAt: new Date().toISOString(),
    providersScanned: activeProviders,
  }
}
