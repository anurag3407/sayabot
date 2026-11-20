import type { AudioOutput, Voice } from "./types"

const DEFAULT_API = "https://api.fish.audio/v1"
export const DEFAULT_FISH_MODEL = "s2.1-pro"

export async function listVoices(
  apiKey: string,
  api = DEFAULT_API,
  signal?: AbortSignal,
): Promise<Voice[]> {
  const url = `${api.replace(/\/+$/, "")}/model`
  const res = await fetch(url, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`Fish Audio list voices failed (${res.status}): ${errorText.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    items?: Array<{ _id: string; title: string; description?: string }>
  }
  return (data.items ?? []).map((item) => ({
    id: item._id,
    label: item.title,
    description: item.description,
  }))
}

export async function synthesize(
  text: string,
  voiceId: string,
  apiKey: string,
  model = DEFAULT_FISH_MODEL,
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
      reference_id: voiceId,
      model,
      format: "mp3",
    }),
    signal: signal
      ? AbortSignal.any([AbortSignal.timeout(60_000), signal])
      : AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`Fish Audio synthesis failed (${res.status}): ${errorText.slice(0, 200)}`)
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

  const res = await fetch(`${api.replace(/\/+$/, "")}/asr`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: signal ?? AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`Fish Audio transcription failed (${res.status}): ${errorText.slice(0, 200)}`)
  }

  const data = (await res.json()) as { text?: string }
  return data.text?.trim() ?? ""
}
