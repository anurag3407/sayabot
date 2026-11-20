# Text-to-Speech (TTS) & Audio Transcription Engine

Sayabot provides a multi-provider speech synthesis and audio transcription abstraction layer supporting cloud APIs, self-hosted inference servers, and offline operating system synthesis.

Source directory: `packages/llm/src/tts/` (tests: `tts.test.ts`).

## Supported Providers

| Provider       | Model / Engine                            | Capabilities                                                                       | Credential resolution          |
| :------------- | :---------------------------------------- | :--------------------------------------------------------------------------------- | :----------------------------- |
| **ElevenLabs** | `eleven_turbo_v2_5` / `eleven_flash_v2_5` | High-fidelity expressive TTS, Voice catalog, Audio transcription                   | `ELEVENLABS_API_KEY`           |
| **Fish Audio** | `s2.1-pro`                                | Low-latency bilingual speech, Voice search, Webhook STT                            | `FISH_AUDIO_API_KEY`           |
| **OpenAI**     | `tts-1`, `tts-1-hd`                       | Standard voices (`alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`), Whisper STT | `OPENAI_API_KEY`               |
| **Gemini**     | `gemini-3.8-flash-lite-tts`               | 30 expressive voices (`Aoede`, `Kore`, `Puck`, `Fenrir`…), low latency             | `GEMINI_API_KEY`               |
| **xAI / Grok** | `grok-tts-1`                              | Grok conversational voice catalog                                                  | `XAI_API_KEY` / `GROK_API_KEY` |
| **Chatterbox** | OpenAI-compatible local server            | Local inference, zero telemetry                                                    | `CHATTERBOX_BASE_URL`          |
| **System**     | macOS `/usr/bin/say`                      | Built-in offline fallback on Mac workstations                                      | Built-in (no key needed)       |
| **DeepSeek**   | DeepSeek Voice API                        | Speech synthesis & transcription                                                   | `DEEPSEEK_API_KEY`             |

## Core APIs

```typescript
import {
  synthesizeSpeech,
  listProviderVoices,
  transcribeAudio,
  isProviderConfigured,
} from "@sayabot/llm"

// Synthesize audio
const { audio, mimeType, durationMs } = await synthesizeSpeech({
  text: "Hello team! Review completed successfully.",
  provider: "openai", // Optional, defaults to first configured provider
  voice: "nova",
  speed: 1.0,
})

// Query available voices
const voices = await listProviderVoices("gemini")

// Transcribe microphone input (WAV/MP3/M4A)
const { text } = await transcribeAudio(audioBuffer, "audio/wav", "openai")
```

## Security & Architectural Constraints

- **No Plaintext Secrets**: API keys are resolved server-side from environment variables or envelope-encrypted organization vault entries (`packages/llm/src/crypto.ts`). Keys are never sent to browser clients.
- **Failover & Offline Support**: If cloud keys are unconfigured, macOS local development environments fall back cleanly to `system` synthesis (`/usr/bin/say` to AIFF/WAV).

## Related docs

- [Speech text normalization](../core/speech-text.md) — Prose cleaning and TTFB utterance chunking
- [Voice Note Tool](../orchestrator/tools/voice-note.md) — Autonomous voice notes in agent turns
- [Web Voice UI](../web/voice.md) — Streaming audio prefetcher and take-turns call interface
