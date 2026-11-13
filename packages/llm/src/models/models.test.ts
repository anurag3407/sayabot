import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clampEffort, normalizeEffortLevels } from "./effort"
import { claudeCatalogFromRows, codexCatalogFromRows, parseOrgBlockedModels } from "./engine-models"
import {
  BUNDLED_MODEL_MANIFEST,
  manifestPrice,
  parseModelManifest,
  versionAtLeast,
} from "./manifest"
import {
  CATALOG_SCHEMA,
  ModelCatalogStore,
  catalogPrice,
  findCatalogModel,
  trimModelsDevCatalog,
  type ModelCatalog,
} from "./models-dev"
import { fetchEnginePlanUsage, parseClaudeUsage, parseCodexUsage, planLabel } from "./plan-usage"
import {
  clearProviderModelCache,
  listProviderModels,
  providerModelsUrl,
  toProviderModel,
} from "./provider-models"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sayabot-models-"))
  vi.stubEnv("SAYABOT_DATA_DIR", dir)
  vi.stubEnv("SAYABOT_DISABLE_MODEL_MANIFEST_FETCH", "1")
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
  clearProviderModelCache()
})

const RAW = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    models: {
      "claude-sonnet-5-5": {
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        reasoning: true,
        tool_call: true,
        reasoning_options: [
          { type: "effort", values: ["low", "medium", "high", "xhigh", "max", "ultra"] },
        ],
        limit: { context: 1_000_000, output: 64_000 },
        cost: { input: 3, output: 15, cache_read: 0.3 },
      },
      "bad{model}": { id: "bad{model}", name: "x" },
    },
  },
  broken: "not a provider",
}

function json(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  })
}

describe("effort", () => {
  it("normalizes to the ladder and drops unknown levels", () => {
    expect(normalizeEffortLevels(["max", "minimal", "low", "ultra", "low"])).toEqual(["low", "max"])
  })
  it("drops a saved level the model no longer takes", () => {
    expect(clampEffort("xhigh", ["low", "high"])).toBeUndefined()
    expect(clampEffort("high", ["low", "high"])).toBe("high")
    expect(clampEffort("bogus", undefined)).toBeUndefined()
  })
})

describe("models.dev catalog", () => {
  it("trims to the fields Sayabot uses and drops malformed entries", () => {
    let drops = 0
    const providers = trimModelsDevCatalog(RAW, { onDrop: () => (drops += 1) })
    expect(Object.keys(providers)).toEqual(["anthropic"])
    expect(providers.anthropic?.models["claude-sonnet-5-5"]).toEqual({
      id: "claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
      reasoning: true,
      tool_call: true,
      effort: ["low", "medium", "high", "xhigh", "max"],
      limit: { context: 1_000_000, output: 64_000 },
      cost: { input: 3, output: 15, cache_read: 0.3 },
    })
    expect(drops).toBe(2)
    // Idempotent: trimming the trimmed shape changes nothing.
    expect(trimModelsDevCatalog(providers)).toEqual(providers)
  })

  it("finds a model by provider, by vendor/id, and ignoring a release date", () => {
    const catalog: ModelCatalog = {
      origin: "cache",
      updatedAt: "",
      providers: trimModelsDevCatalog(RAW),
    }
    expect(findCatalogModel(catalog, "anthropic", "claude-sonnet-5-5")?.name).toBe(
      "Claude Sonnet 5.5",
    )
    expect(findCatalogModel(catalog, "claude-code", "claude-sonnet-5-5-20260101")?.name).toBe(
      "Claude Sonnet 5.5",
    )
    expect(findCatalogModel(catalog, "openrouter", "anthropic/claude-sonnet-5-5")?.name).toBe(
      "Claude Sonnet 5.5",
    )
    expect(findCatalogModel(catalog, "openai", "nope")).toBeNull()
    expect(catalogPrice(findCatalogModel(catalog, "anthropic", "claude-sonnet-5-5"))).toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
      cachedInputPerMillion: 0.3,
    })
  })

  it("downloads, caches, then sends the ETag and keeps the copy on 304", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(RAW, { headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    let now = 1_000_000
    const store = new ModelCatalogStore({
      fetch,
      now: () => now,
      openCodeCachePath: null,
      snapshot: {},
      log: () => {},
    })
    expect(store.get().origin).toBe("empty")
    expect(await store.refresh()).toBe("updated")
    expect(store.get().origin).toBe("cache")
    expect(await store.refresh()).toBe("fresh")
    now += 25 * 60 * 60 * 1000
    expect(await store.refresh()).toBe("not-modified")
    expect(fetch.mock.calls[1]?.[1]?.headers["if-none-match"]).toBe('"v1"')
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("error")
  })

  it("keeps the current catalog when models.dev fails, and falls back to the snapshot", async () => {
    const snapshot = {
      schema: CATALOG_SCHEMA,
      updatedAt: "2026-01-01T00:00:00Z",
      providers: trimModelsDevCatalog(RAW),
    }
    const store = new ModelCatalogStore({
      fetch: vi.fn().mockRejectedValue(new Error("offline")),
      openCodeCachePath: null,
      snapshot,
      log: () => {},
    })
    expect(await store.refresh({ force: true })).toBe("failed")
    expect(store.get().origin).toBe("snapshot")
    expect(store.get().providers.anthropic).toBeDefined()
  })
})

