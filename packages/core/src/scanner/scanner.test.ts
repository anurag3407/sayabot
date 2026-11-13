import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { DatabaseSync } from "node:sqlite"
import {
  computeUsageCacheSavings,
  computeUsageCost,
  DEFAULT_FALLBACK_PRICE,
  getModelPrice,
  normalizeModelKey,
} from "./pricing"
import {
  ANTIGRAVITY_MODEL_IDS,
  parseProtobufFields,
  scanAntigravityDatabase,
  scanAntigravityUsage,
} from "./antigravity"
import { CLAUDE_SYNTHETIC_MODEL, parseClaudeLine, scanClaudeFile } from "./claude"
import { scanCodexFile } from "./codex"
import { scanLocalUsage } from "./index"

describe("Local Usage Scanner - Pricing", () => {
  it("normalizes model names and resolves rates correctly", () => {
    expect(normalizeModelKey("Claude-Opus-5-5")).toBe("claude-opus-5-5")
    expect(normalizeModelKey("anthropic/claude-3-5-sonnet[200k]")).toBe("claude-3-5-sonnet")
    expect(normalizeModelKey("google/gemini-2.5-pro")).toBe("gemini-2.5-pro")

    const geminiPrice = getModelPrice("gemini-3.8-flash-high")
    expect(geminiPrice.inputPerMtok).toBe(0.15)
    expect(geminiPrice.outputPerMtok).toBe(0.6)
    expect(geminiPrice.cacheReadPerMtok).toBe(0.0375)

    const claudePrice = getModelPrice("claude-opus-5-5")
    expect(claudePrice.inputPerMtok).toBe(15.0)
    expect(claudePrice.outputPerMtok).toBe(75.0)
    expect(claudePrice.cacheReadPerMtok).toBe(1.5)

    const codexPrice = getModelPrice("gpt-4o")
    expect(codexPrice.inputPerMtok).toBe(2.5)
    expect(codexPrice.outputPerMtok).toBe(10.0)

    const fallback = getModelPrice("completely-unrecognized-model-xyz")
    expect(fallback).toEqual(DEFAULT_FALLBACK_PRICE)
  })

  it("computes cost with prompt caching discounts and speeds", () => {
    const totals = {
      uncachedInputTokens: 100_000,
      cachedInputTokens: 900_000,
      cacheCreationTokens: 50_000,
      outputTokens: 20_000,
      reasoningTokens: 5_000,
    }
    const price = {
      inputPerMtok: 3.0,
      outputPerMtok: 15.0,
      cacheReadPerMtok: 0.3,
      cacheWritePerMtok: 3.75,
    }

    // uncached: 0.1 * 3 = 0.30
    // cached: 0.9 * 0.3 = 0.27
    // cacheCreation: 0.05 * 3.75 = 0.1875
    // output: 0.02 * 15 = 0.30
    // sum = 1.0575
    const cost = computeUsageCost(totals, price, "standard")
    expect(cost).toBe(1.0575)

    const costFast = computeUsageCost(totals, price, "fast")
    expect(costFast).toBe(Math.round(1.0575 * 1.5 * 1e6) / 1e6)

    const savings = computeUsageCacheSavings(totals, price)
    // 0.9 Mtok * ($3.00 - $0.30) = $2.43
    expect(savings).toBe(2.43)
  })
})

