/**
 * Reasoning-effort levels, lowest first. This is the union of what any engine accepts; each
 * engine (and, where models.dev says so, each model) declares the subset it takes. "Default"
 * in the picker is the absence of a level: the provider then uses its own default.
 */
export const EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"] as const

export type EffortLevel = (typeof EFFORT_LEVELS)[number]

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value)
}

/** Sorts and de-duplicates levels, dropping anything outside the ladder ("minimal", "default"). */
export function normalizeEffortLevels(values: readonly unknown[]): EffortLevel[] {
  const set = new Set(values.filter(isEffortLevel))
  return EFFORT_LEVELS.filter((level) => set.has(level))
}

/**
 * What each engine's CLI or API takes when models.dev has nothing more specific for the model.
 * Claude Code takes `--effort`, Codex `model_reasoning_effort`; both accept low through max.
 */
export const ENGINE_EFFORT_LEVELS: Record<string, readonly EffortLevel[]> = {
  "claude-code": ["low", "medium", "high", "xhigh", "max"],
  codex: ["low", "medium", "high", "xhigh", "max"],
  cursor: [],
  anthropic: ["low", "medium", "high", "xhigh", "max"],
  openai: ["none", "low", "medium", "high", "xhigh"],
  google: ["low", "medium", "high"],
  openrouter: ["low", "medium", "high"],
  copilot: ["low", "medium", "high"],
  deepseek: [],
  grok: ["low", "high"],
  opencode: ["low", "medium", "high"],
  kimi: [],
  qwen: [],
  groq: ["low", "medium", "high"],
  cerebras: [],
  minimax: [],
  cloudflare: [],
  "command-code": [],
  "openai-compatible": [],
}

/** A saved level an engine or model no longer takes is dropped, so the provider uses its default. */
export function clampEffort(
  effort: string | null | undefined,
  offered: readonly EffortLevel[] | undefined,
): EffortLevel | undefined {
  if (!isEffortLevel(effort)) return undefined
  if (!offered) return effort
  return offered.includes(effort) ? effort : undefined
}
