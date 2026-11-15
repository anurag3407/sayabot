/**
 * "/goal": a human gives the bots an objective and they work toward it in rounds, re-triggered by
 * the coordinator after every reply, until a reply ends with GOAL COMPLETE or GOAL BLOCKED, the
 * round limit is reached, someone presses stop, or the repetition guard trips. Everything runs
 * inside the room's turn session, under the room lock, like any other turn.
 */

/** Rounds per agent before the goal pauses and asks for a fresh /goal. */
export const GOAL_MAX_ROUNDS = 20

export type GoalOutcome = "complete" | "blocked" | "continue"

/** The instructions an agent gets on every round of a goal (added to the room directive). */
export function goalDirective(goal: string, round: number, maxRounds = GOAL_MAX_ROUNDS): string {
  return [
    `GOAL MODE, round ${round} of up to ${maxRounds}. The humans set this goal:`,
    `"""${goal.trim().slice(0, 4_000)}"""`,
    "Work toward it on your own: plan, act, check your work, and fix what's wrong. Each reply is one round, and you'll be called again automatically to continue, so keep the round focused and end it with what you did and what comes next.",
    "When the goal is fully achieved and you have checked it, end your reply with the line: GOAL COMPLETE",
    "If you can't go on without a human (a decision, access, a refused approval), end with: GOAL BLOCKED: <what you need>",
    "Don't stop early, don't repeat a round, and don't claim success you haven't verified.",
  ].join("\n")
}

/** Whether a round's reply finished the goal, got blocked, or should go on. */
export function goalOutcome(reply: string): GoalOutcome {
  const tail = reply.trim().slice(-400)
  if (/GOAL\s+BLOCKED\b/i.test(tail)) return "blocked"
  if (/GOAL\s+COMPLETE\b/i.test(tail)) return "complete"
  return "continue"
}

/** The goal text when a message started one ("/goal" in the composer), else null. */
export function goalOf(message: { senderType: string; content: string; metadata?: unknown }): string | null {
  const metadata = message.metadata as { command?: unknown } | null | undefined
  if (message.senderType !== "human" || metadata?.command !== "goal") return null
  return message.content.trim() || null
}

/** A "/btw" side note: delivered without interrupting or starting anything. */
export function isSideNote(message: { senderType: string; metadata?: unknown }): boolean {
  const metadata = message.metadata as { command?: unknown } | null | undefined
  return message.senderType === "human" && metadata?.command === "btw"
}
