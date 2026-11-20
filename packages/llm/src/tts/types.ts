export type VoiceProvider =
  "elevenlabs" | "fish" | "openai" | "gemini" | "xai" | "chatterbox" | "system" | "deepseek"

export interface Voice {
  id: string
  label: string
  description?: string
}

export interface AudioOutput {
  bytes: Buffer | Uint8Array
  mime: string
}

export interface TtsOptions {
  voiceId?: string
  model?: string
  baseUrl?: string
  signal?: AbortSignal
}

export interface VoiceCredentials {
  elevenlabsKey?: string
  fishKey?: string
  openaiKey?: string
  geminiKey?: string
  xaiKey?: string
  deepseekKey?: string
  chatterboxBaseUrl?: string
}
