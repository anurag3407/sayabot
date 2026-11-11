import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { DatabaseSync } from "node:sqlite"
import type { LocalProvider, ScannedUsageRecord, UsageTokenTotals } from "./types"
import { computeUsageCacheSavings, computeUsageCost, getModelPrice } from "./pricing"

export const ANTIGRAVITY_MODEL_IDS: Record<number, string> = {
  246: "gemini-2.5-pro",
  312: "gemini-2.5-flash",
  313: "gemini-2.5-flash-thinking",
  329: "gemini-2.5-flash-thinking",
  330: "gemini-2.5-flash-lite",
  281: "claude-sonnet-4",
  282: "claude-sonnet-4",
  290: "claude-opus-4",
  291: "claude-opus-4",
  333: "claude-sonnet-4-5",
  334: "claude-sonnet-4-5",
  340: "claude-haiku-4-5",
  341: "claude-haiku-4-5",
  342: "gpt-oss-120b-medium",
  1026: "claude-opus-4-6",
  1035: "claude-sonnet-4-6",
  1016: "gemini-3.1-pro",
  1036: "gemini-3.1-pro",
  1037: "gemini-3.1-pro",
  1018: "gemini-3-flash-preview",
  1084: "gemini-3-flash-preview",
  1047: "gemini-3-flash-preview",
  1020: "gemini-3.5-flash-medium",
  1021: "gemini-3.1-flash-image",
  1050: "gemini-3.1-flash-lite",
  1071: "gemini-3.6-flash-high",
  1072: "gemini-3.6-flash-medium",
  1073: "gemini-3.6-flash-low",
  1132: "gemini-3.5-flash-high",
  1133: "gemini-3.5-flash-high",
  1187: "gemini-3.5-flash-extra-low",
  1196: "gemini-3.6-flash",
  1266: "gemini-3.6-flash",
  1298: "gemini-3.7-flash-high",
  1299: "gemini-3.7-flash-medium",
  1300: "gemini-3.7-flash-low",
  1301: "gemini-3.7-flash-tiered",
  1318: "gemini-3.8-flash-high",
  1319: "gemini-3.8-flash-medium",
  1320: "gemini-3.8-flash-low",
  1322: "gemini-3.8-flash-tiered",
  1402: "claude-opus-5-5",
  1417: "gemini-4-argon",
  1418: "gemini-4-argon",
  1419: "gemini-4-argon",
}

type FieldValue = number | bigint | Uint8Array
type Fields = Map<number, FieldValue[]>

export function parseProtobufFields(bytes: Uint8Array): Fields {
  let offset = 0
  const result: Fields = new Map()

  const readVarint = () => {
    let value = 0n
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= bytes.length) {
        throw new Error("Truncated varint in Antigravity protobuf")
      }
      const byte = bytes[offset++]!
      value |= BigInt(byte & 127) << shift
      if (byte < 128) {
        return value > BigInt(Number.MAX_SAFE_INTEGER) ? value : Number(value)
      }
    }
    throw new Error("Varint exceeds 70 bits in Antigravity protobuf")
  }

  while (offset < bytes.length) {
    const tag = readVarint()
    if (typeof tag !== "number") throw new Error("Invalid protobuf tag")
    const number = Math.floor(tag / 8)
    const wire = tag % 8
    if (number === 0) throw new Error("Invalid field number 0")

    let value: FieldValue
    if (wire === 0) {
      value = readVarint()
    } else if (wire === 1) {
      // 64-bit fixed
      if (offset + 8 > bytes.length) throw new Error("Truncated 64-bit field")
      value = bytes.subarray(offset, offset + 8)
      offset += 8
    } else if (wire === 5) {
      // 32-bit fixed
      if (offset + 4 > bytes.length) throw new Error("Truncated 32-bit field")
      value = bytes.subarray(offset, offset + 4)
      offset += 4
    } else if (wire === 2) {
      // length-delimited
      const length = readVarint()
      if (typeof length !== "number") throw new Error("Invalid field length")
      if (offset + length > bytes.length) throw new Error("Truncated length-delimited field")
      value = bytes.subarray(offset, offset + length)
      offset += length
    } else {
      // Wire types 3 and 4 (start/end group) are deprecated; skip or error
      break
    }

    const entries = result.get(number) ?? []
    entries.push(value)
    result.set(number, entries)
  }

  return result
}

