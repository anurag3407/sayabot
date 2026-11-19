import type { VoiceCredentials, VoiceProvider } from "@sayabot/llm"

export interface VoiceSystemConfig {
  provider: VoiceProvider
  defaultVoice: string
  everyReply: boolean
  creds: VoiceCredentials
}

export function resolveVoiceCredentials(): VoiceCredentials {
  return {
    elevenlabsKey: process.env.ELEVENLABS_API_KEY || process.env.TTS_KEY,
    fishKey: process.env.FISH_AUDIO_API_KEY || process.env.FISH_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    geminiKey: process.env.GEMINI_API_KEY,
    xaiKey: process.env.XAI_API_KEY,
    deepseekKey: process.env.DEEPSEEK_API_KEY,
    chatterboxBaseUrl: process.env.CHATTERBOX_BASE_URL,
  }
}

export function resolveDefaultProvider(creds: VoiceCredentials): VoiceProvider {
  if (process.env.SAYABOT_VOICE_PROVIDER) {
    return process.env.SAYABOT_VOICE_PROVIDER as VoiceProvider
  }
  if (creds.elevenlabsKey) return "elevenlabs"
  if (creds.openaiKey) return "openai"
  if (creds.fishKey) return "fish"
  if (creds.geminiKey) return "gemini"
  if (creds.chatterboxBaseUrl) return "chatterbox"
  if (process.platform === "darwin") return "system"
  return "openai"
}

export function getVoiceConfig(): VoiceSystemConfig {
  const creds = resolveVoiceCredentials()
  const provider = resolveDefaultProvider(creds)
  const defaultVoice = process.env.SAYABOT_DEFAULT_VOICE || (provider === "openai" ? "alloy" : "")
  const everyReply = process.env.SAYABOT_VOICE_EVERY_REPLY === "true"

  return {
    provider,
    defaultVoice,
    everyReply,
    creds,
  }
}
