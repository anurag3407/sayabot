/**
 * "/goal": a human gives the bots an objective and they work toward it in rounds, re-triggered by
 * the coordinator after every reply, until a reply ends with GOAL COMPLETE or GOAL BLOCKED, the
 * round limit is reached, someone presses stop, or the repetition guard trips. Everything runs
 * inside the room's turn session, under the room lock, like any other turn.
 */

/** Rounds per agent before the goal pauses and asks for a fresh /goal. */
export const GOAL_MAX_ROUNDS = 20

/** The `metadata.reason` of the system message posted when a goal stops on a question. */
export const GOAL_WAITING_REASON = "goal_waiting"

export type GoalOutcome = "complete" | "blocked" | "continue"

/** The instructions an agent gets on every round of a goal (added to the room directive). */
export function goalDirective(goal: string, round: number, maxRounds = GOAL_MAX_ROUNDS): string {
  return [
    `GOAL MODE, round ${round} of up to ${maxRounds}. The humans set this goal:`,
    `"""${goal.trim().slice(0, 4_000)}"""`,
    "Work toward it on your own: plan, act, check your work, and fix what's wrong. Each reply is one round, and you'll be called again automatically to continue, so keep the round focused and end it with what you did and what comes next.",
    "When only a person can settle something that changes what you do next (a choice between two approaches, access, a budget, an address, a taste), ask them instead of guessing: call request_human_decision with one short question and 2–6 short options they can tap. Then end your reply with: GOAL BLOCKED: <the question>",
    "A blocked goal is held, not thrown away. The person answers, you are called again with that answer, and the same goal continues — so ask once, in one question, and never put words in their mouth.",
    "When the goal is fully achieved and you have checked it, end your reply with the line: GOAL COMPLETE",
    "If you can't go on for any other reason (access, a refused approval, a broken dependency), end with: GOAL BLOCKED: <what you need>",
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

/**
 * The text after "GOAL BLOCKED:" on the last line of a reply, so the room can show what the bot
 * is waiting for. Null when the reply ended for another reason.
 */
export function goalQuestionOf(reply: string): string | null {
  const tail = reply.trim().slice(-1_500)
  const match = /GOAL\s+BLOCKED\s*:?[ \t]*([^\n]*)/i.exec(tail)
  const text = (match?.[1] ?? "").trim().slice(0, 300)
  return text || null
}

/**
 * The goal text when a message started one ("/goal" in the composer) or carried one forward.
 * An answer to a question a bot asked during a goal is marked with `metadata.goal`, so the
 * goal survives the pause instead of dying with the round it was blocked in.
 */
export function goalOf(message: {
  senderType: string
  content: string
  metadata?: unknown
}): string | null {
  const metadata = message.metadata as { command?: unknown; goal?: unknown } | null | undefined
  if (message.senderType !== "human" || metadata?.command !== "goal") return null
  const carried = typeof metadata.goal === "string" ? metadata.goal.trim() : ""
  return carried || message.content.trim() || null
}

/** A "/btw" side note: delivered without interrupting or starting anything. */
export function isSideNote(message: { senderType: string; metadata?: unknown }): boolean {
  const metadata = message.metadata as { command?: unknown } | null | undefined
  return message.senderType === "human" && metadata?.command === "btw"
}
