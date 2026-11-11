import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import readline from "node:readline"
import type { LocalProvider, ScannedUsageRecord, UsageSpeed, UsageTokenTotals } from "./types"
import { computeUsageCacheSavings, computeUsageCost, getModelPrice } from "./pricing"

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

function parseCodexSpeed(serviceTier: unknown): UsageSpeed {
  if (serviceTier === "priority" || serviceTier === "fast") return "fast"
  if (serviceTier === "ultrafast") return "ultrafast"
  return "standard"
}

interface RawCodexUsage {
  input_tokens: number
  cached_input_tokens: number
  cache_write_input_tokens: number
  output_tokens: number
  reasoning_output_tokens: number
  total_tokens: number
}

function extractCodexUsage(raw: any): RawCodexUsage | null {
  if (typeof raw !== "object" || raw === null) return null
  const input = tokenCount(raw.input_tokens)
  const output = tokenCount(raw.output_tokens)
  if (input === 0 && output === 0) return null

  return {
    input_tokens: input,
    cached_input_tokens: tokenCount(raw.cached_input_tokens),
    cache_write_input_tokens: tokenCount(raw.cache_write_input_tokens),
    output_tokens: output,
    reasoning_output_tokens: tokenCount(raw.reasoning_output_tokens),
    total_tokens: tokenCount(raw.total_tokens) || input + output,
  }
}

