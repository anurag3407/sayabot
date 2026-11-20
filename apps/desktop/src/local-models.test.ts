import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  claudeAccount,
  claudeRowsToModels,
  codexModels,
  detectLocalModelServers,
  localServerModels,
} from "./local-models"

function fakeHome(files: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), "sayabot-home-"))
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(home, file, ".."), { recursive: true })
    writeFileSync(join(home, file), JSON.stringify(body))
  }
  return home
}

describe("claudeRowsToModels", () => {
  it("resolves aliases, marks the default and keeps effort levels", () => {
    const models = claudeRowsToModels([
      { value: "default", resolvedModel: "claude-sonnet-5" },
      {
        value: "sonnet",
        resolvedModel: "claude-sonnet-5",
        displayName: "Claude Sonnet 5",
        supportsEffort: true,
        supportedEffortLevels: ["low", "high"],
      },
      { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Claude Opus 5.5" },
      { value: "rm -rf /" },
    ])
    expect(models).toEqual([
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", effort: ["low", "high"], isDefault: true },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
    ])
  })
})

describe("accounts and lists from files", () => {
  it("reads the Claude account without touching credentials", async () => {
    const home = fakeHome({
      ".claude.json": { oauthAccount: { emailAddress: "a@b.co", organizationName: "Acme" } },
    })
    expect(await claudeAccount(home)).toBe("a@b.co · Acme")
    expect(await claudeAccount(fakeHome({}))).toBeNull()
  })

  it("reads Codex's model cache, skipping hidden models", async () => {
    const home = fakeHome({
      ".codex/models_cache.json": {
        models: [
          {
            slug: "gpt-6",
            display_name: "GPT-6",
            default_reasoning_level: "high",
            supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
          },
          { slug: "secret", visibility: "hidden" },
        ],
      },
    })
    vi.stubEnv("CODEX_HOME", "")
    expect(await codexModels(home)).toEqual([
      { id: "gpt-6", label: "GPT-6", effort: ["low", "high"], defaultEffort: "high" },
    ])
  })
})

describe("local model servers", () => {
  it("reads Ollama and OpenAI-style lists and drops embedding models", () => {
    expect(
      localServerModels({
        models: [
          { name: "llama3.2:latest", model: "llama3.2:latest" },
          { name: "nomic-embed-text" },
        ],
      }),
    ).toEqual([{ id: "llama3.2:latest", label: "llama3.2:latest" }])
    expect(localServerModels({ data: [{ id: "qwen3-8b" }] })).toEqual([
      { id: "qwen3-8b", label: "qwen3-8b" },
    ])
    expect(localServerModels(null)).toEqual([])
  })

  it("reports only servers that answer", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("11434"))
        return new Response(JSON.stringify({ models: [{ name: "llama3.2" }] }))
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof fetch
    const found = await detectLocalModelServers(fetchImpl)
    expect(found.map((s) => s.id)).toEqual(["ollama"])
    expect(found[0]?.models).toEqual([{ id: "llama3.2", label: "llama3.2" }])
  })
})
