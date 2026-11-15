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
      { id: "lmstudio", status: "not_installed", binary: null },
      { id: "mystery", status: "ready" },
    ])
    expect(rows.map((row) => [row.id, row.status])).toEqual([
      ["claude-code", "ready"],
      ["codex", "signed_out"],
      ["cursor", "not_installed"],
      ["ollama", "ready"],
    ])
    expect(rows[0]).toMatchObject({
      name: "Claude Code",
      icon: "anthropic",
      cli: true,
      account: "me@example.com · My Org",
      models: [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" }],
    })
    expect(rows[3]).toMatchObject({ name: "Ollama", cli: false })
    expect(rows[3]?.access).toBeUndefined()
  })

  it("says whether each app needs an API key and how to set it up", () => {
    const rows = reportedAgentsToReports([
      { id: "copilot", status: "ready", binary: "/x/copilot" },
      { id: "kimi", status: "signed_out", binary: "/x/kimi" },
      { id: "deepseek", status: "not_installed", binary: null },
      { id: "hermes", status: "ready", binary: "/x/hermes" },
    ])
    expect(rows.map((row) => [row.id, row.access])).toEqual([
      ["copilot", "account_or_key"],
      ["kimi", "account"],
      ["deepseek", "key"],
      ["hermes", "own_config"],
    ])
    expect(rows[0]).toMatchObject({ name: "GitHub Copilot", icon: "copilot" })
    expect(rows[1]?.setupHint).toContain("kimi login")
    expect(rows[2]?.setupHint).toContain("DEEPSEEK_API_KEY")
    expect(rows[2]?.install).toContain("@deepseek-ai/dsh")
  })

  it("is empty for anything that isn't a list", () => {
    expect(reportedAgentsToReports(null)).toEqual([])
    expect(reportedAgentsToReports({})).toEqual([])
  })
})
