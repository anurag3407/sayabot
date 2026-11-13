import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AUTO_SELECTION,
  MODEL_SELECTION_EVENT,
  readModelSelection,
  saveModelSelection,
} from "./model-selection"

describe("model selection", () => {
  let store: Map<string, string>
  let events: Event[]

  beforeEach(() => {
    store = new Map()
    events = []
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
      dispatchEvent: (event: Event) => {
        events.push(event)
        return true
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("is Auto until something is picked", () => {
    expect(readModelSelection("acme")).toEqual(AUTO_SELECTION)
  })

  it("keeps one pick per workspace and announces it", () => {
    const pick = {
      keyId: "key-1",
      modelId: "claude-sonnet-5-5",
      label: "Claude Sonnet 5.5",
      provider: "anthropic",
      groupLabel: "Anthropic",
      effort: "high" as const,
    }
    saveModelSelection("acme", pick)
    expect(readModelSelection("acme")).toEqual(pick)
    expect(readModelSelection("other")).toEqual(AUTO_SELECTION)
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe(MODEL_SELECTION_EVENT)
  })

  it("falls back to Auto on a damaged or old-format entry and drops an unknown effort", () => {
    store.set("sayabot:model-selection:acme", "{not json")
    expect(readModelSelection("acme")).toEqual(AUTO_SELECTION)
    store.set("sayabot:model-selection:acme", JSON.stringify({ instanceId: "x", modelLabel: "y" }))
    expect(readModelSelection("acme")).toEqual(AUTO_SELECTION)
    store.set(
      "sayabot:model-selection:acme",
      JSON.stringify({ keyId: null, modelId: "", label: "Auto", effort: "x-high" }),
    )
    expect(readModelSelection("acme").effort).toBeUndefined()
  })
})
