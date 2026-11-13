import { describe, expect, it } from "vitest"
import {
  parseSayaModels,
  publicSayaAi,
  readSayaAiConfig,
  resolveSayaFastModel,
  resolveSayaModel,
  sayaModelLabel,
} from "./saya-ai"

const env = {
  SAYA_AI_BASE_URL: "https://llm.example.com/v1/",
  SAYA_AI_API_KEY: "sk-test",
  SAYA_AI_MODELS: "pro=gpt-5.1|Saya Pro, fast=gpt-5.1-mini|Saya Fast",
}

describe("Saya AI config", () => {
  it("parses aliases, ids and labels", () => {
    expect(parseSayaModels("pro=a|Pro, b, Weird Alias=c")).toEqual([
      { alias: "pro", id: "a", label: "Pro" },
      { alias: "b", id: "b", label: "b" },
      { alias: "weird-alias", id: "c", label: "Saya AI Weird Alias" },
    ])
    expect(parseSayaModels("x=a, x=b")).toHaveLength(1)
  })

  it("reads the env with defaults", () => {
    const config = readSayaAiConfig(env)
    expect(config).toMatchObject({
      name: "Saya AI",
      protocol: "openai-compatible",
      baseUrl: "https://llm.example.com/v1",
      defaultAlias: "pro",
      fastAlias: "fast",
    })
  })

  it("is off without an endpoint or models", () => {
    expect(readSayaAiConfig({})).toBeNull()
    expect(readSayaAiConfig({ SAYA_AI_BASE_URL: "https://x" })).toBeNull()
  })

  it("supports the single-model shorthand and the old DEV_OPENAI_COMPAT_* settings", () => {
    const single = readSayaAiConfig({
      SAYA_AI_BASE_URL: "https://x",
      SAYA_AI_MODEL: "m1",
      SAYA_AI_NAME: "Acme AI",
    })
    expect(single?.models).toEqual([{ alias: "default", id: "m1", label: "Acme AI" }])
    const legacy = readSayaAiConfig({
      DEV_OPENAI_COMPAT_BASE_URL: "https://old",
      DEV_OPENAI_COMPAT_API_KEY: "k",
      DEV_OPENAI_COMPAT_MODEL: "old-model",
    })
    expect(legacy).toMatchObject({
      baseUrl: "https://old",
      apiKey: "k",
      models: [{ alias: "default", id: "old-model" }],
    })
    // Leftover SAYA_AI_MODELS (e.g. copied from the example) never reaches the old endpoint.
    const mixed = readSayaAiConfig({
      SAYA_AI_MODELS: "pro=placeholder",
      DEV_OPENAI_COMPAT_BASE_URL: "https://old",
      DEV_OPENAI_COMPAT_API_KEY: "k",
      DEV_OPENAI_COMPAT_MODEL: "old-model",
    })
    expect(mixed?.models.map((m) => m.id)).toEqual(["old-model"])
  })

  it("follows the operator when the model behind an alias changes", () => {
    const before = readSayaAiConfig(env)!
    const after = readSayaAiConfig({
      ...env,
      SAYA_AI_MODELS: "pro=gpt-6|Saya Pro, fast=gpt-6-mini|Saya Fast",
    })!
    expect(resolveSayaModel(before, "saya/pro").id).toBe("gpt-5.1")
    expect(resolveSayaModel(after, "saya/pro").id).toBe("gpt-6")
  })

  it("falls back to the default for null and removed aliases, never failing", () => {
    const config = readSayaAiConfig({ ...env, SAYA_AI_DEFAULT: "fast" })!
    expect(resolveSayaModel(config, null).alias).toBe("fast")
    expect(resolveSayaModel(config, "saya/gone").alias).toBe("fast")
    expect(resolveSayaModel(config, "gpt-4o").alias).toBe("fast")
    expect(resolveSayaFastModel(config).id).toBe("gpt-5.1-mini")
  })

  it("labels and the public view hide the real ids, key and endpoint", () => {
    const config = readSayaAiConfig(env)!
    expect(sayaModelLabel(config, "saya/fast")).toBe("Saya Fast")
    expect(sayaModelLabel(config, null)).toBe("Saya AI · Automatic (Saya Pro)")
    const view = JSON.stringify(publicSayaAi(config))
    expect(view).not.toMatch(/gpt-5|sk-test|llm\.example/)
    expect(publicSayaAi(config).models.map((m) => m.value)).toEqual(["saya/pro", "saya/fast"])
  })
})
