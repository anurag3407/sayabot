import type { AudioOutput, Voice } from "./types"

const DEFAULT_API = "https://api.openai.com/v1"

const OPENAI_VOICES: Voice[] = [
  { id: "alloy", label: "Alloy", description: "Neutral, balanced" },
  { id: "echo", label: "Echo", description: "Warm, conversational" },
  { id: "fable", label: "Fable", description: "British accent, expressive" },
  { id: "onyx", label: "Onyx", description: "Deep, authoritative" },
  { id: "nova", label: "Nova", description: "Energetic, bright" },
  { id: "shimmer", label: "Shimmer", description: "Clear, optimistic" },
]

export function listVoices(): Voice[] {
  return [...OPENAI_VOICES]
}

export async function synthesize(
  text: string,
  voiceId: string,
  apiKey: string,
  model = "tts-1",
  api = DEFAULT_API,
  signal?: AbortSignal,
): Promise<AudioOutput> {
  const url = `${api.replace(/\/+$/, "")}/audio/speech`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      model,
      input: text,
      voice: voiceId || "alloy",
      response_format: "mp3",
    }),
    signal: signal
      ? AbortSignal.any([AbortSignal.timeout(60_000), signal])
      : AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`OpenAI speech synthesis failed (${res.status}): ${errorText.slice(0, 200)}`)
  }

  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, mime: "audio/mpeg" }
}

export async function transcribe(
  audio: Buffer,
  apiKey: string,
  model = "whisper-1",
  api = DEFAULT_API,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData()
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "audio.wav")
  form.append("model", model)

  const res = await fetch(`${api.replace(/\/+$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: signal ?? AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`OpenAI transcription failed (${res.status}): ${errorText.slice(0, 200)}`)
  }

  const data = (await res.json()) as { text?: string }
  return data.text?.trim() ?? ""
}
