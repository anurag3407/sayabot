# Voice Note Tool (`send_voice_note`)

Autonomous agents can speak directly to human team members and send voice notes in rooms. When an agent decides to convey a verbal summary, greetings, executive debrief, or alert, it invokes the built-in `send_voice_note` tool.

Source file: `apps/orchestrator/src/tools/builtins/voice-note.ts` (tests: `voice-note.test.ts`).

## Specification

- **Tool Name**: `send_voice_note`
- **Safety Classification**: `dangerous: false` (safe, non-destructive read/send tool; runs without human approval gate)
- **Agent Capability**: `caps.voice !== false` (default enabled in all room agents)

### Inputs

```typescript
{
  text: string       // 1 to 1000 characters of natural conversational prose to speak
  voice?: string     // Optional voice identifier (e.g. "alloy", "nova", "Aoede")
  provider?: string  // Optional TTS provider override ("elevenlabs" | "fish" | "openai" | "gemini" | "grok" | "system")
}
```

### Execution Flow

1. The orchestrator validates the input text length (1 to 1000 chars).
2. Cleans the text using `speakable()` from `@sayabot/core/speech-text` to ensure zero markdown or syntax artifacts.
3. Invokes `synthesizeSpeech()` from `@sayabot/llm/tts` using the room's preferred or default TTS provider.
4. Stores the generated audio binary as a base64 Data URL or public bucket asset.
5. Injects the audio note into room message metadata:
   ```json
   {
     "voiceNote": {
       "audioUrl": "data:audio/mpeg;base64,...",
       "mime": "audio/mpeg",
       "durationMs": 4200,
       "text": "Deployment finished cleanly. All health checks are green.",
       "provider": "openai",
       "voice": "nova"
     }
   }
   ```
6. The web client immediately renders an interactive `VoiceNoteBubble` with audio waveform, scrubber, speed controls, and transcript.

---

## Live Voice Sessions & Spoken Approval Protocol

Beyond one-way voice notes, Sayabot supports real-time bidirectional voice sessions with spoken approval verification:

### Endpoints (`apps/orchestrator/src/tts/routes.ts`)

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/v1/tts/live/session` | `POST` | Starts or joins a live voice session for a room (`roomId`, `orgId`, `agentId`). |
| `/v1/tts/live/session/:roomId` | `GET` | Retrieves active live voice session participants and history. |
| `/v1/tts/live/spoken-approval` | `POST` | Evaluates spoken transcript for affirmative/negative intent and resolves `toolCalls` approval waiters. |
| `/v1/tts/live/prompt` | `POST` | Generates a concise speakable approval query for pending tool executions. |

### Spoken Decision Classifier (`apps/orchestrator/src/tts/spoken-approval.ts`)

- **Affirmative (`"approved"`)**: Matches `"yes"`, `"approve"`, `"proceed"`, `"go ahead"`, `"confirm"`, `"run it"`, `"sure"`.
- **Negative (`"rejected"`)**: Matches `"no"`, `"reject"`, `"cancel"`, `"deny"`, `"stop"`, `"abort"`, `"don't"`.
- **Ambiguous (`"unclear"`)**: Asks the user to repeat or clarify.

## Related docs

- [Speech text normalization](../../core/speech-text.md) — Normalizer rules
- [LLM TTS Engine](../../llm/tts.md) — Multi-provider backend
- [Web Voice UI](../../web/voice.md) — Frontend audio players and call modal
