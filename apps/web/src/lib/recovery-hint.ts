export interface RecoveryHint {
  label: string
  /** A page where it can be fixed… */
  href?: string
  /** …or something to open right here (the chat's model picker). */
  action?: "switch_model"
}

/** Opens the chat's model picker in the title bar (see RoomModelPicker). */
export const MODEL_PICKER_EVENT = "sayabot:open-model-picker"

/** Failures that fail the same way when retried: offer the fix instead of Retry. */
const RETRY_WONT_HELP = new Set([
  "request_too_large",
  "context_overflow",
  "auth_error",
  "quota_exhausted",
  "refusal",
  "runner_off",
  "mac_removed",
])

export function retryHelps(kind: string | null | undefined): boolean {
  return !kind || !RETRY_WONT_HELP.has(kind)
}

/** Maps a failed-turn message to the page where someone can actually fix it. */
export function recoveryHint(args: {
  text: string
  reason?: string | null
  orgSlug: string
  roomId: string
  /** metadata.errorKind of the failed reply (see the orchestrator's classifyEngineError). */
  kind?: string | null
}): RecoveryHint | null {
  const text = `${args.reason ?? ""} ${args.text}`.toLowerCase()
  const room = `/${args.orgSlug}/r/${args.roomId}/settings`
  switch (args.kind) {
    case "request_too_large":
    case "context_overflow":
    case "quota_exhausted":
    case "refusal":
    case "mac_offline":
    case "mac_removed":
      return { label: "Switch model", action: "switch_model" }
    case "auth_error":
      return { label: "Update the API key", href: `/${args.orgSlug}/settings/keys` }
    case "runner_off":
      return {
        label: "Turn it on in Settings → Computers",
        href: `/${args.orgSlug}/settings/computers`,
      }
  }
  if (
    /provider key|api key|api_key|unauthori[sz]ed|\b401\b|\b403\b|incorrect api|invalid x-api/.test(
      text,
    )
  ) {
    return { label: "Check provider keys", href: `/${args.orgSlug}/settings/keys` }
  }
  if (/model.*(not found|does not exist|not available)|unknown model|\b404\b/.test(text)) {
    return { label: "Check the agent's model", href: `/${args.orgSlug}/agents` }
  }
  if (/budget|rpm|per minute|rate.?limit|turn.?cap|\bcap\b/.test(text)) {
    return { label: "Review room limits", href: room }
  }
  return null
}

export const RETRYABLE_REASONS = new Set(["agent_error", "moderator_error"])