describe("Local Usage Scanner - Antigravity Protobuf & SQLite", () => {
  it("decodes protobuf varints and length-delimited wire types", () => {
    // Construct minimal protobuf payload:
    // field 1 (wire 0, varint 1318): tag = 1 * 8 + 0 = 8, varint 1318 = 0xA6, 0x0A
    // field 2 (wire 2, len 5, text "hello"): tag = 2 * 8 + 2 = 18, len 5, bytes "hello"
    const textBytes = new TextEncoder().encode("hello")
    const buffer = new Uint8Array([8, 0xa6, 0x0a, 18, 5, ...textBytes])

    const fields = parseProtobufFields(buffer)
    expect(fields.get(1)?.[0]).toBe(1318)
    const field2 = fields.get(2)?.[0] as Uint8Array
    expect(new TextDecoder().decode(field2)).toBe("hello")
  })

  it("maps model IDs accurately", () => {
    expect(ANTIGRAVITY_MODEL_IDS[1318]).toBe("gemini-3.8-flash-high")
    expect(ANTIGRAVITY_MODEL_IDS[1402]).toBe("claude-opus-5-5")
    expect(ANTIGRAVITY_MODEL_IDS[333]).toBe("claude-sonnet-4-5")
    expect(ANTIGRAVITY_MODEL_IDS[1016]).toBe("gemini-3.1-pro")
  })

  it("scans an Antigravity SQLite database cleanly with synthetic data", () => {
    const tmpDbPath = path.join(os.tmpdir(), `test-antigravity-${Date.now()}.db`)
    const db = new DatabaseSync(tmpDbPath)

    try {
      db.exec(`
        CREATE TABLE gen_metadata (rowid INTEGER PRIMARY KEY, idx INTEGER, data BLOB);
        CREATE TABLE steps (rowid INTEGER PRIMARY KEY, idx INTEGER, metadata BLOB);
        CREATE TABLE trajectory_metadata_blob (data BLOB);
      `)

      // Create a simulated gen_metadata row with protobuf usage
      // root: field 1 (nested data)
      // data: field 3 (varint modelId 1318), field 4 (usage bytes)
      // usage: field 1 (modelId 1318), field 2 (uncached 5000), field 3 (output 200), field 5 (cached 1000)
      const usageBuf = new Uint8Array([
        // field 1 = 1318
        8, 0xa6, 0x0a,
        // field 2 (uncachedInput = 5000: 5000 in varint = 0x88, 0x27)
        16, 0x88, 0x27,
        // field 3 (output = 200: 200 in varint = 0xc8, 0x01)
        24, 0xc8, 0x01,
        // field 5 (cached = 1000: 1000 in varint = 0xe8, 0x07)
        40, 0xe8, 0x07,
      ])

      // data contains field 3 (modelId 1318 = tag 24: 0xa6, 0x0a) and field 4 (usage = tag 34, len usageBuf.length)
      const dataBuf = new Uint8Array([24, 0xa6, 0x0a, 34, usageBuf.length, ...usageBuf])

      // root contains field 1 (tag 10, len dataBuf.length)
      const rootBuf = new Uint8Array([10, dataBuf.length, ...dataBuf])

      db.prepare("INSERT INTO gen_metadata (idx, data) VALUES (?, ?)").run(0, rootBuf)

      const records = scanAntigravityDatabase(tmpDbPath, 0)
      expect(records.length).toBe(1)
      const rec = records[0]!
      expect(rec.provider).toBe("antigravity")
      expect(rec.model).toBe("gemini-3.8-flash-high")
      expect(rec.totals.uncachedInputTokens).toBe(5000)
      expect(rec.totals.outputTokens).toBe(200)
      expect(rec.totals.cachedInputTokens).toBe(1000)
      expect(rec.costUsd).toBeGreaterThan(0)
    } finally {
      db.close()
      try {
        fs.unlinkSync(tmpDbPath)
      } catch {}
    }
  })

  // Reads the developer's real ~/.gemini data, so it is opt-in: its runtime depends on how
  // much local history exists (it exceeded the 5s default on a machine with a large history).
  it.runIf(process.env.SAYABOT_SCAN_REAL_DATA === "1")(
    "scans real Antigravity DBs if present on machine without errors",
    { timeout: 120_000 },
    () => {
      const home = os.homedir()
      const antigravityDir = path.join(home, ".gemini", "antigravity", "conversations")
      if (fs.existsSync(antigravityDir)) {
        const records = scanAntigravityUsage({
          directories: [antigravityDir],
          sinceMs: Date.now() - 30 * 86_400_000,
        })
        expect(Array.isArray(records)).toBe(true)
        if (records.length > 0) {
          const first = records[0]!
          expect(first.provider).toBe("antigravity")
          expect(typeof first.model).toBe("string")
          expect(first.totals.uncachedInputTokens).toBeGreaterThanOrEqual(0)
        }
      }
    },
  )
})