const numberAt = (fields: Fields, key: number): number => {
  const entry = fields.get(key)?.[0]
  return typeof entry === "number" ? entry : 0
}

const bytesAt = (fields: Fields, key: number): Uint8Array | undefined => {
  const entry = fields.get(key)?.[0]
  return entry instanceof Uint8Array ? entry : undefined
}

const nested = (fields: Fields, key: number): Fields => {
  const bytes = bytesAt(fields, key)
  return bytes === undefined ? new Map() : parseProtobufFields(bytes)
}

const textAt = (fields: Fields, key: number): string => {
  const bytes = bytesAt(fields, key)
  if (!bytes) return ""
  try {
    return new TextDecoder("utf-8").decode(bytes).trim()
  } catch {
    return ""
  }
}

const timestampFromFields = (fields: Fields): number | null => {
  const seconds = numberAt(fields, 1)
  if (seconds > 0) {
    const nanos = numberAt(fields, 2)
    return seconds * 1000 + Math.floor(nanos / 1_000_000)
  }
  return null
}

function normalizeAntigravityModel(name: string): string {
  if (!name) return ""
  const normalized = name
    .toLowerCase()
    .replace(/\s*\(([^)]*)\)\s*$/, "-$1")
    .replace(/\s+/g, "-")
  if (normalized.startsWith("claude-")) {
    return normalized
      .replace(/^claude-(\d+(?:\.\d+)?)-(sonnet|opus|haiku)/, "claude-$2-$1")
      .replaceAll(".", "-")
  }
  return normalized
}

function isConcreteModel(model: string): boolean {
  return (
    /^(?:gemini-\d|claude-(?:sonnet|opus|haiku)-\d|gpt-)/.test(model) &&
    !/^gemini-3-flash-(?:agent(?:-[ab])?|[ab])$/.test(model)
  )
}

interface MetadataResult {
  model: string
  modelId: number
  timestampMs: number | null
  usages: Fields[]
}

function parseMetadata(bytes: Uint8Array, step: boolean): MetadataResult {
  const root = parseProtobufFields(bytes)
  const data = step ? root : nested(root, 1)
  const modelNode = step ? nested(data, 24) : data
  const usageBytes = bytesAt(data, step ? 9 : 4)

  const usages: Fields[] = []
  if (usageBytes) {
    try {
      usages.push(parseProtobufFields(usageBytes))
    } catch {
      // skip corrupted usage sub-blob
    }
  }

  // Parse retries
  const retries = data.get(step ? 28 : 17) ?? []
  for (const retry of retries) {
    if (retry instanceof Uint8Array) {
      try {
        const retryFields = parseProtobufFields(retry)
        const retryUsageBytes = bytesAt(retryFields, 2)
        if (retryUsageBytes) {
          usages.push(parseProtobufFields(retryUsageBytes))
        }
      } catch {
        // ignore retry decode error
      }
    }
  }

  const candidateNames = [
    textAt(modelNode, step ? 12 : 19),
    textAt(modelNode, step ? 8 : 21),
  ].map(normalizeAntigravityModel)

  const concrete = candidateNames.find(isConcreteModel)
  const named = candidateNames.find((n) => n && !/^model[_-]/.test(n))
  const model = concrete ?? named ?? ""

  const modelId =
    numberAt(modelNode, step ? 1 : 3) ||
    (usages.length > 0 ? numberAt(usages[0]!, 1) : 0)

  const timestampMs = step
    ? (timestampFromFields(nested(data, 8)) ?? timestampFromFields(nested(data, 1)))
    : timestampFromFields(nested(nested(data, 9), 4))

  return { model, modelId, timestampMs, usages }
}

