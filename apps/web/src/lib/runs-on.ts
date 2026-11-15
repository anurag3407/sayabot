/**
 * Where a bot answers from, in a few words: "Claude Code · claude-opus-5-5 on your Mac",
 * "gpt-oss-120b · API key", "Sayabot's model". Shown on the bot's page and under its replies so
 * nobody has to guess why it answered the way it did.
 */

const APP_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  cursor: "Cursor",
  ollama: "Ollama",
  lmstudio: "LM Studio",
}

export function appName(app: string): string {
  return APP_NAMES[app] ?? app
}

/** Strips a Saya AI alias ("saya/pro") to its tier, so it doesn't read as a model id. */
function modelName(model: string | null | undefined): string | null {
  if (!model) return null
  return model.startsWith("saya/") ? null : model
}

export function runsOnLabel(agent: {
  params?: unknown
  model?: string | null
  provider_key_id?: string | null
  providerKeyId?: string | null
}): string {
  const params = (agent.params as Record<string, unknown> | null) ?? {}
  const runner = params.runner as { hostId?: string; app?: string; where?: string; model?: string } | undefined
  if (runner?.hostId) {
    const app = appName(runner.app ?? "claude-code")
    return `${app}${runner.model ? ` · ${runner.model}` : ""} on your Mac`
  }
  if (runner?.where === "server") {
    return `${appName(runner.app ?? "claude-code")}${runner.model ? ` · ${runner.model}` : ""} on the server`
  }
  const keyId = agent.providerKeyId ?? agent.provider_key_id
  if (keyId) return `${agent.model ?? "No model picked"} · API key`
  return modelName(agent.model) ? `${agent.model} · Sayabot` : "Sayabot's model"
}

/** Under a reply: which app or model wrote it, from the reply's own metadata. */
export function replySourceLabel(metadata: Record<string, unknown>): string | null {
  const runsOn = typeof metadata.runsOn === "string" ? metadata.runsOn : null
  const model = typeof metadata.model === "string" ? metadata.model : null
  if (runsOn) return `${appName(runsOn)}${model ? ` · ${model}` : ""} ${metadata.where === "mac" ? "on your Mac" : "on the server"}`
  if (model) return model
  return null
}
