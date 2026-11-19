import { describe, expect, it } from "vitest"
import {
  isProviderConfigured,
  listProviderVoices,
  synthesizeSpeech,
  type VoiceCredentials,
} from "./index"

describe("TTS provider configuration and voice listing", () => {
  it("determines whether providers are configured correctly based on credentials", () => {
    const emptyCreds: VoiceCredentials = {}
    expect(isProviderConfigured("openai", emptyCreds)).toBe(false)
    expect(isProviderConfigured("elevenlabs", emptyCreds)).toBe(false)
    expect(isProviderConfigured("fish", emptyCreds)).toBe(false)

    const withOpenAI: VoiceCredentials = { openaiKey: "sk-test" }
    expect(isProviderConfigured("openai", withOpenAI)).toBe(true)

    const withChatterbox: VoiceCredentials = { chatterboxBaseUrl: "http://localhost:5000" }
    expect(isProviderConfigured("chatterbox", withChatterbox)).toBe(true)
  })

  it("lists static prebuilt voices for OpenAI and Gemini without network calls", async () => {
    const creds: VoiceCredentials = { openaiKey: "test", geminiKey: "test" }
    const openaiVoices = await listProviderVoices("openai", creds)
    expect(openaiVoices.length).toBeGreaterThan(0)
    expect(openaiVoices.some((v) => v.id === "alloy")).toBe(true)

    const geminiVoices = await listProviderVoices("gemini", creds)
    expect(geminiVoices.length).toBeGreaterThan(10)
    expect(geminiVoices.some((v) => v.id === "Puck")).toBe(true)
  })

  it("throws clear error when synthesizing without required credentials", async () => {
    const creds: VoiceCredentials = {}
    await expect(synthesizeSpeech("openai", "Hello world", creds)).rejects.toThrow(
      "OpenAI key is required",
    )
    await expect(synthesizeSpeech("elevenlabs", "Hello world", creds)).rejects.toThrow(
      "ElevenLabs key is required",
    )
    await expect(synthesizeSpeech("chatterbox", "Hello world", creds)).rejects.toThrow(
      "Chatterbox server address is required",
    )
  })
})