describe("model manifest", () => {
  it("the bundled manifest is valid and prices its models", () => {
    expect(BUNDLED_MODEL_MANIFEST.engines["claude-code"].models.length).toBeGreaterThan(0)
    expect(manifestPrice("claude-sonnet-5-5", BUNDLED_MODEL_MANIFEST)).not.toBeNull()
  })

  it("rejects a default that is not a current model and a future date", () => {
    const bad = structuredClone(BUNDLED_MODEL_MANIFEST) as unknown as {
      engines: { "claude-code": { default: string } }
    }
    bad.engines["claude-code"].default = "not-listed"
    expect(parseModelManifest(bad).ok).toBe(false)
    const future = { ...BUNDLED_MODEL_MANIFEST, updatedAt: "2999-01-01T00:00:00Z" }
    expect(parseModelManifest(future).ok).toBe(false)
  })

  it("applies dated price changes", () => {
    const manifest = {
      ...BUNDLED_MODEL_MANIFEST,
      prices: {
        "m-1": {
          inputPerMillion: 1,
          outputPerMillion: 2,
          asOf: "2026-01-01",
          source: "https://example.com",
          changes: [{ from: "2026-06-01", inputPerMillion: 3, outputPerMillion: 4 }],
        },
      },
    }
    expect(manifestPrice("m-1", manifest, new Date("2026-03-01"))?.inputPerMillion).toBe(1)
    expect(manifestPrice("m-1", manifest, new Date("2026-07-01"))?.inputPerMillion).toBe(3)
  })

  it("compares CLI versions", () => {
    expect(versionAtLeast([2, 1, 323], [2, 1, 321])).toBe(true)
    expect(versionAtLeast([2, 0, 999], [2, 1, 0])).toBe(false)
  })
})

