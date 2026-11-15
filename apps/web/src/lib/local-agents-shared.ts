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
  /** Who it is signed in as ("you@example.com · Org"), when the app says. */
  account?: string
}

/** Where the list came from: this server's own machine, or what a Mac app reported. */
export interface LocalAgentsResponse {
  available: boolean
  agents: LocalAgentReport[]
  source?: "server" | "mac"
  /** For "mac": which computer, and when it last checked in. */
  hostName?: string
  lastSeenAt?: string | null
  appVersion?: string | null
}

const LOCAL_MODEL_SERVERS: Record<string, { name: string; icon: string }> = {
  ollama: { name: "Ollama", icon: "ollama" },
  lmstudio: { name: "LM Studio", icon: "lmstudio" },
}

/**
 * What the Sayabot Mac app reported in its heartbeat (apps/desktop local-agents.ts) → the same rows
 * the Providers page shows for this server's own machine. Apps that aren't installed are left out.
 */
export function reportedAgentsToReports(raw: unknown): LocalAgentReport[] {
  if (!Array.isArray(raw)) return []
  const out: LocalAgentReport[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const row = entry as Record<string, unknown>
    const id = typeof row.id === "string" ? row.id : ""
    const status = row.status === "ready" || row.status === "signed_out" ? row.status : null
    if (!id || !status || out.some((agent) => agent.id === id)) continue
    const app = LOCAL_AGENT_APPS.find((item) => item.id === id)
    const server = LOCAL_MODEL_SERVERS[id]
    if (!app && !server) continue
    const models = Array.isArray(row.models)
      ? row.models.flatMap((model) =>
          model && typeof model === "object" && typeof (model as { id?: unknown }).id === "string"
            ? [{ id: (model as { id: string }).id, label: String((model as { label?: unknown }).label ?? (model as { id: string }).id) }]
            : [],
        )
      : []
    out.push({
      id,
      name: app?.name ?? server?.name ?? id,
      icon: app?.icon ?? server?.icon ?? id,
      inviteApp: app?.inviteApp ?? "generic",
      version: typeof row.version === "string" ? row.version : null,
      status,
      cli: typeof row.binary === "string" && row.binary.length > 0,
      ...(models.length ? { models } : {}),
      ...(typeof row.account === "string" && row.account ? { account: row.account } : {}),
    })
  }
  return out
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
