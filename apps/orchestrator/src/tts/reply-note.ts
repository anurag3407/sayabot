import { speakable } from "@sayabot/core"
import { messages } from "@sayabot/db"
import { synthesizeSpeech, type VoiceProvider } from "@sayabot/llm"
import { eq } from "drizzle-orm"
import { getDb } from "../db"
import type { AgentRow } from "../runner/context"
import { getVoiceConfig } from "./config"

export async function attachReplyVoiceNoteIfNeeded(
  agent: AgentRow,
  messageId: string,
  content: string,
): Promise<void> {
  const params = (agent.params as Record<string, unknown> | null) ?? {}
  const config = getVoiceConfig()
  const wantsNote = params.voiceNoteEveryReply === true || config.everyReply === true
  if (!wantsNote) return

  const text = speakable(content)
  if (!text) return

  const noteText = text.length > 1000 ? `${text.slice(0, 999)}…` : text
  const provider = (params.voiceProvider as VoiceProvider) || config.provider
  const voiceId = (params.voiceId as string) || config.defaultVoice

  try {
    const audio = await synthesizeSpeech(provider, noteText, config.creds, { voiceId })
    const base64 = Buffer.from(audio.bytes).toString("base64")
    const audioUrl = `data:${audio.mime};base64,${base64}`

    const wordCount = noteText.split(/\s+/).length
    const estimatedDurationSeconds = Math.max(1, Math.round(wordCount / 2.5))

    const [row] = await getDb()
      .select({ metadata: messages.metadata })
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1)

    if (row) {
      const currentMeta = (row.metadata as Record<string, unknown>) ?? {}
      await getDb()
        .update(messages)
        .set({
          metadata: {
            ...currentMeta,
            voiceNote: {
              audioUrl,
              text: noteText,
              mime: audio.mime,
              durationMs: estimatedDurationSeconds * 1000,
            },
          },
        })
        .where(eq(messages.id, messageId))
    }
  } catch (err) {
    // Non-fatal: if TTS fails (e.g. quota or offline), the text message has already safely landed
    console.error(`[voiceNoteEveryReply] Failed to attach voice note to message ${messageId}:`, err)
  }
}
