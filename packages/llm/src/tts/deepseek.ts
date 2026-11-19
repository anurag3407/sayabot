import type { AudioOutput, Voice } from "./types"

const DEFAULT_API = "https://api.deepseek.com/v1"

const DEEPSEEK_VOICES: Voice[] = [
  { id: "deepseek-default", label: "DeepSeek Default", description: "Balanced, clear" },
  { id: "deepseek-fast", label: "DeepSeek Fast", description: "Low latency speech" },
]

export function listVoices(): Voice[] {
  return [...DEEPSEEK_VOICES]
}

export async function synthesize(
  text: string,
  voiceId: string,
  apiKey: string,
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
      input: text,
      voice: voiceId || "deepseek-default",
      response_format: "mp3",
    }),
    signal: signal ? AbortSignal.any([AbortSignal.timeout(60_000), signal]) : AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`DeepSeek speech synthesis failed (${res.status}): ${errorText.slice(0, 200)}`)
  }

  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, mime: "audio/mpeg" }
}

export async function transcribe(
  audio: Buffer,
  apiKey: string,
  api = DEFAULT_API,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData()
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "speech.wav")

  const res = await fetch(`${api.replace(/\/+$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: signal ?? AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`DeepSeek transcription failed (${res.status}): ${errorText.slice(0, 200)}`)
  }

  const data = (await res.json()) as { text?: string }
  return data.text?.trim() ?? ""
}
