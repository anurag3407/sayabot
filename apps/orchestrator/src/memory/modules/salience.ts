import type { EpistemicStatus } from "../types"

export interface RetentionParams {
  createdAt: Date
  lastUsedAt?: Date | null
  useCount?: number
  decayHalfLifeDays?: number
  now?: Date
}

/**
 * Calculates Ebbinghaus retention score R(t) with spaced reinforcement.
 *
 * Formula:
 *   deltaDays = (now - mostRecentInteraction) / (1000 * 60 * 60 * 24)
 *   lambda = ln(2) / decayHalfLifeDays
 *   decay = e^(-lambda * deltaDays)
 *   reinforcement = 1 + log2(1 + useCount) * 0.15
 *
 * Returns value clamped in [0.05, 1.0].
 */
export function calculateRetention(params: RetentionParams): number {
  const now = params.now ?? new Date()
  const referenceDate = params.lastUsedAt ?? params.createdAt
  const deltaMs = Math.max(0, now.getTime() - referenceDate.getTime())
  const deltaDays = deltaMs / (1000 * 60 * 60 * 24)

  const halfLife = Math.max(1, params.decayHalfLifeDays ?? 30)
  const lambda = Math.LN2 / halfLife
  const decay = Math.exp(-lambda * deltaDays)

  const useCount = Math.max(0, params.useCount ?? 0)
  const reinforcement = 1 + Math.log2(1 + useCount) * 0.15

  const score = decay * reinforcement
  return Math.min(1.0, Math.max(0.05, Number(score.toFixed(4))))
}

export interface ScoreParams {
  /** Query relevance in [0, 1] (full-text, vector and keyword signals blended). */
  relevance?: number
  /** @deprecated use `relevance`; kept for callers that only have keyword overlap. */
  keywordMatchRatio?: number
  pinned: boolean
  confidence: number
  emotionalSalience: number
  retention: number
  epistemicStatus: EpistemicStatus
}

/**
 * Computes composite relevance score across relevance, epistemic status, salience, and retention.
 * Withdrawn memories get a hard zero.
 */
export function compositeMemoryScore(params: ScoreParams): number {
  if (params.epistemicStatus === "withdrawn") {
    return 0
  }

  // Epistemic status multiplier
  let epistemicWeight = 1.0
  switch (params.epistemicStatus) {
    case "verified":
      epistemicWeight = 1.2
      break
    case "belief":
      epistemicWeight = 1.0
      break
    case "hypothesis":
      epistemicWeight = 0.8
      break
    case "superseded":
      epistemicWeight = 0.2
      break
  }

  const pinnedBoost = params.pinned ? 0.35 : 0.0

  const relevance = params.relevance ?? params.keywordMatchRatio ?? 0

  // Weights:
  // - 40% Query relevance
  // - 20% Retention (Ebbinghaus decay)
  // - 20% Emotional salience (importance/surprise)
  // - 20% Confidence
  const baseScore =
    relevance * 0.4 +
    params.retention * 0.2 +
    params.emotionalSalience * 0.2 +
    params.confidence * 0.2

  const finalScore = (baseScore + pinnedBoost) * epistemicWeight
  return Number(Math.max(0, finalScore).toFixed(4))
}