interface RawCandidate {
  record: {
    sessionId: string
    timestampMs: number
    model: string
    totals: UsageTokenTotals
    dedupeKey: string
  }
  modelId: number
  modelQuality: number // 4: concrete, 3: learned, 2: mapped ID, 1: text, 0: unknown
  keys: string[]
  timestampQuality: number // 2: step, 1: traj, 0: file
}

/** Disjoint set union to deduplicate records */
function deduplicateCandidates(
  candidates: RawCandidate[],
  learnedModels: Map<number, string>,
): RawCandidate[] {
  const n = candidates.length
  const parent = Array.from({ length: n }, (_, i) => i)

  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root]!
    let curr = i
    while (curr !== root) {
      const next = parent[curr]!
      parent[curr] = root
      curr = next
    }
    return root
  }

  const union = (i: number, j: number) => {
    const rootI = find(i)
    const rootJ = find(j)
    if (rootI !== rootJ) {
      parent[rootJ] = rootI
    }
  }

  // Key to index map
  const keyToIdx = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const c = candidates[i]!
    for (const k of c.keys) {
      const existing = keyToIdx.get(k)
      if (existing !== undefined) {
        union(existing, i)
      } else {
        keyToIdx.set(k, i)
      }
    }
  }

  // Group by root
  const groups = new Map<number, RawCandidate[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(candidates[i]!)
    groups.set(root, list)
  }

  const results: RawCandidate[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      results.push(group[0]!)
      continue
    }

    // Merge group
    let bestModel = ""
    let bestModelQuality = -1
    let bestTimestamp = 0
    let bestTimestampQuality = -1
    let bestDedupeKey = group[0]!.record.dedupeKey
    let sessionId = group[0]!.record.sessionId

    let maxUncached = 0
    let maxCached = 0
    let maxCreation = 0
    let maxOutput = 0
    let maxReasoning = 0

    for (const item of group) {
      const t = item.record.totals
      maxUncached = Math.max(maxUncached, t.uncachedInputTokens)
      maxCached = Math.max(maxCached, t.cachedInputTokens)
      maxCreation = Math.max(maxCreation, t.cacheCreationTokens)
      maxOutput = Math.max(maxOutput, t.outputTokens)
      maxReasoning = Math.max(maxReasoning, t.reasoningTokens)

      if (item.modelQuality > bestModelQuality || (item.modelQuality === bestModelQuality && item.record.model)) {
        bestModelQuality = item.modelQuality
        bestModel = item.record.model
      }

      if (item.timestampQuality > bestTimestampQuality) {
        bestTimestampQuality = item.timestampQuality
        bestTimestamp = item.record.timestampMs
      }
      if (item.record.dedupeKey.startsWith("antigravity:id:")) {
        bestDedupeKey = item.record.dedupeKey
      }
    }

    // Fallback model resolution if empty
    if (!bestModel && group[0]!.modelId > 0) {
      bestModel =
        learnedModels.get(group[0]!.modelId) ||
        ANTIGRAVITY_MODEL_IDS[group[0]!.modelId] ||
        `antigravity-model-${group[0]!.modelId}`
    }

    results.push({
      record: {
        sessionId,
        timestampMs: bestTimestamp,
        model: bestModel || "antigravity-unknown",
        totals: {
          uncachedInputTokens: maxUncached,
          cachedInputTokens: maxCached,
          cacheCreationTokens: maxCreation,
          outputTokens: maxOutput,
          reasoningTokens: maxReasoning,
        },
        dedupeKey: bestDedupeKey,
      },
      modelId: group[0]!.modelId,
      modelQuality: bestModelQuality,
      keys: group.flatMap((g) => g.keys),
      timestampQuality: bestTimestampQuality,
    })
  }

  return results
}

