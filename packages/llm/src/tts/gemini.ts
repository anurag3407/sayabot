import type { AudioOutput, Voice } from "./types"

const DEFAULT_API = "https://generativelanguage.googleapis.com/v1beta"
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash-lite-tts"

export const GEMINI_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
]

export function listVoices(): Voice[] {
  return GEMINI_VOICES.map((v) => ({ id: v, label: v }))
}

export async function synthesize(
  text: string,
  voiceId: string,
  apiKey: string,
  model = DEFAULT_GEMINI_MODEL,
  api = DEFAULT_API,
  signal?: AbortSignal,
): Promise<AudioOutput> {
  const url = `${api.replace(/\/+$/, "")}/interactions`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [{ type: "user_input", content: [{ type: "text", text }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: voiceId || "Puck" }] },
    }),
    signal: signal
      ? AbortSignal.any([AbortSignal.timeout(60_000), signal])
      : AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "")
    throw new Error(`Gemini speech generation failed (${res.status}): ${errorText.slice(0, 200)}`)
  }

  const json = (await res.json().catch(() => null)) as any
  const audioPart = json?.steps
    ?.filter((s: any) => s.type === "model_output")
    ?.flatMap((s: any) => s.content ?? [])
    ?.filter((p: any) => p.type === "audio")
    ?.at(-1)

  if (!audioPart?.data) {
    throw new Error("Gemini returned no audio data")
  }

  const bytes = Buffer.from(audioPart.data, "base64")
  return { bytes, mime: audioPart.mime_type || "audio/wav" }
}
