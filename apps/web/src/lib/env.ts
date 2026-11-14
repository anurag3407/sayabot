import "server-only"
import { publicSayaAi, readSayaAiConfig, type SayaAiConfig, type SayaAiPublic } from "@sayabot/core"

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export function getSupabaseUrl(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_URL")
}

export function getSupabaseAnonKey(): string {
  return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
}

export function getServiceRoleKey(): string {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY")
}

export function getKek(): string {
  const kek = process.env.SAYABOT_KEK || process.env.MESH_KEK
  if (!kek) throw new Error("SAYABOT_KEK (or MESH_KEK) is not set")
  return kek
}

export function getOrchestratorUrl(): string {
  return (process.env.ORCHESTRATOR_URL ?? "http://localhost:4000").replace(/\/+$/, "")
}

export function getComputerdUrl(): string {
  return (process.env.COMPUTERD_URL ?? "http://localhost:4100").replace(/\/+$/, "")
}

export function getInternalSecret(): string {
  return requireEnv("ORCHESTRATOR_INTERNAL_SECRET")
}

export function getCollabUrl(): string {
  return (process.env.NEXT_PUBLIC_COLLAB_URL || "ws://localhost:4000/collab").replace(/\/+$/, "")
}

export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "")
}

/**
 * The operator's Saya AI provider (SAYA_AI_* in .env, or the older DEV_OPENAI_COMPAT_* values).
 * Read per request, so the picker, phones and the Mac app show the current models as soon as the
 * server restarts with new values. Never send this to a browser; use sayaAiPublic().
 */
export function sayaAi(): SayaAiConfig | null {
  const config = readSayaAiConfig(process.env)
  return config?.apiKey ? config : null
}

/** Safe for clients: names and aliases only, no key, endpoint or real model ids. */
export function sayaAiPublic(): SayaAiPublic | null {
  const config = sayaAi()
  return config ? publicSayaAi(config) : null
}

/** True when agents without their own key can use the server's shared model (Saya AI). */
export function devModelConfigured(): boolean {
  return sayaAi() !== null
}

function envBool(name: string): boolean {
  const env = process.env
  const value = env[name]
  return value === "true" || value === "1"
}

export function ssoEnabled(): boolean {
  return process.env.SSO_ENABLED === "true" || envBool("SSO_ENABLED") || envBool("NEXT_PUBLIC_SSO_ENABLED")
}

export function githubAuthEnabled(): boolean {
  return process.env.GITHUB_AUTH_ENABLED === "true" || envBool("GITHUB_AUTH_ENABLED") || envBool("NEXT_PUBLIC_GITHUB_AUTH_ENABLED")
}

/** Desktop guest mode is on unless the operator turns it off (`DESKTOP_GUEST_MODE=false`). */
export function desktopGuestModeEnabled(): boolean {
  const raw = (process.env.DESKTOP_GUEST_MODE ?? "").trim().toLowerCase()
  return raw !== "false" && raw !== "0" && raw !== "off"
}

export function googleAuthEnabled(): boolean {
  return process.env.GOOGLE_AUTH_ENABLED === "true" || envBool("GOOGLE_AUTH_ENABLED") || envBool("NEXT_PUBLIC_GOOGLE_AUTH_ENABLED")
}
