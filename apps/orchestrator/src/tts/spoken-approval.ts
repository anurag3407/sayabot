import { resolveApprovalWaiter } from "../tools/approvals"

const AFFIRMATIVE_REGEX =
  /\b(yes|yeah|yep|sure|approve|approved|proceed|go ahead|confirm|confirmed|run it|execute|do it|okay|ok)\b/i

const NEGATIVE_REGEX =
  /\b(no|nope|nah|reject|rejected|cancel|cancelled|deny|denied|stop|abort|don't|do not)\b/i

export type SpokenDecision = "approved" | "rejected" | "unclear"

/**
 * Parses spoken audio transcript for approval intent.
 */
export function parseSpokenApproval(transcript: string): SpokenDecision {
  const clean = transcript.trim().toLowerCase()
  if (!clean) return "unclear"

  const hasAffirmative = AFFIRMATIVE_REGEX.test(clean)
  const hasNegative = NEGATIVE_REGEX.test(clean)

  if (hasNegative) return "rejected"
  if (hasAffirmative) return "approved"

  return "unclear"
}

/**
 * Creates concise, speakable approval prompt for the voice synthesis engine.
 */
export function generateSpokenApprovalPrompt(
  toolName: string,
  args: Record<string, unknown> = {},
): string {
  const simplifiedTool = toolName.replace(/_/g, " ")
  const keys = Object.keys(args)

  if (keys.length === 0) {
    return `Sayabot needs your approval to run ${simplifiedTool}. Do you approve or reject?`
  }

  const sampleKey = keys[0]
  const sampleVal = String(args[sampleKey!] ?? "").slice(0, 50)
  return `Sayabot needs your approval to run ${simplifiedTool} with ${sampleKey} ${sampleVal}. Do you approve or reject?`
}

/**
 * Evaluates spoken decision and notifies pending approval waiters.
 */
export function processSpokenDecision(
  toolCallId: string,
  spokenText: string,
): { resolved: boolean; decision?: "approved" | "rejected"; reason: string } {
  const decision = parseSpokenApproval(spokenText)

  if (decision === "unclear") {
    return {
      resolved: false,
      reason: `Could not determine approval from spoken input: "${spokenText}". Please say approve or reject.`,
    }
  }

  resolveApprovalWaiter(toolCallId, decision)
  return {
    resolved: true,
    decision,
    reason: `Tool call ${toolCallId} was ${decision} via spoken voice decision.`,
  }
}
