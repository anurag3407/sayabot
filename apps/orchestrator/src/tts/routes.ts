import { redactSecrets, toUtterances, VOICE_FIRST_BLOCK_MAX_CHARS } from "@sayabot/core"
import {
  isProviderConfigured,
  listProviderVoices,
  synthesizeSpeech,
  transcribeAudio,
  type VoiceProvider,
} from "@sayabot/llm"
import { Hono } from "hono"
import { z } from "zod"
import { getVoiceConfig, resolveVoiceCredentials } from "./config"
import { liveVoiceSessionManager } from "./live-voice"
import { generateSpokenApprovalPrompt, processSpokenDecision } from "./spoken-approval"

const prepareSchema = z.object({
  text: z.string().default(""),
  voiceId: z.string().optional(),
})

const speakSchema = z.object({
  text: z.string().min(1),
  voiceId: z.string().optional(),
  provider: z
    .enum(["elevenlabs", "fish", "openai", "gemini", "xai", "chatterbox", "system", "deepseek"])
    .optional(),
  model: z.string().optional(),
})

export const ttsRoutes = new Hono()

// GET /v1/tts/config - returns whether voice is ready without exposing any secret keys
ttsRoutes.get("/config", (c) => {
  const config = getVoiceConfig()
  const ready = isProviderConfigured(config.provider, config.creds)
  return c.json({
    ok: true,
    configured: ready,
    provider: config.provider,
    defaultVoice: config.defaultVoice,
    everyReply: config.everyReply,
  })
})

// POST /v1/tts/prepare - sanitizes text, masks secrets, and splits into utterances
ttsRoutes.post("/prepare", async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = prepareSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: "Invalid payload" }, 400)
  }

  const config = getVoiceConfig()
  const ready = isProviderConfigured(config.provider, config.creds)

  // Redact secrets so API keys, tokens, or hashes are never spoken aloud
  const safeText = redactSecrets(parsed.data.text).text
  const utterances = toUtterances(safeText, { firstBlockMaxChars: VOICE_FIRST_BLOCK_MAX_CHARS })

  return c.json({
    ok: true,
    ready,
    provider: config.provider,
    utterances,
  })
})

// GET /v1/tts/voices - lists available voices for the provider
ttsRoutes.get("/voices", async (c) => {
  const config = getVoiceConfig()
  const provider = (c.req.query("provider") as VoiceProvider) || config.provider

  try {
    const voices = await listProviderVoices(provider, config.creds)
    return c.json({ ok: true, provider, voices })
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to list voices",
        voices: [],
      },
      502,
    )
  }
})

// POST /v1/tts/speak - synthesizes an utterance into audio bytes
ttsRoutes.post("/speak", async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parsed = speakSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: "Invalid speak payload", issues: parsed.error.issues }, 400)
  }

  const text = parsed.data.text.trim()
  // Ceiling to protect against unbounded third-party billing
  if (text.length > 500) {
    return c.json({ error: "Utterance exceeds 500 character limit" }, 413)
  }

  const config = getVoiceConfig()
  const provider = parsed.data.provider || config.provider
  const voiceId = parsed.data.voiceId || config.defaultVoice

  try {
    const audio = await synthesizeSpeech(provider, text, config.creds, {
      voiceId,
      model: parsed.data.model,
    })

    return new Response(Buffer.from(audio.bytes), {
      status: 200,
      headers: {
        "content-type": audio.mime,
        "content-length": String(audio.bytes.byteLength),
        "cache-control": "no-store",
      },
    })
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Speech synthesis failed",
      },
      502,
    )
  }
})

// POST /v1/tts/transcribe - transcribes uploaded audio
ttsRoutes.post("/transcribe", async (c) => {
  const rawType = c.req.header("content-type") || ""
  const mime = rawType.split(";")[0]?.trim().toLowerCase() || "audio/wav"

  const arrayBuffer = await c.req.arrayBuffer().catch(() => null)
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    return c.json({ error: "Audio data required" }, 400)
  }

  // 12 MB max audio size
  if (arrayBuffer.byteLength > 12 * 1024 * 1024) {
    return c.json({ error: "Audio exceeds 12 MB limit" }, 413)
  }

  const config = getVoiceConfig()
  const provider = (c.req.query("provider") as VoiceProvider) || config.provider
  const creds = resolveVoiceCredentials()

  try {
    const text = await transcribeAudio(provider, Buffer.from(arrayBuffer), mime, creds)
    return c.json({ ok: true, text })
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Transcription failed",
      },
      502,
    )
  }
})

// POST /v1/tts/live/session - starts or creates a live bidirectional voice session for a room
ttsRoutes.post("/live/session", async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { roomId, orgId, agentId, provider } = body
  if (!roomId || !orgId || !agentId) {
    return c.json({ error: "roomId, orgId, and agentId are required" }, 400)
  }

  const session = liveVoiceSessionManager.createSession({
    roomId,
    orgId,
    agentId,
    provider,
  })

  return c.json({
    ok: true,
    sessionId: session.sessionId,
    roomId: session.roomId,
    status: session.status,
    provider: session.provider,
  })
})

// GET /v1/tts/live/session/:roomId - retrieves active live voice session
ttsRoutes.get("/live/session/:roomId", (c) => {
  const roomId = c.req.param("roomId")
  const session = liveVoiceSessionManager.getSessionForRoom(roomId)
  if (!session) {
    return c.json({ ok: false, error: "No active live voice session found for this room" }, 404)
  }

  return c.json({
    ok: true,
    sessionId: session.sessionId,
    status: session.status,
    participants: Array.from(session.activeParticipants),
    historyCount: session.spokenHistory.length,
  })
})

// POST /v1/tts/live/spoken-approval - evaluates spoken decision for a pending tool call
ttsRoutes.post("/live/spoken-approval", async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { toolCallId, spokenText } = body
  if (!toolCallId || typeof spokenText !== "string") {
    return c.json({ error: "toolCallId and spokenText are required" }, 400)
  }

  const result = processSpokenDecision(toolCallId, spokenText)
  return c.json({ ok: true, ...result })
})

// POST /v1/tts/live/prompt - generates spoken approval prompt for a tool call
ttsRoutes.post("/live/prompt", async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { toolName, args } = body
  if (!toolName) {
    return c.json({ error: "toolName is required" }, 400)
  }

  const prompt = generateSpokenApprovalPrompt(toolName, args || {})
  return c.json({ ok: true, prompt })
})
