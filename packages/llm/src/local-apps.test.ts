import { describe, expect, it } from "vitest"
import { LOCAL_APPS, localAppArgv } from "./local-apps"

describe("local apps", () => {
  it("only starts the seven fixed programs", () => {
    expect(LOCAL_APPS.map((app) => app.id)).toEqual([
      "airtable",
      "brave-search",
      "resend",
      "firecrawl-local",
      "obsidian",
      "paper",
      "apple-apps",
    ])
    for (const app of LOCAL_APPS) {
      const line = localAppArgv(app)
      expect(line.startsWith("npx -y ") || line === "paper mcp", app.id).toBe(true)
      expect(line).not.toMatch(/[;&|`$]/)
    }
  })
})
