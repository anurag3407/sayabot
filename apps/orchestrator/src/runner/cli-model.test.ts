import { generateObject, generateText } from "ai"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import * as cli from "./cli"
import { createCliLanguageModel, flattenPrompt } from "./cli-model"

const outcome = (text: string) => ({
  ok: true,
  text,
  error: null,
  aborted: false,
  model: "claude-haiku-5-5",
  usage: { inputTokens: 10, outputTokens: 3, cachedInputTokens: 0 },
})

describe("createCliLanguageModel", () => {
  afterEach(() => vi.restoreAllMocks())

  it("answers generateText through the app with the system prompt kept separate", async () => {
    const run = vi.spyOn(cli, "runCliProcess").mockResolvedValue(outcome("ok"))
    const result = await generateText({
      model: createCliLanguageModel({ app: "claude-code", model: "claude-haiku-5-5" }),
      system: "Be brief.",
      prompt: "Say ok",
    })
    expect(result.text).toBe("ok")
    expect(result.usage.outputTokens).toBe(3)
    expect(run.mock.calls[0]?.[0]).toMatchObject({ system: "Be brief.", prompt: "Say ok" })
  })

  it("supports generateObject for the moderator, even when the app wraps JSON in a fence", async () => {
    const run = vi
      .spyOn(cli, "runCliProcess")
      .mockResolvedValue(outcome('```json\n{"next":"human","reason":"done"}\n```'))
    const result = await generateObject({
      model: createCliLanguageModel({ app: "codex", model: null }),
      prompt: "Who speaks next?",
      schema: z.object({ next: z.string(), reason: z.string() }),
    })
    expect(result.object).toEqual({ next: "human", reason: "done" })
    expect(run.mock.calls[0]?.[0].prompt).toContain("JSON schema")
  })

  it("surfaces the app's error", async () => {
    vi.spyOn(cli, "runCliProcess").mockResolvedValue({
      ...outcome(""),
      ok: false,
      error: "Claude Code isn't signed in",
    })
    await expect(
      generateText({
        model: createCliLanguageModel({ app: "claude-code", model: null }),
        prompt: "hi",
      }),
    ).rejects.toThrow("isn't signed in")
  })
})

describe("flattenPrompt", () => {
  it("labels turns in a multi-message conversation", () => {
    const flat = flattenPrompt([
      { role: "system", content: "S" },
      { role: "user", content: [{ type: "text", text: "Q" }] },
      { role: "assistant", content: [{ type: "text", text: "A" }] },
    ])
    expect(flat.system).toBe("S")
    expect(flat.prompt).toBe("USER:\nQ\n\nASSISTANT:\nA")
  })
})
