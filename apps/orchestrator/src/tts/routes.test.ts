import { describe, expect, it } from "vitest"
import { ttsRoutes } from "./routes"

describe("TTS routes", () => {
  it("GET /v1/tts/config returns configured status and default voice without secrets", async () => {
    const res = await ttsRoutes.request("/config", { method: "GET" })
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.ok).toBe(true)
    expect(typeof json.provider).toBe("string")
    expect(typeof json.configured).toBe("boolean")
    expect(json).not.toHaveProperty("key")
    expect(json).not.toHaveProperty("apiKey")
  })

  it("POST /v1/tts/prepare redacts secrets and produces speakable utterances", async () => {
    const res = await ttsRoutes.request("/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Here is your update. We found an issue in auth.ts and fixed it.",
      }),
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.ok).toBe(true)
    expect(Array.isArray(json.utterances)).toBe(true)
    expect(json.utterances.length).toBeGreaterThan(0)
    expect(json.utterances[0]).toContain("Here is your update.")
  })

  it("GET /v1/tts/voices returns prebuilt voices for OpenAI and Gemini", async () => {
    const res = await ttsRoutes.request("/voices?provider=openai", { method: "GET" })
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.ok).toBe(true)
    expect(Array.isArray(json.voices)).toBe(true)
    expect(json.voices.some((v: any) => v.id === "alloy")).toBe(true)
  })

  it("POST /v1/tts/speak rejects utterances exceeding 500 characters", async () => {
    const longText = "word ".repeat(120)
    const res = await ttsRoutes.request("/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: longText }),
    })
    expect(res.status).toBe(413)
  })
})
