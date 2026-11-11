import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import readline from "node:readline"
import type { LocalProvider, ScannedUsageRecord, UsageTokenTotals } from "./types"
import { computeUsageCacheSavings, computeUsageCost, getModelPrice } from "./pricing"

export const CLAUDE_SYNTHETIC_MODEL = "<synthetic>"

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string") return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

interface RawClaudeEntry {
  sessionId: string
  timestampMs: number
  model: string
  totals: UsageTokenTotals
  reportedCostUsd: number | null
  speed: "standard" | "fast" | "ultrafast"
  dedupeKey: string
}

/** Parses a single line from a Claude Code session JSONL file */
export function parseClaudeLine(
  line: string,
  fallbackSessionId: string,
): RawClaudeEntry[] {
  if (!line.includes('"usage"')) return []

  let record: any
  try {
    record = JSON.parse(line)
  } catch {
    return []
  }

  if (typeof record !== "object" || record === null) return []
  if (record.type !== "assistant") return []

  const message = record.message
  if (typeof message !== "object" || message === null) return []

  const usage = message.usage
  if (typeof usage !== "object" || usage === null) return []

  const timestampMs = parseTimestampMs(record.timestamp)
  if (timestampMs === null) return []

  const model = typeof message.model === "string" ? message.model.trim() : ""
  if (!model || model === CLAUDE_SYNTHETIC_MODEL) return []

  const sessionId =
    (typeof record.sessionId === "string" && record.sessionId) ||
    (typeof record.session_id === "string" && record.session_id) ||
    fallbackSessionId

  const messageId = typeof message.id === "string" ? message.id : null
  const requestId = typeof record.requestId === "string" ? record.requestId : null
  const dedupeKey =
    messageId || requestId
      ? `${messageId ?? ""}:${requestId ?? ""}`
      : `claude:${sessionId}:${timestampMs}`

  const reportedCost =
    typeof record.costUSD === "number" && Number.isFinite(record.costUSD)
      ? record.costUSD
      : null

  const thinkingTokens =
    tokenCount(usage.output_tokens_details?.thinking_tokens) ||
    tokenCount(usage.thinking_tokens)

  const executorTotals: UsageTokenTotals = {
    uncachedInputTokens: tokenCount(usage.input_tokens),
    cachedInputTokens: tokenCount(usage.cache_read_input_tokens),
    cacheCreationTokens: tokenCount(usage.cache_creation_input_tokens),
    outputTokens: tokenCount(usage.output_tokens),
    reasoningTokens: thinkingTokens,
  }

  const speed = usage.speed === "fast" ? "fast" : "standard"

  const entries: RawClaudeEntry[] = [
    {
      sessionId,
      timestampMs,
      model,
      totals: executorTotals,
      reportedCostUsd: reportedCost,
      speed,
      dedupeKey,
    },
  ]

  // Advisor iterations (e.g. multi-model advisor steps)
  if (Array.isArray(usage.iterations)) {
    for (let i = 0; i < usage.iterations.length; i++) {
      const iteration = usage.iterations[i]
      if (typeof iteration !== "object" || iteration === null) continue
      if (iteration.type !== "advisor_message") continue

      const advisorModel = typeof iteration.model === "string" ? iteration.model.trim() : ""
      if (!advisorModel || advisorModel === CLAUDE_SYNTHETIC_MODEL) continue

      entries.push({
        sessionId,
        timestampMs,
        model: advisorModel,
        totals: {
          uncachedInputTokens: tokenCount(iteration.input_tokens),
          cachedInputTokens: tokenCount(iteration.cache_read_input_tokens),
          cacheCreationTokens: tokenCount(iteration.cache_creation_input_tokens),
          outputTokens: tokenCount(iteration.output_tokens),
          reasoningTokens: tokenCount(iteration.thinking_tokens),
        },
        reportedCostUsd: null,
        speed,
        dedupeKey: `${dedupeKey}:advisor:${i}`,
      })
    }
  }

  return entries
}

