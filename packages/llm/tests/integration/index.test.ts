import { describe, expect, it } from "vitest"
import * as llm from "@sayabot/llm"

describe("@sayabot/llm public API", () => {
  it("re-exports crypto, registry and mcp surfaces", () => {
    expect(typeof llm.sealSecret).toBe("function")
    expect(typeof llm.openSecret).toBe("function")
    expect(typeof llm.createLanguageModel).toBe("function")
    expect(typeof llm.devModelConfig).toBe("function")
    expect(typeof llm.connectMcpServers).toBe("function")
  })

  it("seal/open round-trips through the public entry point", () => {
    const kek = Buffer.alloc(32, 7).toString("base64")
    const sealed = llm.sealSecret("hello", kek)
    expect(sealed).not.toContain("hello")
    expect(llm.openSecret(sealed, kek)).toBe("hello")
  })

  it("devModelConfig is null without env and populated with it", () => {
    expect(llm.devModelConfig({})).toBeNull()
    // all three vars are required — a missing API key means no dev model
    expect(llm.devModelConfig({ DEV_OPENAI_COMPAT_BASE_URL: "http://x", DEV_OPENAI_COMPAT_MODEL: "m" })).toBeNull()
    const cfg = llm.devModelConfig({
      DEV_OPENAI_COMPAT_BASE_URL: "http://localhost:11434/v1",
      DEV_OPENAI_COMPAT_API_KEY: "k",
      DEV_OPENAI_COMPAT_MODEL: "llama3",
    })
    expect(cfg?.model).toBe("llama3")
    expect(cfg?.provider).toBe("openai-compatible")
  })
})
