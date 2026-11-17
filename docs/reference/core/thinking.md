# Thinking blocks

Model reasoning is not part of the reply. Producers fold it into the same text the room already streams, inside `<think>` … `</think>`. The chat splits those blocks back out and shows one line — **Thinking** while it is still open, **Thought** once it has closed. The reasoning is visible only after that line is clicked.

Source files: `packages/core/src/thinking.ts` (tests: `thinking.test.ts`). The chat line is `apps/web/src/components/chat/thinking-line.tsx`, used by `message-item.tsx`.

## Tags that count

`splitThinking` recognizes `<think>`, `<thinking>`, `<reasoning>`, `<thought>`, `<antthinking>`, and the `<|think|>` … `<|/think|>` form. A block that has not closed yet (including a half-written `<thi` at the end of a stream) is reasoning, not answer text, so the marker never flashes in the reply.

## Building a stream

`appendThinking(fold, "thinking" | "answer", text)` returns only the new characters. The first reasoning chunk opens `<think>`; the first answer chunk after that closes it. `closeThinking` closes a block that never reached an answer. `formatReply(thinking, answer)` is the saved message when a runner has the two pieces separately and wants one clean string.

Callers:

- Engine v2 (`apps/orchestrator/src/engine/run.ts`) and `streamAgentText` fold AI SDK `reasoning-delta` parts this way. The room still receives them as `message.delta`.
- Sayabot for Mac folds Claude `thinking_delta` events and ACP `agent_thought_chunk` updates the same way. The desktop build copies `appendThinking` / `closeThinking` / `formatReply` into `apps/desktop/src/mac-stream.ts` (its `tsc` emit cannot import this package's TypeScript source). `acp.ts` and `runner.ts` call that copy.

## Related docs

- [Room chat UI](../web/pages/room-chat-ui.md) — the line in the message
- [Engine loop](../orchestrator/engine/engine-loop.md) — where v2 folds reasoning into the stream
- [Runner on your Mac](../desktop/runner-and-stream.md) — Claude and ACP thought events