/** Scans a single Claude Code session JSONL file synchronously or via streaming */
export async function scanClaudeFile(
  filePath: string,
  sinceMs: number = 0,
): Promise<ScannedUsageRecord[]> {
  const fallbackSessionId = path.basename(filePath, ".jsonl")
  const dedupeMap = new Map<string, RawClaudeEntry>()

  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" })
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity })

  for await (const line of rl) {
    if (!line) continue
    const entries = parseClaudeLine(line, fallbackSessionId)
    for (const entry of entries) {
      if (entry.timestampMs < sinceMs) continue

      const existing = dedupeMap.get(entry.dedupeKey)
      if (existing) {
        // Claude Code can stream progressive partial blocks; take the max of each channel
        existing.totals.uncachedInputTokens = Math.max(
          existing.totals.uncachedInputTokens,
          entry.totals.uncachedInputTokens,
        )
        existing.totals.cachedInputTokens = Math.max(
          existing.totals.cachedInputTokens,
          entry.totals.cachedInputTokens,
        )
        existing.totals.cacheCreationTokens = Math.max(
          existing.totals.cacheCreationTokens,
          entry.totals.cacheCreationTokens,
        )
        existing.totals.outputTokens = Math.max(
          existing.totals.outputTokens,
          entry.totals.outputTokens,
        )
        existing.totals.reasoningTokens = Math.max(
          existing.totals.reasoningTokens,
          entry.totals.reasoningTokens,
        )
        if (entry.reportedCostUsd !== null) {
          existing.reportedCostUsd = Math.max(
            existing.reportedCostUsd ?? 0,
            entry.reportedCostUsd,
          )
        }
      } else {
        dedupeMap.set(entry.dedupeKey, entry)
      }
    }
  }

  const records: ScannedUsageRecord[] = []
  for (const entry of dedupeMap.values()) {
    const totalTokens =
      entry.totals.uncachedInputTokens +
      entry.totals.cachedInputTokens +
      entry.totals.cacheCreationTokens +
      entry.totals.outputTokens

    if (totalTokens === 0) continue

    const price = getModelPrice(entry.model)
    const computedCost = computeUsageCost(entry.totals, price, entry.speed)
    const costUsd =
      entry.reportedCostUsd !== null && entry.reportedCostUsd > 0
        ? entry.reportedCostUsd
        : computedCost
    const cacheSavingsUsd = computeUsageCacheSavings(entry.totals, price)
    const date = new Date(entry.timestampMs)

    records.push({
      id: `claude:${entry.dedupeKey}`,
      provider: "claude" as LocalProvider,
      sessionId: entry.sessionId,
      timestampMs: entry.timestampMs,
      isoDate: date.toISOString().slice(0, 10),
      createdAt: date.toISOString(),
      model: entry.model,
      totals: entry.totals,
      costUsd,
      cacheSavingsUsd,
      reportedCostUsd: entry.reportedCostUsd,
      speed: entry.speed,
      dedupeKey: entry.dedupeKey,
    })
  }

  return records
}

/** Discovers and scans Claude Code JSONL files on the system */
export async function scanClaudeUsage(
  options: {
    sinceMs?: number
    directories?: string[]
  } = {},
): Promise<ScannedUsageRecord[]> {
  const home = os.homedir()
  const defaultBaseDirs = [
    path.join(home, ".claude", "projects"),
    path.join(home, ".config", "claude", "projects"),
  ]

  const dirsToSearch =
    options.directories && options.directories.length > 0
      ? options.directories
      : defaultBaseDirs

  const sinceMs = options.sinceMs ?? 0
  const filesToScan: string[] = []

  for (const baseDir of dirsToSearch) {
    if (!fs.existsSync(baseDir)) continue
    try {
      const stat = fs.statSync(baseDir)
      if (stat.isFile() && baseDir.endsWith(".jsonl")) {
        filesToScan.push(baseDir)
        continue
      }
      if (!stat.isDirectory()) continue

      // Search recursively up to depth 3
      const scanDir = (dir: string, depth: number) => {
        if (depth > 3) return
        let entries: string[] = []
        try {
          entries = fs.readdirSync(dir)
        } catch {
          return
        }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry)
          try {
            const entryStat = fs.statSync(fullPath)
            if (entryStat.isDirectory()) {
              scanDir(fullPath, depth + 1)
            } else if (entryStat.isFile() && entry.endsWith(".jsonl")) {
              // Quick mtime check to skip files older than sinceMs
              if (sinceMs > 0 && entryStat.mtimeMs < sinceMs - 24 * 3600 * 1000) {
                continue
              }
              filesToScan.push(fullPath)
            }
          } catch {
            // ignore stat failure
          }
        }
      }

      scanDir(baseDir, 0)
    } catch {
      // ignore directory access error
    }
  }

  const allRecords: ScannedUsageRecord[] = []
  const seenIds = new Set<string>()

  for (const file of filesToScan) {
    try {
      const records = await scanClaudeFile(file, sinceMs)
      for (const rec of records) {
        if (!seenIds.has(rec.id)) {
          seenIds.add(rec.id)
          allRecords.push(rec)
        }
      }
    } catch {
      // ignore single file parse failure
    }
  }

  return allRecords.sort((a, b) => a.timestampMs - b.timestampMs)
}
