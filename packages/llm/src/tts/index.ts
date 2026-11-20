import type { AudioOutput, TtsOptions, Voice, VoiceCredentials, VoiceProvider } from "./types"
import * as chatterbox from "./chatterbox"
import * as deepseek from "./deepseek"
import * as elevenlabs from "./elevenlabs"
import * as fish from "./fish"
import * as gemini from "./gemini"
import * as grok from "./grok"
import * as openai from "./openai"
import * as system from "./system"

export * from "./types"

export function isProviderConfigured(provider: VoiceProvider, creds: VoiceCredentials): boolean {
  if (provider === "system") return system.isAvailable()
  if (provider === "chatterbox") return Boolean(creds.chatterboxBaseUrl?.trim())
  if (provider === "fish") return Boolean(creds.fishKey?.trim())
  if (provider === "openai") return Boolean(creds.openaiKey?.trim())
  if (provider === "gemini") return Boolean(creds.geminiKey?.trim())
  if (provider === "xai") return Boolean(creds.xaiKey?.trim())
  if (provider === "deepseek") return Boolean(creds.deepseekKey?.trim())
  return Boolean(creds.elevenlabsKey?.trim())
}

export async function listProviderVoices(
  provider: VoiceProvider,
  creds: VoiceCredentials,
  signal?: AbortSignal,
): Promise<Voice[]> {
  switch (provider) {
    case "system":
      return system.listVoices()
    case "chatterbox":
      return creds.chatterboxBaseUrl ? chatterbox.listVoices(creds.chatterboxBaseUrl, signal) : []
    case "fish":
      return creds.fishKey ? fish.listVoices(creds.fishKey, undefined, signal) : []
    case "openai":
      return openai.listVoices()
    case "gemini":
      return gemini.listVoices()
    case "xai":
      return creds.xaiKey ? grok.listVoices(creds.xaiKey, undefined, signal) : []
    case "deepseek":
      return deepseek.listVoices()
    case "elevenlabs":
    default:
      return creds.elevenlabsKey
        ? elevenlabs.listVoices(creds.elevenlabsKey, undefined, signal)
        : []
  }
}

export async function synthesizeSpeech(
  provider: VoiceProvider,
  text: string,
  creds: VoiceCredentials,
  options: TtsOptions = {},
): Promise<AudioOutput> {
  const { voiceId = "", model, baseUrl, signal } = options

  switch (provider) {
    case "system":
      return system.synthesize(text, voiceId)
    case "chatterbox": {
      const url = baseUrl || creds.chatterboxBaseUrl
      if (!url) throw new Error("Chatterbox server address is required")
      return chatterbox.synthesize(text, voiceId, url, model, signal)
    }
    case "fish": {
      const key = creds.fishKey
      if (!key) throw new Error("Fish Audio key is required")
      return fish.synthesize(text, voiceId, key, model, undefined, signal)
    }
    case "openai": {
      const key = creds.openaiKey
      if (!key) throw new Error("OpenAI key is required")
      return openai.synthesize(text, voiceId, key, model, undefined, signal)
    }
    case "gemini": {
      const key = creds.geminiKey
      if (!key) throw new Error("Gemini key is required")
      return gemini.synthesize(text, voiceId, key, model, undefined, signal)
    }
    case "xai": {
      const key = creds.xaiKey
      if (!key) throw new Error("xAI Grok key is required")
      return grok.synthesize(text, voiceId, key, undefined, signal)
    }
    case "deepseek": {
      const key = creds.deepseekKey
      if (!key) throw new Error("DeepSeek key is required")
      return deepseek.synthesize(text, voiceId, key, undefined, signal)
    }
    case "elevenlabs":
    default: {
      const key = creds.elevenlabsKey
      if (!key) throw new Error("ElevenLabs key is required")
      return elevenlabs.synthesize(text, voiceId, key, undefined, model, signal)
    }
  }
}

export async function transcribeAudio(
  provider: VoiceProvider,
  audio: Buffer,
  mime: string,
  creds: VoiceCredentials,
  signal?: AbortSignal,
): Promise<string> {
  if (provider === "deepseek" && creds.deepseekKey) {
    return deepseek.transcribe(audio, creds.deepseekKey, undefined, signal)
  }
  if (provider === "fish" && creds.fishKey) {
    return fish.transcribe(audio, mime, creds.fishKey, undefined, signal)
  }
  if (provider === "openai" && creds.openaiKey) {
    return openai.transcribe(audio, creds.openaiKey, undefined, undefined, signal)
  }
  if (creds.elevenlabsKey) {
    return elevenlabs.transcribe(audio, mime, creds.elevenlabsKey, undefined, signal)
  }
  throw new Error("No transcription API key configured")
}