describe("engine catalogs", () => {
  it("reads Codex model/list rows with per-model effort and custom providers last", () => {
    const catalog = codexCatalogFromRows([
      { id: "acme/llama", displayName: "Llama", supportedReasoningEfforts: [] },
      {
        id: "gpt-6-astra",
        displayName: "GPT-6-Astra",
        isDefault: true,
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "xhigh" },
          { reasoningEffort: "ultra" },
        ],
      },
      { id: "secret", hidden: true },
    ])
    expect(catalog?.default).toBe("gpt-6-astra")
    expect(catalog?.options.map((o) => o.id)).toEqual(["gpt-6-astra", "acme/llama"])
    expect(catalog?.options[0]).toMatchObject({ effort: ["low", "xhigh"], defaultEffort: "low" })
    expect(catalog?.options[1]?.custom).toBe(true)
  })

  it("reads Claude Code's own model list: aliases resolved, default noted, bad ids dropped", () => {
    const catalog = claudeCatalogFromRows(
      [
        {
          value: "default",
          resolvedModel: "claude-opus-5-5",
          displayName: "Default (recommended)",
        },
        {
          value: "opus",
          resolvedModel: "claude-opus-5-5",
          displayName: "Opus 5.5",
          supportsEffort: true,
          supportedEffortLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
        },
        { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5 again" },
        { value: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5" },
        { value: "claude-opus-5-5[1m]", displayName: "Opus 5.5 (1M)", supportsEffort: true },
        { value: "rm -rf /", displayName: "Bad" },
        { value: 42, displayName: "Not a string" },
      ],
      "2.1.325",
    )
    expect(catalog?.source).toBe("live")
    expect(catalog?.cliVersion).toBe("2.1.325")
    expect(catalog?.default).toBe("claude-opus-5-5")
    const ids = catalog?.options.filter((o) => !o.needsCliUpdate).map((o) => o.id)
    expect(ids).toEqual(["claude-opus-5-5", "claude-haiku-4-5-20251001", "claude-opus-5-5[1m]"])
    expect(catalog?.options[0]).toMatchObject({
      label: "Opus 5.5",
      effort: ["low", "medium", "high", "xhigh", "max"],
    })
    // No effort support listed means Default only.
    expect(catalog?.options[1]?.effort).toEqual([])
  })

  it("marks manifest models the installed Claude Code is too old for", () => {
    const catalog = claudeCatalogFromRows(
      [{ value: "sonnet", resolvedModel: "claude-sonnet-5-5" }],
      "0.0.1",
    )
    const needsUpdate = catalog?.options.filter((o) => o.needsCliUpdate) ?? []
    expect(needsUpdate.length).toBeGreaterThan(0)
    expect(needsUpdate.every((o) => o.id !== "claude-sonnet-5-5")).toBe(true)
  })

  it("gives up on a Claude Code list with no usable model", () => {
    expect(
      claudeCatalogFromRows([{ value: "default", resolvedModel: "claude-opus-5-5" }]),
    ).toBeNull()
    expect(claudeCatalogFromRows([])).toBeNull()
  })

  it("reads the models an organization blocks", () => {
    const text = JSON.stringify({
      modelAccessCache: [
        { apiName: "claude-opus-5-5-20260101", entitled: false },
        { apiName: "claude-sonnet-5-5", entitled: true },
      ],
    })
    expect([...parseOrgBlockedModels(text)]).toEqual(["claude-opus-5-5"])
    expect(parseOrgBlockedModels("{not json").size).toBe(0)
  })
})

