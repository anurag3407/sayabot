import { describe, expect, it, vi } from "vitest"
import { getCopilotModels } from "../../src/lib/connectors/copilot"
import { getOpenAICodexModels } from "../../src/lib/connectors/chatgpt-plan"
import { getAllGroupedModels, getStoredModelSelection, saveStoredModelSelection } from "../../src/lib/connectors/registry"

describe("model catalogues", () => {
  it("copilot models have ids, labels and multipliers", () => {
    const models = getCopilotModels()
    expect(models.length).toBeGreaterThan(0)
    for (const m of models) { expect(m.id).toBeTruthy(); expect(m.label).toBeTruthy() }
    expect(models.some((m) => m.id === "copilot/auto")).toBe(true)
  })

  it("grouped models sum to the reported total", async () => {
    const { groups, totalModelsCount } = await getAllGroupedModels()
    expect(groups.length).toBeGreaterThanOrEqual(10)
    expect(groups.reduce((a, g) => a + g.totalCount, 0)).toBe(totalModelsCount)
    for (const g of groups) expect(g.totalCount).toBe(g.models.length)
  })

  it("codex catalogue and grouped openai-codex agree", async () => {
    const { groups } = await getAllGroupedModels()
    const codex = groups.find((g) => g.id === "openai-codex")!
    expect(codex.models.map((m) => m.id)).toEqual(getOpenAICodexModels().map((m) => m.id))
  })
})

describe("stored model selection (SSR-safe)", () => {
  it("returns the default without a window", () => {
    expect(getStoredModelSelection().provider).toBe("openai")
    expect(() => saveStoredModelSelection(getStoredModelSelection())).not.toThrow()
  })
})
