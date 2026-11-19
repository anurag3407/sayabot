import type { AudioOutput, Voice } from "./types"

const DEFAULT_API = "https://api.elevenlabs.io/v1"

export async function listVoices(apiKey: string, api = DEFAULT_API, signal?: AbortSignal): Promise<Voice[]> {
  const url = `${api.replace(/\/+$/, "")}/voices`
  const res = await fetch(url, {
    method: "GET",
    headers: { "xi-api-key": apiKey, accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`ElevenLabs list voices failed (${res.status}): ${errorText.slice(0, 200)}`)
  }
  const data = (await res.json()) as { voices?: Array<{ voice_id: string; name: string; category?: string }> }
  return (data.voices ?? []).map((v) => ({
    id: v.voice_id,
    label: v.name,
    description: v.category,
  }))
}

export async function synthesize(
  text: string,
  voiceId: string,
  apiKey: string,
  api = DEFAULT_API,
  model = "eleven_multilingual_v2",
  signal?: AbortSignal,
): Promise<AudioOutput> {
  const url = `${api.replace(/\/+$/, "")}/text-to-speech/${encodeURIComponent(voiceId)}`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
    signal: signal ? AbortSignal.any([AbortSignal.timeout(60_000), signal]) : AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`ElevenLabs synthesis failed (${res.status}): ${errorText.slice(0, 200)}`)
  }

  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, mime: "audio/mpeg" }
}

export async function transcribe(
  audio: Buffer,
  mime: string,
  apiKey: string,
  api = DEFAULT_API,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData()
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), "speech.wav")
  form.append("model_id", "scribe_v1")

  const res = await fetch(`${api.replace(/\/+$/, "")}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
    signal: signal ?? AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`ElevenLabs transcription failed (${res.status}): ${errorText.slice(0, 200)}`)
  }

  const data = (await res.json()) as { text?: string }
  return data.text?.trim() ?? ""
}