describe("plan usage", () => {
  it("parses Claude windows, per-model windows and the plan", () => {
    const usage = parseClaudeUsage({
      subscription_type: "max",
      five_hour: { utilization: 42, resets_at: "2026-11-14T05:00:00Z" },
      seven_day: { utilization: 130 },
      seven_day_opus: { utilization: 10 },
      seven_day_oauth_apps: { utilization: 1 },
      extra_usage: { is_enabled: true, used_credits: 500, monthly_limit: 2000 },
    })
    expect(usage.plan).toBe("max")
    expect(usage.windows).toEqual([
      { label: "5-hour", usedPercent: 42, resetsAt: "2026-11-14T05:00:00.000Z" },
      { label: "Weekly", usedPercent: 100, resetsAt: null },
      { label: "Opus · weekly", usedPercent: 10, resetsAt: null },
      { label: "Extra usage", usedPercent: 25, resetsAt: null },
    ])
  })

  it("parses Codex windows by their length", () => {
    const usage = parseCodexUsage({
      plan_type: "pro",
      rate_limit: {
        primary_window: { used_percent: 12, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
        secondary_window: { used_percent: 3, limit_window_seconds: 604_800 },
      },
    })
    expect(usage.plan).toBe("pro")
    expect(usage.windows.map((w) => w.label)).toEqual(["5-hour", "Weekly"])
    expect(usage.windows[0]?.resetsAt).toBe(new Date(1_800_000_000_000).toISOString())
  })

  it("never treats a credential as a plan name", () => {
    expect(planLabel("Bearer abc")).toBeNull()
    expect(planLabel("sk-ant-123")).toBeNull()
    expect(planLabel("plus")).toBe("plus")
  })

  it("sends the token only in the header and keeps it out of the result", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ plan_type: "plus", rate_limit: {} }))
    const row = await fetchEnginePlanUsage("codex", {
      fetch,
      readCredential: async () => ({ token: "tok-secret", accountId: "acct", expired: false }),
    })
    expect(row).toMatchObject({ ok: true, plan: "plus" })
    expect(JSON.stringify(row)).not.toContain("tok-secret")
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer tok-secret",
      "ChatGPT-Account-Id": "acct",
    })
  })

  it("falls back to the plan saved beside the login", async () => {
    const row = await fetchEnginePlanUsage("claude-code", {
      fetch: vi.fn().mockResolvedValue(json({ five_hour: { utilization: 5 } })),
      readCredential: async () => ({ token: "t", accountId: null, expired: false, plan: "max" }),
    })
    expect(row).toMatchObject({ ok: true, plan: "max" })
  })

  it("asks to sign in again on 401 and when the login expired", async () => {
    const unauthorized = await fetchEnginePlanUsage("claude-code", {
      fetch: vi.fn().mockResolvedValue(json({}, { status: 401 })),
      readCredential: async () => ({ token: "t", accountId: null, expired: false }),
    })
    expect(unauthorized).toMatchObject({ ok: false, error: "Sign in again in Claude Code" })
    const expired = await fetchEnginePlanUsage("claude-code", {
      readCredential: async () => ({ token: null, accountId: null, expired: true }),
    })
    expect(expired.error).toBe("Sign in again in Claude Code")
  })
})

describe("provider models", () => {
  it("builds the models address per provider", () => {
    expect(providerModelsUrl("anthropic", null)).toBe("https://api.anthropic.com/v1/models")
    expect(providerModelsUrl("openai", "https://gw.example.com/v1/")).toBe(
      "https://gw.example.com/v1/models",
    )
    expect(providerModelsUrl("openai-compatible", null)).toBeNull()
  })

  it("prices OpenRouter rows from its own per-token pricing and marks free ones", () => {
    const row = toProviderModel("openrouter", {
      id: "acme/model:free",
      name: "Acme: Model",
      context_length: 131_072,
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["tools", "reasoning"],
    })
    expect(row).toMatchObject({
      id: "acme/model:free",
      label: "Acme: Model (free)",
      free: true,
      tools: true,
      contextWindow: 131_072,
      price: { inputPerMillion: 0, outputPerMillion: 0 },
    })
    expect(row?.effort?.length).toBeGreaterThan(0)
    const paid = toProviderModel("openrouter", {
      id: "acme/big",
      pricing: { prompt: "0.000003", completion: "0.000015" },
    })
    expect(paid?.price).toEqual({ inputPerMillion: 3, outputPerMillion: 15 })
  })

  it("lists a key's models live, and falls back to models.dev when refused", async () => {
    const live = await listProviderModels({
      provider: "openai",
      apiKey: "sk-test",
      cacheKey: "k1",
      fetch: vi
        .fn()
        .mockResolvedValue(json({ data: [{ id: "gpt-5.6-sol" }, { id: "gpt-5.4-mini" }] })),
    })
    expect(live.source).toBe("live")
    expect(live.models.map((m) => m.id)).toEqual(["gpt-5.6-sol", "gpt-5.4-mini"])
    const refused = await listProviderModels({
      provider: "openai",
      apiKey: "sk-bad",
      cacheKey: "k2",
      fetch: vi.fn().mockResolvedValue(json({}, { status: 401 })),
    })
    expect(refused).toMatchObject({ source: "catalog", error: "The provider refused this key" })
  })

  it("never sends a key over plain HTTP to another computer", async () => {
    const fetch = vi.fn()
    const result = await listProviderModels({
      provider: "openai",
      apiKey: "sk-test",
      baseUrl: "http://gateway.example.com/v1",
      cacheKey: "k3",
      fetch,
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(result.source).toBe("catalog")
  })
})