describe("Local Usage Scanner - Claude Code Parser", () => {
  it("parses Claude assistant turns, ignores synthetic models, and extracts usage", () => {
    const assistantLine = JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-01T12:00:00.000Z",
      sessionId: "claude-session-123",
      requestId: "req_test_001",
      costUSD: 0.045,
      message: {
        id: "msg_test_001",
        model: "claude-opus-5-5",
        usage: {
          input_tokens: 1500,
          cache_read_input_tokens: 8000,
          cache_creation_input_tokens: 500,
          output_tokens: 350,
          output_tokens_details: { thinking_tokens: 80 },
          speed: "standard",
        },
      },
    })

    const entries = parseClaudeLine(assistantLine, "fallback-session")
    expect(entries.length).toBe(1)
    const entry = entries[0]!
    expect(entry.model).toBe("claude-opus-5-5")
    expect(entry.sessionId).toBe("claude-session-123")
    expect(entry.totals.uncachedInputTokens).toBe(1500)
    expect(entry.totals.cachedInputTokens).toBe(8000)
    expect(entry.totals.cacheCreationTokens).toBe(500)
    expect(entry.totals.outputTokens).toBe(350)
    expect(entry.totals.reasoningTokens).toBe(80)
    expect(entry.reportedCostUsd).toBe(0.045)
    expect(entry.dedupeKey).toBe("msg_test_001:req_test_001")
  })

  it("extracts multi-model advisor turns from usage.iterations", () => {
    const advisorLine = JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-01T12:00:00.000Z",
      sessionId: "claude-advisor-test",
      requestId: "req_adv_001",
      message: {
        id: "msg_adv_001",
        model: "claude-opus-5-5",
        usage: {
          input_tokens: 200,
          output_tokens: 50,
          iterations: [
            {
              type: "advisor_message",
              model: "claude-sonnet-4-5",
              input_tokens: 1200,
              cache_read_input_tokens: 5000,
              cache_creation_input_tokens: 0,
              output_tokens: 150,
              thinking_tokens: 30,
            },
          ],
        },
      },
    })

    const entries = parseClaudeLine(advisorLine, "fallback")
    expect(entries.length).toBe(2)
    expect(entries[0]!.model).toBe("claude-opus-5-5")
    expect(entries[1]!.model).toBe("claude-sonnet-4-5")
    expect(entries[1]!.totals.uncachedInputTokens).toBe(1200)
    expect(entries[1]!.totals.cachedInputTokens).toBe(5000)
    expect(entries[1]!.dedupeKey).toContain("advisor:0")
  })

  it("ignores synthetic model entries", () => {
    const syntheticLine = JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-01T12:00:00.000Z",
      message: {
        id: "msg_synth",
        model: CLAUDE_SYNTHETIC_MODEL,
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    })
    expect(parseClaudeLine(syntheticLine, "test")).toEqual([])
  })

  it("scans a Claude JSONL file with streaming deduplication", async () => {
    const tmpFile = path.join(os.tmpdir(), `test-claude-${Date.now()}.jsonl`)
    const lines = [
      JSON.stringify({ type: "session_meta" }),
      // First partial chunk
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-11-05T10:00:00.000Z",
        requestId: "req_stream_1",
        message: {
          id: "msg_stream_1",
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 500, output_tokens: 20 },
        },
      }),
      // Final updated chunk with the same messageId & requestId
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-11-05T10:00:01.000Z",
        requestId: "req_stream_1",
        costUSD: 0.008,
        message: {
          id: "msg_stream_1",
          model: "claude-sonnet-4-5",
          usage: {
            input_tokens: 500,
            cache_read_input_tokens: 2000,
            output_tokens: 150,
          },
        },
      }),
    ]

    fs.writeFileSync(tmpFile, lines.join("\n"), "utf8")
    try {
      const records = await scanClaudeFile(tmpFile, 0)
      expect(records.length).toBe(1)
      const rec = records[0]!
      expect(rec.provider).toBe("claude")
      expect(rec.model).toBe("claude-sonnet-4-5")
      expect(rec.totals.uncachedInputTokens).toBe(500)
      expect(rec.totals.cachedInputTokens).toBe(2000)
      expect(rec.totals.outputTokens).toBe(150)
      expect(rec.costUsd).toBe(0.008)
    } finally {
      try {
        fs.unlinkSync(tmpFile)
      } catch {}
    }
  })
})

