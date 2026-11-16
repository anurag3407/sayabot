import { SAYA_SHAPES, SAYA_TONES, type SayaShape, type SayaTone } from "@sayabot/core"

/** Faces `Mascot` already draws. */
export const AGENT_MOODS = ["idle", "happy", "sleep", "busy", "alert", "thinking"] as const
export type AgentMood = (typeof AGENT_MOODS)[number]

export interface AgentLook {
  shape: SayaShape | null
  tone: SayaTone | null
  /** Face the mascot draws. Null keeps the resting face. */
  mood: AgentMood | null
}

function isMood(value: unknown): value is AgentMood {
  return typeof value === "string" && (AGENT_MOODS as readonly string[]).includes(value)
}

function isShape(value: unknown): value is SayaShape {
  return typeof value === "string" && (SAYA_SHAPES as readonly string[]).includes(value)
}

function isTone(value: unknown): value is SayaTone {
  return typeof value === "string" && value in SAYA_TONES
}

/** Shape and colour saved on the bot. Empty when it still uses the name-based look. */
export function readAgentLook(params: Record<string, unknown> | null | undefined): AgentLook {
  const mascot =
    params && typeof params.mascot === "object" && params.mascot
      ? (params.mascot as Record<string, unknown>)
      : null
  return {
    shape: mascot && isShape(mascot.shape) ? mascot.shape : null,
    tone: mascot && isTone(mascot.tone) ? mascot.tone : null,
    mood: mascot && isMood(mascot.mood) ? mascot.mood : null,
  }
}

/** Props for `Mascot`. Omits shape and colour until the person has picked them. */
export function mascotProps(
  seed: string,
  params: Record<string, unknown> | null | undefined,
): { seed: string; shape?: SayaShape; color?: string; mood?: AgentMood } {
  const look = readAgentLook(params)
  return {
    seed,
    ...(look.shape ? { shape: look.shape } : {}),
    ...(look.tone ? { color: SAYA_TONES[look.tone].base } : {}),
    ...(look.mood ? { mood: look.mood } : {}),
  }
}