/** Scans a single Codex session JSONL file */
export async function scanCodexFile(
  filePath: string,
  sinceMs: number = 0,
): Promise<ScannedUsageRecord[]> {
  const fallbackSessionId = path.basename(filePath, ".jsonl")
  let currentSessionId = fallbackSessionId
  let currentModel = ""
  let currentSpeed: UsageSpeed = "standard"
  let currentTurnId = ""
  let isForked = false
  let forkAnchorMs = 0

  const usageRecords: ScannedUsageRecord[] = []
  const tokenCountFallbacks: Array<{
    timestampMs: number
    model: string
    turnId: string
    speed: UsageSpeed
    usage: RawCodexUsage
  }> = []

  let hasTokenUsageRecords = false

  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" })
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity })

  let lineIndex = 0
  for await (const line of rl) {
    lineIndex++
    if (!line) continue

    // Fast filter: check for keywords
    if (
      !line.includes('"session_meta"') &&
      !line.includes('"turn_context"') &&
      !line.includes('"thread_settings_applied"') &&
      !line.includes('"token_usage_record"') &&
      !line.includes('"token_count"')
    ) {
      continue
    }

    let parsed: any
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    if (typeof parsed !== "object" || parsed === null) continue
    const payload = parsed.payload ?? {}
    const timestampMs = parseTimestampMs(parsed.timestamp) ?? 0

    if (parsed.type === "session_meta") {
      const id = payload.id ?? payload.session_id
      if (typeof id === "string" && id) currentSessionId = id

      // Check if forked from parent session
      if (
        typeof payload.forked_from_id === "string" ||
        payload.source?.subagent?.thread_spawn?.parent_thread_id
      ) {
        isForked = true
        forkAnchorMs = timestampMs
      }
      continue
    }

    if (parsed.type === "turn_context") {
      if (typeof payload.model === "string" && payload.model) {
        currentModel = payload.model
      }
      if (typeof payload.turn_id === "string") {
        currentTurnId = payload.turn_id
      }
      continue
    }

    if (payload.type === "thread_settings_applied") {
      const tier = payload.thread_settings?.service_tier
      if (tier) currentSpeed = parseCodexSpeed(tier)
      if (typeof payload.thread_settings?.model === "string" && payload.thread_settings.model) {
        currentModel = payload.thread_settings.model
      }
      continue
    }

    // Suppress copied history burst in forked sessions (events within 1000ms of fork anchor)
    if (isForked && timestampMs - forkAnchorMs < 1000) {
      continue
    }
    if (isForked && timestampMs - forkAnchorMs >= 1000) {
      isForked = false
    }

    if (parsed.type === "token_usage_record") {
      hasTokenUsageRecords = true
      const rawUsage = extractCodexUsage(payload.usage)
      if (!rawUsage || timestampMs < sinceMs) continue

      const model = currentModel || "codex-default"
      const uncachedInputTokens = Math.max(
        0,
        rawUsage.input_tokens - rawUsage.cached_input_tokens - rawUsage.cache_write_input_tokens,
      )

      const totals: UsageTokenTotals = {
        uncachedInputTokens,
        cachedInputTokens: rawUsage.cached_input_tokens,
        cacheCreationTokens: rawUsage.cache_write_input_tokens,
        outputTokens: rawUsage.output_tokens,
        reasoningTokens: rawUsage.reasoning_output_tokens,
      }

      const turnId = payload.turn_id || currentTurnId || `${lineIndex}`
      const dedupeKey = `codex:${currentSessionId}:${turnId}:${timestampMs}`
      const price = getModelPrice(model)
      const costUsd = computeUsageCost(totals, price, currentSpeed)
      const cacheSavingsUsd = computeUsageCacheSavings(totals, price)
      const date = new Date(timestampMs)

      usageRecords.push({
        id: dedupeKey,
        provider: "codex" as LocalProvider,
        sessionId: currentSessionId,
        timestampMs,
        isoDate: date.toISOString().slice(0, 10),
        createdAt: date.toISOString(),
        model,
        totals,
        costUsd,
        cacheSavingsUsd,
        reportedCostUsd: null,
        speed: currentSpeed,
        dedupeKey,
      })
      continue
    }

    if (payload.type === "token_count") {
      const lastUsage = extractCodexUsage(payload.info?.last_token_usage)
      if (lastUsage && timestampMs >= sinceMs) {
        tokenCountFallbacks.push({
          timestampMs,
          model: currentModel || "codex-default",
          turnId: currentTurnId || `${lineIndex}`,
          speed: currentSpeed,
          usage: lastUsage,
        })
      }
    }
  }

  // If the file did not contain any modern token_usage_record entries, use token_count fallbacks
  if (!hasTokenUsageRecords && tokenCountFallbacks.length > 0) {
    for (const item of tokenCountFallbacks) {
      const uncachedInputTokens = Math.max(
        0,
        item.usage.input_tokens -
          item.usage.cached_input_tokens -
          item.usage.cache_write_input_tokens,
      )

      const totals: UsageTokenTotals = {
        uncachedInputTokens,
        cachedInputTokens: item.usage.cached_input_tokens,
        cacheCreationTokens: item.usage.cache_write_input_tokens,
        outputTokens: item.usage.output_tokens,
        reasoningTokens: item.usage.reasoning_output_tokens,
      }

      const dedupeKey = `codex:${currentSessionId}:${item.turnId}:${item.timestampMs}`
      const price = getModelPrice(item.model)
      const costUsd = computeUsageCost(totals, price, item.speed)
      const cacheSavingsUsd = computeUsageCacheSavings(totals, price)
      const date = new Date(item.timestampMs)

      usageRecords.push({
        id: dedupeKey,
        provider: "codex" as LocalProvider,
        sessionId: currentSessionId,
        timestampMs: item.timestampMs,
        isoDate: date.toISOString().slice(0, 10),
        createdAt: date.toISOString(),
        model: item.model,
        totals,
        costUsd,
        cacheSavingsUsd,
        reportedCostUsd: null,
        speed: item.speed,
        dedupeKey,
      })
    }
  }

  return usageRecords
}

/** Discovers and scans Codex JSONL session files on the system */
export async function scanCodexUsage(
  options: {
    sinceMs?: number
    directories?: string[]
  } = {},
): Promise<ScannedUsageRecord[]> {
  const home = os.homedir()
  const defaultBaseDirs = [
    path.join(home, ".codex", "sessions"),
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

      const scanDir = (dir: string, depth: number) => {
        if (depth > 5) return
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
              if (sinceMs > 0 && entryStat.mtimeMs < sinceMs - 24 * 3600 * 1000) {
                continue
              }
              filesToScan.push(fullPath)
            }
          } catch {
            // ignore
          }
        }
      }

      scanDir(baseDir, 0)
    } catch {
      // ignore
    }
  }

  const allRecords: ScannedUsageRecord[] = []
  const seenIds = new Set<string>()

  for (const file of filesToScan) {
    try {
      const records = await scanCodexFile(file, sinceMs)
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