/** Scans a single Antigravity SQLite database file */
export function scanAntigravityDatabase(
  dbPath: string,
  sinceMs: number = 0,
): ScannedUsageRecord[] {
  let db: DatabaseSync | null = null
  try {
    const stat = fs.statSync(dbPath)
    if (sinceMs > 0 && stat.mtimeMs < sinceMs - 24 * 3600 * 1000) {
      return []
    }
    const fallbackTimestamp = stat.mtimeMs
    const sessionId = path.basename(dbPath, ".db")

    db = new DatabaseSync(dbPath, { readOnly: true })

    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r: any) => String(r.name)),
    )

    if (!tables.has("gen_metadata") && !tables.has("steps")) {
      return []
    }

    // Check trajectory timestamp if available
    let trajectoryTimestamp: number | null = null
    if (tables.has("trajectory_metadata_blob")) {
      try {
        const trajRows = db
          .prepare("SELECT data FROM trajectory_metadata_blob LIMIT 1")
          .all() as any[]
        if (trajRows.length > 0 && trajRows[0]?.data) {
          const tf = parseProtobufFields(new Uint8Array(trajRows[0].data))
          trajectoryTimestamp = timestampFromFields(nested(tf, 2))
        }
      } catch {
        // ignore traj blob parse error
      }
    }

    // Read gen_metadata rows
    const genEntries: Array<{ idx: number; metadata: MetadataResult }> = []
    if (tables.has("gen_metadata")) {
      try {
        const rows = db
          .prepare("SELECT idx, data FROM gen_metadata WHERE data IS NOT NULL ORDER BY idx ASC")
          .all() as any[]
        for (const r of rows) {
          if (typeof r.idx === "number" && r.data) {
            try {
              const meta = parseMetadata(new Uint8Array(r.data), false)
              genEntries.push({ idx: r.idx, metadata: meta })
            } catch {
              // skip unparseable row
            }
          }
        }
      } catch {
        // ignore gen_metadata query failure
      }
    }

    // Read steps rows
    const stepEntries: Array<{ idx: number; metadata: MetadataResult }> = []
    if (tables.has("steps")) {
      try {
        const rows = db
          .prepare("SELECT idx, metadata FROM steps WHERE metadata IS NOT NULL ORDER BY idx ASC")
          .all() as any[]
        for (const r of rows) {
          if (typeof r.idx === "number" && r.metadata) {
            try {
              const meta = parseMetadata(new Uint8Array(r.metadata), true)
              stepEntries.push({ idx: r.idx, metadata: meta })
            } catch {
              // skip unparseable step
            }
          }
        }
      } catch {
        // ignore steps query failure
      }
    }

    // Learn model names from concrete entries
    const learnedModels = new Map<number, string>()
    for (const { metadata } of [...genEntries, ...stepEntries]) {
      if (metadata.modelId > 0 && isConcreteModel(metadata.model)) {
        learnedModels.set(metadata.modelId, metadata.model)
      }
    }

    // Map generations by idx for matching
    const genByIdx = new Map(genEntries.map((g) => [g.idx, g.metadata]))

    const candidates: RawCandidate[] = []

    // Process step and generation entries
    const allSources = [
      { source: "step", entries: stepEntries },
      { source: "gen", entries: genEntries },
    ]

    for (const { source, entries } of allSources) {
      for (const { idx, metadata } of entries) {
        for (let uIdx = 0; uIdx < metadata.usages.length; uIdx++) {
          const usage = metadata.usages[uIdx]!
          const modelId = numberAt(usage, 1) || metadata.modelId

          const gen = source === "step" ? genByIdx.get(idx) : undefined
          const model =
            (metadata.model && (modelId === 0 || metadata.modelId === modelId)
              ? metadata.model
              : gen?.model && (modelId === 0 || gen.modelId === modelId)
                ? gen.model
                : "") ||
            learnedModels.get(modelId) ||
            ANTIGRAVITY_MODEL_IDS[modelId] ||
            (modelId > 0 ? `antigravity-model-${modelId}` : "antigravity-unknown")

          const outputTokens = Math.max(
            numberAt(usage, 3),
            numberAt(usage, 9) + numberAt(usage, 10),
          )
          const uncachedInputTokens = numberAt(usage, 2)
          const cachedInputTokens = numberAt(usage, 5)
          const cacheCreationTokens = numberAt(usage, 4)
          const reasoningTokens = Math.min(outputTokens, numberAt(usage, 9))

          if (uncachedInputTokens + cachedInputTokens + cacheCreationTokens + outputTokens === 0) {
            continue
          }

          // Extract identity keys from fields 11, 12, 7
          const idKeys = ([11, 12, 7] as const)
            .map((k) => textAt(usage, k))
            .filter((t) => t.length > 0)
            .map((id) => `antigravity:id:${id}`)

          // Composite key
          const compositeKey = `antigravity:${sessionId}:${idx}:${uIdx}`
          const keys = idKeys.length > 0 ? [...idKeys, compositeKey] : [compositeKey]

          const timestampMs =
            metadata.timestampMs ?? trajectoryTimestamp ?? fallbackTimestamp

          candidates.push({
            record: {
              sessionId,
              timestampMs,
              model,
              totals: {
                uncachedInputTokens,
                cachedInputTokens,
                cacheCreationTokens,
                outputTokens,
                reasoningTokens,
              },
              dedupeKey: idKeys[0] ?? compositeKey,
            },
            modelId,
            modelQuality: isConcreteModel(model) ? 4 : model ? 2 : 0,
            keys,
            timestampQuality:
              metadata.timestampMs !== null ? 2 : trajectoryTimestamp !== null ? 1 : 0,
          })
        }
      }
    }

    const deduplicated = deduplicateCandidates(candidates, learnedModels)

    // Filter by sinceMs and map to ScannedUsageRecord
    const records: ScannedUsageRecord[] = []
    for (const item of deduplicated) {
      if (item.record.timestampMs < sinceMs) continue

      const price = getModelPrice(item.record.model)
      const costUsd = computeUsageCost(item.record.totals, price)
      const cacheSavingsUsd = computeUsageCacheSavings(item.record.totals, price)
      const date = new Date(item.record.timestampMs)

      records.push({
        id: item.record.dedupeKey,
        provider: "antigravity" as LocalProvider,
        sessionId: item.record.sessionId,
        timestampMs: item.record.timestampMs,
        isoDate: date.toISOString().slice(0, 10),
        createdAt: date.toISOString(),
        model: item.record.model,
        totals: item.record.totals,
        costUsd,
        cacheSavingsUsd,
        reportedCostUsd: null,
        speed: "standard",
        dedupeKey: item.record.dedupeKey,
      })
    }

    return records
  } catch {
    return []
  } finally {
    if (db) {
      try {
        db.close()
      } catch {
        // ignore close error
      }
    }
  }
}

