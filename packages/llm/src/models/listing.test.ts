import { describe, expect, it } from "vitest"
import { modelListings } from "./listing"
import { trimModelsDevCatalog, type CatalogModel, type ModelCatalog } from "./models-dev"

const NOW = Date.parse("2026-11-14T12:00:00Z")

function catalog(
  provider: string,
  models: Array<Partial<CatalogModel> & { id: string }>,
): ModelCatalog {
  return {
    origin: "snapshot",
    updatedAt: "2026-11-14T00:00:00Z",
    providers: {
      [provider]: {
        id: provider,
        name: provider,
        models: Object.fromEntries(models.map((m) => [m.id, { name: m.id, ...m }])),
      },
    },
  }
}

const ids = (...list: string[]) => list.map((id) => ({ id }))

describe("trimModelsDevCatalog release fields", () => {
  it("keeps a well-formed release date and family and drops bad ones", () => {
    const providers = trimModelsDevCatalog({
      anthropic: {
        name: "Anthropic",
        models: {
          "claude-opus-5-5": {
            name: "Claude Opus 5.5",
            release_date: "2026-10-01",
            family: "claude-opus",
          },
          "claude-bad": { name: "Bad", release_date: "Oct 1", family: "{x}" },
        },
      },
    })
    expect(providers.anthropic?.models["claude-opus-5-5"]).toMatchObject({
      release_date: "2026-10-01",
      family: "claude-opus",
    })
    expect(providers.anthropic?.models["claude-bad"]?.release_date).toBeUndefined()
    expect(providers.anthropic?.models["claude-bad"]?.family).toBeUndefined()
  })
})

describe("modelListings", () => {
  it("shows every model of a short list and labels a release from this week", () => {
    const cat = catalog("anthropic", [
      { id: "claude-opus-5-5", family: "claude-opus", release_date: "2026-11-10" },
      { id: "claude-opus-4-1", family: "claude-opus", release_date: "2025-08-05" },
    ])
    const out = modelListings("anthropic", ids("claude-opus-5-5", "claude-opus-4-1"), {
      catalog: cat,
      now: NOW,
    })
    expect(out.get("claude-opus-5-5")).toEqual({ releaseDate: "2026-11-10", listing: "new" })
    expect(out.get("claude-opus-4-1")).toEqual({ releaseDate: "2025-08-05" })
  })

  it("folds older versions and past generations of a long list", () => {
    const cat = catalog("anthropic", [
      { id: "claude-opus-5-5", family: "claude-opus", release_date: "2026-09-01" },
      { id: "claude-opus-5", family: "claude-opus", release_date: "2026-05-01" },
      { id: "claude-sonnet-5-5", family: "claude-sonnet", release_date: "2026-09-01" },
      { id: "claude-sonnet-5", family: "claude-sonnet", release_date: "2026-05-01" },
      { id: "claude-haiku-5-5", family: "claude-haiku", release_date: "2026-08-20" },
      { id: "claude-haiku-4-5", family: "claude-haiku", release_date: "2025-10-01" },
      { id: "claude-instant-1", family: "claude-instant", release_date: "2023-03-01" },
      { id: "claude-2", family: "claude", release_date: "2023-07-01" },
      { id: "claude-3-opus", family: "claude-3", release_date: "2024-03-01" },
    ])
    const list = ids(
      "claude-opus-5-5",
      "claude-opus-5",
      "claude-sonnet-5-5",
      "claude-sonnet-5",
      "claude-haiku-5-5",
      "claude-haiku-4-5",
      "claude-instant-1",
      "claude-2",
      "claude-3-opus",
    )
    const out = modelListings("anthropic", list, { catalog: cat, now: NOW })
    const folded = [...out].filter(([, info]) => info.listing === "older").map(([id]) => id)
    expect(folded.sort()).toEqual(
      [
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-haiku-4-5",
        "claude-instant-1",
        "claude-2",
        "claude-3-opus",
      ].sort(),
    )
    expect(out.get("claude-opus-5-5")?.listing).toBeUndefined()
  })

  it("never folds a model an agent is using", () => {
    const cat = catalog("openai", [
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `gpt-${i + 1}`,
        family: "gpt",
        release_date: `2026-0${(i % 9) + 1}-01`,
      })),
    ])
    const list = ids(...Array.from({ length: 9 }, (_, i) => `gpt-${i + 1}`))
    const out = modelListings("openai", list, { catalog: cat, now: NOW, inUse: new Set(["gpt-1"]) })
    expect(out.get("gpt-1")?.listing).toBeUndefined()
    expect(out.get("gpt-2")?.listing).toBe("older")
    expect(out.get("gpt-9")?.listing).toBeUndefined()
  })

  it("lets a newer version models.dev has not dated yet lead its family", () => {
    const cat = catalog("anthropic", [
      { id: "claude-opus-5-5", family: "claude-opus", release_date: "2026-09-01" },
      { id: "claude-opus-5-1", family: "claude-opus", release_date: "2026-06-01" },
    ])
    const list = ids(
      "claude-opus-6-0",
      "claude-opus-5-5",
      "claude-opus-5-1",
      ...ids("a", "b", "c", "d", "e", "f").map((m) => m.id),
    )
    const out = modelListings("anthropic", list, { catalog: cat, now: NOW })
    expect(out.get("claude-opus-6-0")).toEqual({ releaseDate: "2026-09-02" })
    expect(out.get("claude-opus-5-5")?.listing).toBe("older")
    // Ids models.dev knows nothing about stay plain rows.
    expect(out.has("a")).toBe(false)
  })

  it("gives no listings when models.dev dates none of the models", () => {
    const cat = catalog("openrouter", [])
    expect(modelListings("openrouter", ids("x/a", "x/b"), { catalog: cat, now: NOW }).size).toBe(0)
  })

  it("shares a long list fairly between the services of a gateway", () => {
    const models = [
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `big/model-${String.fromCharCode(97 + i)}`,
        family: `fam-${i}`,
        release_date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      })),
      { id: "small/one", family: "one", release_date: "2026-01-01" },
    ]
    const cat: ModelCatalog = {
      origin: "snapshot",
      updatedAt: "2026-11-14T00:00:00Z",
      providers: {
        big: {
          id: "big",
          name: "big",
          models: Object.fromEntries(
            models
              .slice(0, 20)
              .map((m) => [m.id.slice(4), { ...m, id: m.id.slice(4), name: m.id }]),
          ),
        },
        small: {
          id: "small",
          name: "small",
          models: { one: { id: "one", name: "one", family: "one", release_date: "2026-01-01" } },
        },
      },
    }
    const out = modelListings("openrouter", models, { catalog: cat, now: NOW })
    const shown = models.filter((m) => out.get(m.id)?.listing !== "older").map((m) => m.id)
    expect(shown).toContain("small/one")
    expect(shown.filter((id) => id.startsWith("big/"))).toHaveLength(6)
  })
})
