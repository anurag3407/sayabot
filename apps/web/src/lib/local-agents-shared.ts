/** Client-safe parts of local agent detection: the app list and how a status is decided. */

export type LocalAgentStatus = "ready" | "signed_out" | "installed" | "not_installed"

export interface LocalAgentApp {
  id: string
  name: string
  /** Provider icon key for ProviderIcon. */
  icon: string
  binaries: readonly string[]
  macApp?: string
  /** Which app id the "Add agent" invite uses for it. */
  inviteApp: string
}

export interface LocalAgentReport {
  id: string
  name: string
  icon: string
  inviteApp: string
  version: string | null
  status: LocalAgentStatus
  /** The app's command-line tool is here, so Sayabot can run it directly. */
  cli: boolean
  /** Models the app offers this account, when it keeps a list (Codex). */
  models?: Array<{ id: string; label: string }>
}

export const LOCAL_AGENT_APPS: readonly LocalAgentApp[] = [
  { id: "claude-code", name: "Claude Code", icon: "anthropic", binaries: ["claude"], inviteApp: "claude-code" },
  { id: "codex", name: "Codex", icon: "openai", binaries: ["codex"], inviteApp: "codex" },
  { id: "gemini", name: "Gemini CLI", icon: "google", binaries: ["gemini"], inviteApp: "antigravity" },
  { id: "opencode", name: "OpenCode", icon: "opencode", binaries: ["opencode"], inviteApp: "generic" },
  // `cursor-agent` is Cursor's CLI; plain `cursor` only opens the editor, and `agent` can be another app.
  { id: "cursor", name: "Cursor", icon: "cursor", binaries: ["cursor-agent"], macApp: "/Applications/Cursor.app", inviteApp: "cursor" },
  { id: "hermes", name: "Hermes", icon: "hermes", binaries: ["hermes"], inviteApp: "hermes" },
  { id: "antigravity", name: "Antigravity", icon: "antigravity", binaries: ["antigravity"], macApp: "/Applications/Antigravity.app", inviteApp: "antigravity" },
]

/** signedIn null = we can't tell for this app (installed is the best we know). */
export function localAgentStatus(input: { installed: boolean; signedIn: boolean | null }): LocalAgentStatus {
  if (!input.installed) return input.signedIn ? "ready" : "not_installed"
  if (input.signedIn === null) return "installed"
  return input.signedIn ? "ready" : "signed_out"
}

export const LOCAL_STATUS_LABEL: Record<LocalAgentStatus, string> = {
  ready: "Ready",
  signed_out: "Not signed in",
  installed: "Installed",
  not_installed: "Not installed",
}