/** Discovers and scans Antigravity databases on the system */
export function scanAntigravityUsage(
  options: {
    sinceMs?: number
    directories?: string[]
  } = {},
): ScannedUsageRecord[] {
  const home = os.homedir()
  const customDirs = process.env.ANTIGRAVITY_DATA_DIR
    ? process.env.ANTIGRAVITY_DATA_DIR.split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => (p.endsWith("conversations") ? p : path.join(p, "conversations")))
    : []

  const defaultDirs = [
    ...customDirs,
    path.join(home, ".gemini", "antigravity", "conversations"),
    path.join(home, ".gemini", "antigravity-cli", "conversations"),
    path.join(home, ".gemini", "antigravity-ide", "conversations"),
    path.join(home, ".config", "antigravity", "conversations"),
  ]

  const dirsToSearch = options.directories && options.directories.length > 0
    ? options.directories
    : defaultDirs

  const sinceMs = options.sinceMs ?? 0
  const allRecords: ScannedUsageRecord[] = []
  const seenIds = new Set<string>()

  for (const dir of dirsToSearch) {
    if (!fs.existsSync(dir)) continue

    let entries: string[] = []
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.endsWith(".db")) continue
      const fullPath = path.join(dir, entry)
      try {
        if (sinceMs > 0) {
          const s = fs.statSync(fullPath)
          if (s.mtimeMs < sinceMs - 24 * 3600 * 1000) continue
        }
      } catch {
        continue
      }
      const records = scanAntigravityDatabase(fullPath, sinceMs)
      for (const rec of records) {
        if (!seenIds.has(rec.id)) {
          seenIds.add(rec.id)
          allRecords.push(rec)
        }
      }
    }
  }

  return allRecords.sort((a, b) => a.timestampMs - b.timestampMs)
}
