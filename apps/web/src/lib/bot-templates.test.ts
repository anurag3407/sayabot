import { describe, expect, it } from "vitest"
import {
  CURATED_BOT_TEMPLATES,
  getCuratedBotTemplate,
  getCuratedBotTemplates,
} from "./curated-bot-templates"

describe("Curated Bot Templates", () => {
  it("provides all core curated bots", () => {
    const templates = getCuratedBotTemplates()
    expect(templates.length).toBeGreaterThanOrEqual(8)

    const slugs = templates.map((t) => t.slug)
    expect(slugs).toContain("coder")
    expect(slugs).toContain("researcher")
    expect(slugs).toContain("reviewer")
    expect(slugs).toContain("designer")
    expect(slugs).toContain("writer")
    expect(slugs).toContain("analyst")
    expect(slugs).toContain("ops")
    expect(slugs).toContain("assistant")
  })

  it("retrieves template by slug case-insensitively", () => {
    const coder = getCuratedBotTemplate("Coder")
    expect(coder).toBeDefined()
    expect(coder?.name).toBe("Coder")
    expect(coder?.category).toBe("engineering")
    expect(coder?.systemPrompt).toContain("senior software engineer")

    const researcher = getCuratedBotTemplate("RESEARCHER")
    expect(researcher).toBeDefined()
    expect(researcher?.name).toBe("Researcher")
    expect(researcher?.category).toBe("research")
  })

  it("returns null for unknown template slug", () => {
    expect(getCuratedBotTemplate("non-existent-bot-slug")).toBeNull()
  })

  it("each template has required fields for the Bot store", () => {
    for (const bot of CURATED_BOT_TEMPLATES) {
      expect(bot.id).toBeTruthy()
      expect(bot.slug).toBeTruthy()
      expect(bot.name).toBeTruthy()
      expect(bot.description).toBeTruthy()
      expect(bot.category).toBeTruthy()
      expect(bot.recommendedModel).toBeTruthy()
      expect(bot.highlights.length).toBeGreaterThan(0)
      expect(bot.systemPrompt.length).toBeGreaterThan(20)
    }
  })
})
