import type { AudioOutput, Voice } from "./types"

const DEFAULT_API = "https://api.x.ai/v1"

export async function listVoices(apiKey: string, api = DEFAULT_API, signal?: AbortSignal): Promise<Voice[]> {
  const url = `${api.replace(/\/+$/, "")}/tts/voices`
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`xAI Grok list voices failed (${res.status}): ${errorText.slice(0, 200)}`)
  }
  const data = (await res.json()) as { voices?: Array<{ voice_id: string; name: string; description?: string }> }
  return (data.voices ?? []).map((v) => ({
    id: v.voice_id,
    label: v.name,
    description: v.description,
  }))
}

export async function synthesize(
  text: string,
  voiceId: string,
  apiKey: string,
  api = DEFAULT_API,
  signal?: AbortSignal,
): Promise<AudioOutput> {
  const url = `${api.replace(/\/+$/, "")}/tts`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      voice_id: voiceId,
      language: "auto",
      output_format: { codec: "mp3" },
    }),
    signal: signal ? AbortSignal.any([AbortSignal.timeout(60_000), signal]) : AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`Grok speech synthesis failed (${res.status}): ${errorText.slice(0, 200)}`)
  }

  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, mime: "audio/mpeg" }
}