describe("Local Usage Scanner - Codex Session Parser", () => {
  it("scans Codex session files with token_usage_record and speed tier", async () => {
    const tmpFile = path.join(os.tmpdir(), `test-codex-${Date.now()}.jsonl`)
    const lines = [
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-11-08T09:00:00.000Z",
        payload: { id: "codex-session-abc" },
      }),
      JSON.stringify({
        type: "turn_context",
        timestamp: "2026-11-08T09:00:01.000Z",
        payload: { model: "gpt-4o", turn_id: "turn_1" },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-11-08T09:00:02.000Z",
        payload: {
          type: "thread_settings_applied",
          thread_settings: { service_tier: "fast" },
        },
      }),
      JSON.stringify({
        type: "token_usage_record",
        timestamp: "2026-11-08T09:00:05.000Z",
        payload: {
          turn_id: "turn_1",
          usage: {
            input_tokens: 10_000,
            cached_input_tokens: 4_000,
            cache_write_input_tokens: 1_000,
            output_tokens: 500,
            reasoning_output_tokens: 100,
            total_tokens: 10_500,
          },
        },
      }),
    ]

    fs.writeFileSync(tmpFile, lines.join("\n"), "utf8")
    try {
      const records = await scanCodexFile(tmpFile, 0)
      expect(records.length).toBe(1)
      const rec = records[0]!
      expect(rec.provider).toBe("codex")
      expect(rec.sessionId).toBe("codex-session-abc")
      expect(rec.model).toBe("gpt-4o")
      expect(rec.speed).toBe("fast")
      expect(rec.totals.uncachedInputTokens).toBe(5_000) // 10000 - 4000 - 1000
      expect(rec.totals.cachedInputTokens).toBe(4_000)
      expect(rec.totals.cacheCreationTokens).toBe(1_000)
      expect(rec.totals.outputTokens).toBe(500)
      expect(rec.totals.reasoningTokens).toBe(100)
      expect(rec.costUsd).toBeGreaterThan(0)
    } finally {
      try {
        fs.unlinkSync(tmpFile)
      } catch {}
    }
  })
})

describe("Local Usage Scanner - Orchestrator & Aggregations", () => {
  it("orchestrates all local providers and produces unified summary and events", async () => {
    // Hermetic: point every provider at an empty directory instead of the developer's real
    // history, whose size made this test exceed the 5s timeout on a busy machine.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "scan-empty-"))
    const result = await scanLocalUsage({
      days: 30,
      antigravityDirs: [empty],
      claudeDirs: [empty],
      codexDirs: [empty],
    })
    fs.rmSync(empty, { recursive: true, force: true })
    expect(result).toBeDefined()
    expect(result.summary).toBeDefined()
    expect(Array.isArray(result.records)).toBe(true)
    expect(Array.isArray(result.events)).toBe(true)
    expect(Array.isArray(result.summary.byDay)).toBe(true)
    expect(typeof result.summary.totalTokens).toBe("number")
    expect(typeof result.summary.costUsd).toBe("number")
    expect(typeof result.summary.cacheSavingsUsd).toBe("number")
    expect(typeof result.summary.sessionCount).toBe("number")

    // Verify events format matches UsageEventRow for UsageDashboard
    for (const evt of result.events.slice(0, 5)) {
      expect(evt.agent_id).toBeNull()
      expect(evt.room_id).toBeNull()
      expect(typeof evt.provider).toBe("string")
      expect(typeof evt.model).toBe("string")
      expect(typeof evt.input_tokens).toBe("number")
      expect(typeof evt.output_tokens).toBe("number")
      expect(typeof evt.cost_usd).toBe("number")
      expect(typeof evt.created_at).toBe("string")
    }

    // Verify provider summaries calculate sharePercent properly
    for (const [providerName, pSummary] of Object.entries(result.summary.byProvider)) {
      expect(pSummary.provider).toBe(providerName)
      expect(pSummary.sharePercent).toBeGreaterThanOrEqual(0)
      expect(pSummary.tokens).toBeGreaterThanOrEqual(0)
    }
  })
})
