import { describe, expect, it } from "vitest"
import { CLIENT_CAPABILITIES, normalizeClient } from "../../src/clients"

describe("normalizeClient", () => {
  it.each([
    ["codex", "codex"],
    ["HERMES", "hermes"],
    ["claude-code", "claude-code"],
    ["claudecode", "claude-code"],
    ["Claude", "claude"],
    ["cursor", "cursor"],
    ["antigravity", "antigravity"],
    ["gemini", "antigravity"],
    ["chatgpt", "chatgpt"],
    ["  Codex  ", "codex"],
  ])("maps %j -> %s", (raw, id) => {
    expect(normalizeClient(raw).id).toBe(id)
  })

  it("falls back to generic for unknown / empty / undefined", () => {
    for (const raw of [undefined, "", "unknown-bot", "123", "claude code"]) {
      expect(normalizeClient(raw).id).toBe("generic")
    }
  })
})

describe("CLIENT_CAPABILITIES registry", () => {
  it("every entry is self-consistent (id matches its key)", () => {
    for (const [key, cap] of Object.entries(CLIENT_CAPABILITIES)) {
      expect(cap.id).toBe(key)
      expect(cap.label.length).toBeGreaterThan(0)
      expect(["cli", "app", "toml", "json", "generic"]).toContain(cap.configForm)
    }
  })

  it("only oauth-capable clients advertise oauthMcp", () => {
    const oauth = Object.values(CLIENT_CAPABILITIES).filter((c) => c.oauthMcp).map((c) => c.id)
    expect(oauth).toEqual(expect.arrayContaining(["claude-code", "claude", "chatgpt"]))
    expect(CLIENT_CAPABILITIES.generic.oauthMcp).toBe(false)
  })

  it("normalizeClient returns a registry member, never a copy", () => {
    expect(normalizeClient("codex")).toBe(CLIENT_CAPABILITIES.codex)
    expect(normalizeClient("nope")).toBe(CLIENT_CAPABILITIES.generic)
  })
})
