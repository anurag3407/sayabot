import { speakable } from "@sayabot/core"
import { synthesizeSpeech, type VoiceProvider } from "@sayabot/llm"
import { z } from "zod"
import { getVoiceConfig } from "../../tts/config"
import type { ToolSpec } from "../audited"

export interface VoiceNoteOptions {
  orgId: string
  agentId: string
  roomId: string
  voiceId?: string
  provider?: VoiceProvider
}

export function sendVoiceNoteTool(opts: VoiceNoteOptions): ToolSpec {
  return {
    name: "send_voice_note",
    description:
      "Synthesize and send a spoken voice note to the room in your voice. The text (up to 1,000 characters) is converted to speech and attached to your response with an inline waveform player and readable transcript.",
    schema: z.object({
      text: z
        .string()
        .min(1)
        .max(1000)
        .describe("The text to synthesize into spoken audio and display as the transcript"),
    }),
    dangerous: false,
    execute: async (input: { text: string }, signal?: AbortSignal) => {
      const text = speakable(input.text)
      if (!text) {
        return { ok: false, error: "Spoken note text must contain speakable words" }
      }

      const config = getVoiceConfig()
      const provider = opts.provider || config.provider
      const voiceId = opts.voiceId || config.defaultVoice

      try {
        const audio = await synthesizeSpeech(
          provider,
          text,
          config.creds,
          {
            voiceId,
            signal,
          },
        )

        // Generate base64 data URI so the client audio player can play it immediately
        const base64 = Buffer.from(audio.bytes).toString("base64")
        const audioUrl = `data:${audio.mime};base64,${base64}`

        // Calculate approximate duration: ~150 words per minute ≈ 2.5 words per second
        const wordCount = text.split(/\s+/).length
        const estimatedDurationSeconds = Math.max(1, Math.round(wordCount / 2.5))

        return {
          ok: true,
          text,
          audioUrl,
          mime: audio.mime,
          durationMs: estimatedDurationSeconds * 1000,
          sizeBytes: audio.bytes.byteLength,
          message: "Voice note synthesized and attached to response.",
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Failed to synthesize voice note",
        }
      }
    },
  }
}
