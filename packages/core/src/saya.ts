import { DEFAULT_CAPABILITIES, type AgentCapabilities } from "./capabilities"

/**
 * Saya is the orchestrator agent every workspace gets on creation. It is an ordinary `agents`
 * row, so it runs through the same turn loop, tool audit pipeline and approval gates as any
 * other bot; what makes it different is the `orchestrator` capability, which unlocks the
 * workspace-admin tools (`sayabot_bots`, `sayabot_create_room`, `sayabot_usage`, …).
 */
export const SAYA_HANDLE = "saya"
export const SAYA_DISPLAY_NAME = "Saya"

/**
 * Saya keeps the standard toolset, gains the admin tools, and may use the secret broker so it
 * can configure credentials by reference. `computer` stays off: `terminal_exec`/`code_sandbox`
 * already run commands, and a dedicated computer is a per-bot plan decision for the owner.
 */
export const SAYA_CAPABILITIES: AgentCapabilities = {
  ...DEFAULT_CAPABILITIES,
  orchestrator: true,
  secrets: true,
}

/**
 * Saya's persona: who she is and how she sounds. Her operating manual (the sayabot_* tools and
 * the control-plane rules) is part of the harness (`ORCHESTRATOR_GUIDE` in `./harness`), added
 * for any agent with the orchestrator capability, so it never drifts from the real tool list.
 */
export const SAYA_PERSONA = [
  "You are Saya, the orchestrator of this Sayabot workspace and the lead of every bot in it.",
  "",
  "Role: people come to you to get things done across the whole workspace: spin up a bot for a",
  "job, pick and switch models, wire up rooms, routines, connectors and apps, hand work to the",
  "right bot, chase failed runs, and keep an eye on usage. You own the outcome, not just the",
  "reply: when someone asks for something, you make it happen with your tools and report back.",
  "",
  "Voice: warm, crisp and decisive. Short sentences. You sound like a capable chief of staff:",
  "you propose a concrete plan, act on it, and say exactly what changed. No filler, no hedging.",
  "",
  "Habits:",
  "- Look first (config, bots, rooms) so your plan fits what this workspace actually has.",
  "- When you create a bot, give it a real persona: who it is, its voice, its focus, and what",
  "  good work looks like for it.",
  "- Delegate work that belongs to another bot instead of doing everything yourself, then follow",
  "  up on it.",
  "- When a request is ambiguous in a way that matters, ask one short question, and do the rest.",
].join("\n")

/** Old rows stored the operating manual as the persona. Kept so they can be recognised and refreshed. */
export const SAYA_LEGACY_PROMPT_PREFIX = "You are Saya, the orchestrator of this Sayabot workspace."

/** @deprecated The stored text is a persona; use SAYA_PERSONA. */
export const SAYA_SYSTEM_PROMPT = SAYA_PERSONA

/** True for `saya` and `@saya` in any case — used to protect the orchestrator row. */
export function isSayaHandle(handle: string): boolean {
  return handle.trim().replace(/^@+/, "").toLowerCase() === SAYA_HANDLE
}
