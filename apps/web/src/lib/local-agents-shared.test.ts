import { describe, expect, it } from "vitest"
import { reportedAgentsToReports } from "./local-agents-shared"

describe("reportedAgentsToReports", () => {
  it("turns the Mac app's heartbeat list into Providers rows with account and models", () => {
    const rows = reportedAgentsToReports([
      {
        id: "claude-code",
        name: "Claude Code",
        binary: "/Users/me/.local/bin/claude",
        status: "ready",
        version: "2.1.325",
        account: "me@example.com · My Org",
        models: [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }],
      },
      { id: "codex", status: "signed_out", binary: "/opt/homebrew/bin/codex", version: "0.166.0" },
      { id: "cursor", status: "not_installed", binary: null },
      { id: "ollama", status: "ready", binary: null, models: [{ id: "llama3", label: "llama3" }] },
      { id: "mystery", status: "ready" },
    ])
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      ["claude-code", "ready"],
      ["codex", "signed_out"],
      ["ollama", "ready"],
    ])
    expect(rows[0]).toMatchObject({
      name: "Claude Code",
      icon: "anthropic",
      cli: true,
      account: "me@example.com · My Org",
      models: [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }],
    })
    expect(rows[2]).toMatchObject({ name: "Ollama", cli: false })
  })

  it("is empty for anything that isn't a list", () => {
    expect(reportedAgentsToReports(null)).toEqual([])
    expect(reportedAgentsToReports({})).toEqual([])
  })
})
