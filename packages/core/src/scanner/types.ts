export type { ModelPrice } from "../cost"

export type LocalProvider = "antigravity" | "claude" | "codex" | "cursor" | "opencode" | "other"

export type UsageSpeed = "standard" | "fast" | "ultrafast"

export interface UsageTokenTotals {
  uncachedInputTokens: number
  cachedInputTokens: number
  cacheCreationTokens: number
  outputTokens: number
  reasoningTokens: number
}


export interface ScannedUsageRecord {
  id: string
  provider: LocalProvider
  sessionId: string
  timestampMs: number
  isoDate: string
  createdAt: string
  model: string
  rateModel?: string
  totals: UsageTokenTotals
  costUsd: number
  cacheSavingsUsd: number
  reportedCostUsd: number | null
  speed: UsageSpeed
  dedupeKey: string | null
}

export interface ProviderSummary {
  provider: string
  tokens: number
  costUsd: number
  cacheSavingsUsd: number
  sessions: number
  sharePercent: number
  tokenMix: {
    uncachedInputTokens: number
    cachedInputTokens: number
    cacheCreationTokens: number
    outputTokens: number
    reasoningTokens: number
  }
}

export interface ModelSummary {
  model: string
  provider: string
  tokens: number
  costUsd: number
  sessions: number
  sharePercent: number
}

export interface DailySummary {
  date: string
  tokens: number
  costUsd: number
  uncachedInputTokens: number
  cachedInputTokens: number
  cacheCreationTokens: number
  outputTokens: number
  sessions: number
}

export interface ScannedUsageSummary {
  totalTokens: number
  uncachedInputTokens: number
  cachedInputTokens: number
  cacheCreationTokens: number
  outputTokens: number
  reasoningTokens: number
  costUsd: number
  cacheSavingsUsd: number
  sessionCount: number
  byProvider: Record<string, ProviderSummary>
  byModel: Record<string, ModelSummary>
  byDay: DailySummary[]
}

/** Formatted identically to Sayabot DB usage_events rows for instant drop-in dashboard compatibility */
export interface ScannedUsageEventRow {
  agent_id: string | null
  room_id: string | null
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  cost_usd: number
  ttft_ms: number | null
  latency_ms: number | null
  created_at: string
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

export interface ScanOptions {
  days?: number
  sinceMs?: number
  antigravityDirs?: string[]
  claudeDirs?: string[]
  codexDirs?: string[]
  includeProviders?: LocalProvider[]
}

export interface ScannedUsageResult {
  records: ScannedUsageRecord[]
  summary: ScannedUsageSummary
  events: ScannedUsageEventRow[]
  limits: ProviderLimitGroup[]
  scannedAt: string
  providersScanned: LocalProvider[]
}

