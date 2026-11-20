import type { AudioOutput, Voice } from "./types"

export const DEFAULT_CHATTERBOX_MODEL = "chatterbox-turbo"

export async function listVoices(baseUrl: string, signal?: AbortSignal): Promise<Voice[]> {
  const root = baseUrl.trim().replace(/\/+$/, "")
  const apiUrl = /\/v1$/i.test(root) ? root : `${root}/v1`

  try {
    const res = await fetch(`${apiUrl}/models`, {
      headers: { accept: "application/json" },
      signal: signal ?? AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      const data = (await res.json()) as any
      const list = (data?.data ?? [])
        .map((m: any): Voice => ({ id: String(m?.id ?? ""), label: String(m?.id ?? "") }))
        .filter((v: Voice) => v.id)
      if (list.length) return list
    }
  } catch {
    // Try /audio/voices fallback
  }

  try {
    const res = await fetch(`${apiUrl}/audio/voices`, {
      headers: { accept: "application/json" },
      signal: signal ?? AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      const data = (await res.json()) as any
      const list = (data?.voices ?? [])
        .map((m: any): Voice => ({
          id: String(m?.id ?? m?.filename ?? m ?? ""),
          label: String(m?.name ?? m?.display_name ?? m?.id ?? m ?? ""),
        }))
        .filter((v: Voice) => v.id)
      if (list.length) return list
    }
  } catch {
    // Return fallback
  }

  return [{ id: "default", label: "Default", description: "Built-in Chatterbox voice" }]
}

export async function synthesize(
  text: string,
  voiceId: string,
  baseUrl: string,
  model = DEFAULT_CHATTERBOX_MODEL,
  signal?: AbortSignal,
): Promise<AudioOutput> {
  const root = baseUrl.trim().replace(/\/+$/, "")
  const apiUrl = /\/v1$/i.test(root) ? root : `${root}/v1`

  const res = await fetch(`${apiUrl}/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "audio/wav" },
    body: JSON.stringify({
      model: model || DEFAULT_CHATTERBOX_MODEL,
      input: text,
      voice: voiceId || "default",
      response_format: "wav",
    }),
    signal: signal
      ? AbortSignal.any([AbortSignal.timeout(60_000), signal])
      : AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(
      `Chatterbox speech generation failed (${res.status}): ${errorText.slice(0, 200)}`,
    )
  }

  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "audio/wav"
  const bytes = Buffer.from(await res.arrayBuffer())
  return { bytes, mime }
}
