/**
 * Rules for the workspace orchestrator. Pure on purpose: the turn loop, the MCP server and the
 * tests all share one decision, so a prompt cannot talk Saya into a second policy.
 */

/** The ghost in the wordmark. Saya wears this look in every workspace. */
export const SAYA_MASCOT = { shape: "ghost", tone: "lilac" } as const

/**
 * Commands a person still has to approve. `use_secret` would let a second model fire a
 * credential it never saw. `sayabot_decide` would let one approval approve the next.
 */
export const ORCHESTRATOR_NEVER_APPROVES = ["use_secret", "sayabot_decide"] as const

export type ApprovalDecision = "approve" | "reject"

export function reviewApproval(input: {
  decision: ApprovalDecision
  callerAgentId: string | null
  subjectAgentId: string | null
  toolName: string
}): { allow: true } | { allow: false; reason: string } {
  if (!input.callerAgentId) {
    return { allow: false, reason: "An orchestrator agent has to make this decision." }
  }
  if (input.subjectAgentId && input.subjectAgentId === input.callerAgentId) {
    return {
      allow: false,
      reason: "Saya cannot decide her own pending command. A person decides that one.",
    }
  }
  if (input.decision === "reject") return { allow: true }
  if (!input.subjectAgentId) {
    return {
      allow: false,
      reason: "This command is not tied to an agent, so a person has to approve it.",
    }
  }
  if ((ORCHESTRATOR_NEVER_APPROVES as readonly string[]).includes(input.toolName)) {
    return {
      allow: false,
      reason: `${input.toolName} stays with a person. Saya will not approve it.`,
    }
  }
  return { allow: true }
}

const TURN_MODES = ["mentions", "debate", "moderated"] as const
const EXECUTION_MODES = ["review_all", "ask_risky"] as const

export interface RoomConfigInput {
  name?: string
  timezone?: string
  systemDirective?: string | null
  turnMode?: string
  executionMode?: string
}

export interface RoomConfigPatch {
  name?: string
  timezone?: string
  systemDirective?: string | null
  turnMode?: (typeof TURN_MODES)[number]
  executionMode?: (typeof EXECUTION_MODES)[number]
}

/** Allowlisted room settings. Auto and turbo stay with the person at that computer. */
export function roomConfigPatch(
  input: RoomConfigInput,
): { ok: true; patch: RoomConfigPatch } | { ok: false; reason: string } {
  const patch: RoomConfigPatch = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (name.length < 1 || name.length > 60) {
      return { ok: false, reason: "name must be 1 to 60 characters" }
    }
    patch.name = name
  }
  if (input.timezone !== undefined) {
    const timezone = input.timezone.trim()
    if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(timezone)) {
      return { ok: false, reason: "timezone must look like Europe/Berlin" }
    }
    patch.timezone = timezone
  }
  if (input.systemDirective !== undefined) {
    if (input.systemDirective === null) {
      patch.systemDirective = null
    } else {
      const text = input.systemDirective.trim()
      if (text.length > 4_000) {
        return { ok: false, reason: "system_directive must be 4000 characters or fewer" }
      }
      patch.systemDirective = text
    }
  }
  if (input.turnMode !== undefined) {
    if (!(TURN_MODES as readonly string[]).includes(input.turnMode)) {
      return { ok: false, reason: "turn_mode must be mentions, debate, or moderated" }
    }
    patch.turnMode = input.turnMode as RoomConfigPatch["turnMode"]
  }
  if (input.executionMode !== undefined) {
    if (input.executionMode === "auto" || input.executionMode === "turbo") {
      return {
        ok: false,
        reason:
          "auto and turbo are chosen by the person at that computer. Saya can set review_all or ask_risky.",
      }
    }
    if (!(EXECUTION_MODES as readonly string[]).includes(input.executionMode)) {
      return { ok: false, reason: "execution_mode must be review_all or ask_risky" }
    }
    patch.executionMode = input.executionMode as RoomConfigPatch["executionMode"]
  }
  if (Object.keys(patch).length === 0) return { ok: false, reason: "nothing to change" }
  return { ok: true, patch }
}

/** A model id a bot can be pointed at. Not a key, not a URL with credentials. */
export function assignableModelId(model: string): boolean {
  const value = model.trim()
  if (!/^[\w.:/@+[\]-]{1,120}$/.test(value)) return false
  if (value.includes("://")) return false
  if (/^(?:sk-|ghp_|gho_|xox[abposr]-|AIza|saaya_ak_|sayabot_ak_|mesh_ak_)/.test(value)) {
    return false
  }
  return true
}
