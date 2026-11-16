import type { AgentRef } from "./types"
import { resolveMentions } from "./mentions"

export type TurnRole = "responder" | "producer" | "critic" | "summarizer" | "moderator"

export interface PlannedTurn {
  agentId: string
  role: TurnRole
  reason?: string
}

export interface MentionsPlanInput {
  text: string
  roomAgents: AgentRef[]
  excludeAgentIds?: string[]
}

/**
 * Tagged agents in mention order. The hard turn cap is enforced by the pre-turn
 * breaker so an over-full queue produces a visible halt instead of silence.
 */
export function planMentionsTurn(input: MentionsPlanInput): PlannedTurn[] {
  const excluded = new Set(input.excludeAgentIds ?? [])
  return resolveMentions(input.text, input.roomAgents)
    .filter((a) => !excluded.has(a.id))
    .map((a) => ({ agentId: a.id, role: "responder" as const }))
}

export interface FollowUpPlanInput {
  text: string
  roomAgents: AgentRef[]
  senderAgentId: string
}

/** Bots mentioned by another bot are appended to the queue, never the sender itself. */
export function planBotFollowUps(input: FollowUpPlanInput): PlannedTurn[] {
  return resolveMentions(input.text, input.roomAgents)
    .filter((a) => a.id !== input.senderAgentId)
    .map((a) => ({ agentId: a.id, role: "responder" as const }))
}

export interface DebatePlanInput {
  roomAgents: AgentRef[]
  debateOrder: string[] | null
  text: string
}

/** Orders participants by the room's debate order, falling back to room order. */
export function orderDebateAgents(
  roomAgents: AgentRef[],
  debateOrder: string[] | null,
): AgentRef[] {
  if (!debateOrder?.length) return roomAgents
  const byId = new Map(roomAgents.map((a) => [a.id, a]))
  const ordered = debateOrder
    .map((id) => byId.get(id))
    .filter((a): a is AgentRef => a !== undefined)
  const seen = new Set(ordered.map((a) => a.id))
  return [...ordered, ...roomAgents.filter((a) => !seen.has(a.id))]
}

/**
 * Producer → critic(s) → summarizer. Mentions narrow the cast; with fewer than
 * three participants the middle stage is skipped.
 */
export function planDebateTurns(input: DebatePlanInput): PlannedTurn[] {
  const ordered = orderDebateAgents(input.roomAgents, input.debateOrder)
  const mentioned = resolveMentions(input.text, ordered)
  const participants = mentioned.length ? mentioned : ordered
  if (participants.length === 0) return []
  if (participants.length === 1) return [{ agentId: participants[0]!.id, role: "producer" }]
  return participants.map((agent, i) => {
    if (i === 0) return { agentId: agent.id, role: "producer" as const }
    if (i === participants.length - 1) return { agentId: agent.id, role: "summarizer" as const }
    return { agentId: agent.id, role: "critic" as const }
  })
}

/** Explicit mentions win in moderated rooms. */
export function planModeratedMentions(
  input: Omit<MentionsPlanInput, "excludeAgentIds">,
): PlannedTurn[] {
  return planMentionsTurn(input)
}

export const HUMAN_TURN = "human"

/**
 * Validates the moderator model's choice. Unknown ids are treated as "human" so
 * a hallucinated agent can never wedge the room.
 */
export function validateModeratorChoice(
  choice: string,
  roomAgents: AgentRef[],
): { next: string; valid: boolean } {
  if (choice === HUMAN_TURN) return { next: HUMAN_TURN, valid: true }
  return roomAgents.some((a) => a.id === choice)
    ? { next: choice, valid: true }
    : { next: HUMAN_TURN, valid: false }
}

/** Most agents a lead agent may hand one message to at once. */
export const LEAD_MAX_AGENTS = 3

/**
 * Validates a lead agent's plan: its first pick (`next`) plus any others it wants on the same
 * message (`also`), in order. Unknown and repeated ids are dropped and the list is capped at
 * LEAD_MAX_AGENTS. `"human"` as the first pick, or nothing usable at all, hands the floor back.
 */
export function validateLeadPlan(
  next: string,
  also: string[],
  roomAgents: AgentRef[],
): { agentIds: string[]; human: boolean } {
  if (next === HUMAN_TURN) return { agentIds: [], human: true }
  const known = new Set(roomAgents.map((a) => a.id))
  const agentIds: string[] = []
  for (const id of [next, ...also]) {
    if (agentIds.length >= LEAD_MAX_AGENTS) break
    if (known.has(id) && !agentIds.includes(id)) agentIds.push(id)
  }
  return agentIds.length ? { agentIds, human: false } : { agentIds: [], human: true }
}

export function debateRoleInstruction(role: TurnRole): string | null {
  switch (role) {
    case "producer":
      return "You are the producer in a structured debate. Put forward the strongest concrete proposal or answer. Be specific and brief."
    case "critic":
      return "You are a critic in a structured debate. Identify concrete flaws, omissions or risks in what previous participants said. Do not simply agree."
    case "summarizer":
      return "You are the summarizer in a structured debate. Reconcile the discussion into a decision with open questions and next actions. Do not introduce new arguments."
    default:
      return null
  }
}
