import AsyncStorage from "@react-native-async-storage/async-storage"
import { ENV } from "../config/env"
import { supabase } from "./supabase"

export interface AppSettings {
  // Profile & Workspace
  displayName: string
  orgSlug: string
  role: string

  // AI & BYOK
  aiProvider: "openrouter" | "anthropic" | "openai" | "groq" | "deepseek" | "gemini"
  modelName: string
  apiKey: string
  temperature: number
  maxBudgetTurns: number

  // Gateway & Infrastructure
  webApiUrl: string
  supabaseUrl: string

  // Agent Guardrails
  toolApprovalMode: "always_ask" | "read_only_auto" | "full_auto"
  defaultComputerProfile: "standard" | "browser" | "minimal"
  autoOpenTerminal: boolean

  // UI & Experience
  themeMode: "dark" | "oled" | "emerald"
  fontSize: "compact" | "normal" | "large"
  hapticsEnabled: boolean
  soundEffects: boolean

  // Notifications
  pushNotifications: boolean
  notifyOnTaskComplete: boolean
  notifyOnApproval: boolean
  notifyOnMention: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  displayName: "Operator",
  orgSlug: ENV.DEFAULT_ORG_SLUG || "default",
  role: "Workspace Owner",

  aiProvider: "openrouter",
  modelName: "anthropic/claude-3.5-sonnet",
  apiKey: "",
  temperature: 0.7,
  maxBudgetTurns: 12,

  webApiUrl: ENV.WEB_API_URL,
  supabaseUrl: ENV.SUPABASE_URL,

  toolApprovalMode: "always_ask",
  defaultComputerProfile: "standard",
  autoOpenTerminal: false,

  themeMode: "dark",
  fontSize: "normal",
  hapticsEnabled: true,
  soundEffects: true,

  pushNotifications: true,
  notifyOnTaskComplete: true,
  notifyOnApproval: true,
  notifyOnMention: true,
}

const SETTINGS_STORAGE_KEY = "@sayabot/settings_v1"

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch (e) {
    console.warn("[settings] Failed to load settings from storage, using defaults", e)
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
  try {
    const current = await loadSettings()
    const merged = { ...current, ...updates }
    await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged))
    return merged
  } catch (e) {
    console.error("[settings] Failed to save settings", e)
    throw e
  }
}

export async function resetSettings(): Promise<AppSettings> {
  try {
    await AsyncStorage.removeItem(SETTINGS_STORAGE_KEY)
    return { ...DEFAULT_SETTINGS }
  } catch (e) {
    console.error("[settings] Failed to reset settings", e)
    return { ...DEFAULT_SETTINGS }
  }
}

export interface PingResult {
  ok: boolean
  latencyMs: number
  statusText: string
  details?: string
}

/**
 * Ping Web API Gateway to check VPS health & network connectivity
 */
export async function pingGateway(targetUrl?: string): Promise<PingResult> {
  const url = (targetUrl || ENV.WEB_API_URL).replace(/\/$/, "")
  const start = Date.now()
  try {
    // Attempt health endpoint or root with short timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 6000)

    const res = await fetch(`${url}/api/health`, {
      method: "GET",
      signal: controller.signal,
    }).catch(async () => {
      // Fallback: ping root
      return await fetch(url, { method: "HEAD", signal: controller.signal })
    })

    clearTimeout(timeoutId)
    const latencyMs = Date.now() - start
    return {
      ok: res.status < 500,
      latencyMs,
      statusText: res.status < 500 ? "Online" : `HTTP ${res.status}`,
      details: `Response in ${latencyMs}ms (${res.status})`,
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start
    return {
      ok: false,
      latencyMs,
      statusText: "Unreachable",
      details: err?.message || "Connection timed out",
    }
  }
}

/**
 * Ping Supabase to test database & realtime channel health
 */
export async function pingDatabase(): Promise<PingResult> {
  const start = Date.now()
  try {
    const { error } = await supabase.from("orgs").select("id").limit(1).maybeSingle()
    const latencyMs = Date.now() - start
    if (error && error.code !== "PGRST116") {
      return {
        ok: false,
        latencyMs,
        statusText: "DB Error",
        details: error.message,
      }
    }
    return {
      ok: true,
      latencyMs,
      statusText: "Connected",
      details: `Supabase operational (${latencyMs}ms)`,
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start
    return {
      ok: false,
      latencyMs,
      statusText: "Disconnected",
      details: err?.message || "Failed to reach Supabase",
    }
  }
}
