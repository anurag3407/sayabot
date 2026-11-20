# Speech text normalization & sentence segmentation

Prose intended for voice synthesis needs to be speakable. Markdown syntax, emoji strings, raw URLs, ASCII tables, and code snippets create jarring, robotic speech if passed directly into text-to-speech models.

The speech text module cleans raw markdown into natural spoken prose and segments it into utterances optimized for streaming low-latency playback.

Source file: `packages/core/src/speech-text.ts` (tests: `speech-text.test.ts`).

## Spoken normalization (`speakable`)

`speakable(text: string): string` strips markdown formatting and replaces visual artifacts with natural prose:

- **Fenced code blocks**: Replaced with natural conversational summaries (e.g. `python ... ` becomes `". (a code block) "`).
- **Inline code**: Backticks are stripped so keywords sound natural in prose.
- **Tables**: Markdown rows and separator borders are normalized into comma-separated, readable clauses.
- **Links**: Markdown links `[label](url)` keep only the readable label. Raw URLs have protocol and trailing paths trimmed (e.g. `https://github.com/org/repo` -> `github dot com repo`).
- **Emoji**: Visual emoji sequences are stripped so the model does not attempt to speak Unicode symbols or unicode descriptions.
- **Headers & lists**: Heading hashes (`#`), blockquote signs (`>`), bold/italic asterisks (`**`, `*`), and list bullets (`-`, `*`, `1.`) are cleanly removed.
- **Thinking blocks**: Any remaining `<think>...</think>` tags and internal reasoning are excluded.

## Utterance chunking (`toUtterances`)

`toUtterances(text: string): string[]` splits normalized prose into sentence chunks for streaming playback:

- **TTFB fast-path**: The first utterance is clamped to at most `VOICE_FIRST_BLOCK_MAX_CHARS = 90` characters (breaking on the first comma, semicolon, or sentence boundary). This ensures Time-To-First-Byte audio synthesis starts immediately (<200ms) while subsequent sentences prefetch in the background.
- **Sliding sentence segmentation**: Subsequent sentences split on standard sentence boundaries (`.`, `!`, `?`, `\n`) while adhering to max utterance lengths.
- **Punctuation guarantee**: Ensures every utterance ends with proper terminal punctuation so TTS synthesis engines cadence sentences naturally without clipping pitch.

## Related docs

- [LLM TTS Engine](../llm/tts.md) — TTS multi-provider architecture and synthesis
- [Web Voice UI](../web/voice.md) — Browser streaming prefetch manager and VAD
- [Voice Note Tool](../orchestrator/tools/voice-note.md) — Autonomous voice notes in agent turns
