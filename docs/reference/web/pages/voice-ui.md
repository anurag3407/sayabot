# Voice, Speech & Take-Turns Audio System

Sayabot includes a full-featured voice layer inspired by OpenMausBot, bringing spoken turns, voice notes, live dictation, and real-time take-turns audio calls to multiplayer rooms.

Source files:
- Client TTS & VAD library: `apps/web/src/lib/tts/` (`speaker.ts`, `vad.ts`, `use-speech.ts`)
- Voice UI components: `apps/web/src/components/voice/` (`speak-button.tsx`, `voice-note-bubble.tsx`, `dictation-button.tsx`, `call-modal.tsx`, `voice-settings-dialog.tsx`)

## 1. Spoken Replies & Streaming Prefetch (`SpeakerManager`)

Clicking the read-aloud button (`SpeakButton`) on any message invokes the streaming prefetch pipeline:
1. Calls `/api/v1/tts/prepare` to sanitize prose and break it into sentence-level utterances with a 90-character first-block TTFB fast path.
2. Prefetches the first 3 utterances in parallel via `/api/v1/tts/speak`.
3. Utterance 0 starts playing immediately (<200ms). As each utterance finishes playing, the next queued chunk begins without audio gaps while keeping 3 utterances prefetched in advance.
4. Clean interruption: Clicking stop, switching messages, or closing the tab immediately aborts pending network fetches and revokes object URLs.

## 2. Interactive Voice Note Bubbles (`VoiceNoteBubble`)

When an agent invokes `send_voice_note` or when "Voice note with every reply" is active, messages display interactive voice bubbles:
- Circular Play / Pause toggle
- SVG audio waveform with click-to-seek scrub bar
- Current time / Duration counter
- Playback speed selector (`1x`, `1.5x`, `2x`)
- Expandable / collapsible transcript drawer

## 3. Composer Microphone Dictation (`DictationButton`)

Mounted right next to the composer's send button:
- Clicking the microphone activates browser Web Audio input.
- Displays volume level pulse ring.
- **VAD Silence Endpointing**: Automatically finishes recording when silence is detected (~1.7s) or when clicked to stop.
- Sends 16kHz mono 16-bit WAV audio to `/api/v1/tts/transcribe` (Whisper / OpenAI / Fish Audio / DeepSeek STT) and injects the transcribed text directly into the composer.

## 4. Take-Turns Audio Calls (`CallModal`)

Clicking the phone icon in the room header opens a dedicated audio call session with the agent:
- **Half-duplex turn-taking**: User speaks -> silence endpointing auto-sends -> agent turn runs -> agent reply is spoken aloud via TTS -> mic re-arms.
- **Tool narration chips**: While the agent runs tools during a turn, chips appear in the call window (e.g. `Running web search…`, `Reading file…`).
- **Spoken approvals**: When a dangerous tool triggers human review, the agent asks verbally (`"Action bash requires your approval. Say yes to approve or no to cancel"`). The user can reply verbally with *"yes"* / *"approve"* or click the on-screen buttons.
- Call controls: Mute microphone, mute agent speaker, end call.

## 5. Voice & Provider Settings (`VoiceSettingsDialog`)

Accessible via the room's details menu:
- Select TTS provider (ElevenLabs, Fish Audio, OpenAI, Gemini, Grok, Chatterbox, System).
- Select specific voices per provider with live audio sample preview.
- Set speech speed (`0.85x` to `1.3x`).
- Toggle "Voice note with every reply" per room.

## Related docs

- [Speech text normalization](../../core/speech-text.md) — Normalizer rules
- [LLM TTS Engine](../../llm/tts.md) — Multi-provider backend
- [Voice Note Tool](../../orchestrator/tools/tool-voice-note.md) — `send_voice_note` tool
