/** How a bot writes back. "default" adds nothing, so existing bots stay as they are. */
export type ReplyStyle = "default" | "conversational"

export function replyStyleFromParams(
  params: Record<string, unknown> | null | undefined,
): ReplyStyle {
  return params?.replyStyle === "conversational" ? "conversational" : "default"
}

/**
 * Extra system-prompt line for conversational bots. Null for the default style, so the
 * prompt the model already sees does not change.
 */
export function replyStyleInstruction(style: ReplyStyle): string | null {
  if (style !== "conversational") return null
  return [
    "Reply style:",
    "Write short, plain messages. Prefer a few small replies over one long essay.",
    "When the person is still deciding, end with one useful follow-up question.",
  ].join(" ")
}
