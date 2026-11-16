/**
 * The same labels the web model picker shows, kept here so the phone can render a pick
 * without importing the web app. See choiceLabel in apps/web model-picker-panel.tsx.
 */

export interface ModelValue {
  keyId: string | null
  model: string | null
  effort: string | null
}

export interface PickerModel {
  id: string
  label: string
  free?: boolean
  price?: { inputPerMillion: number; outputPerMillion: number }
  contextWindow?: number
  effort?: string[]
  orgBlocked?: boolean
  needsCliUpdate?: string
  listing?: "new" | "older"
}

export type PickerSection = "server" | "subscription" | "key" | "mac" | "local" | "computer"

export interface PickerGroup {
  keyId: string | null
  provider: string
  label: string
  detail: string
  section: PickerSection
  models: PickerModel[]
  effortLevels: string[]
  source?: string
  notice?: string
  runnerEnabled?: boolean
  account?: string
  version?: string
  hostName?: string
  plan?: {
    plan: string | null
    windows: Array<{ label: string; usedPercent: number; resetsAt: string | null }>
    error?: string
  }
}

export interface RoomBotModel {
  id: string
  handle: string
  displayName: string
  editable: boolean
  bot: ModelValue
  chat: ModelValue | null
}

export const SECTION_TITLE: Record<PickerSection, string> = {
  server: "Cloud",
  subscription: "Server",
  mac: "Mac",
  key: "API keys",
  local: "Local",
  computer: "Computers",
}

export const SECTION_ORDER: PickerSection[] = ["server", "subscription", "mac", "key", "local", "computer"]

export const EFFORT_LABELS: Record<string, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

export function effortOptions(group: PickerGroup | undefined, model: PickerModel | undefined): string[] {
  if (!group) return []
  return model?.effort ?? group.effortLevels
}

/** A level the new model does not take falls back to Default. */
export function fitEffort(groups: PickerGroup[], keyId: string | null, model: string | null, effort: string | null): string | null {
  const group = groups.find((g) => g.keyId === keyId)
  const levels = effortOptions(group, group?.models.find((m) => m.id === model))
  return effort && levels.includes(effort) ? effort : null
}

/** "Claude Opus 5.5 · Claude", "llama3.2 · Ollama", "Saya AI · Automatic". */
export function choiceLabel(groups: PickerGroup[], value: ModelValue): string {
  const group = groups.find((g) => g.keyId === value.keyId)
  if (!group) return value.model && value.model !== "default" ? value.model : "Choose a model"
  if (group.keyId === null) {
    if (!group.models.length) return "Sayabot default"
    return group.models.find((m) => m.id === (value.model ?? ""))?.label ?? `${group.label} · Automatic`
  }
  const picked = group.models.find((m) => m.id === value.model)
  return `${picked?.label ?? value.model ?? "Default"} · ${group.label}`
}

/** Short name for the composer button, with "· Mac" when it runs on the person's computer. */
export function buttonLabel(groups: PickerGroup[], value: ModelValue | null): string {
  if (!value || !groups.length) return "Model"
  const group = groups.find((g) => g.keyId === value.keyId)
  const onMac = group?.section === "mac" || group?.section === "local"
  const name = choiceLabel(groups, value).split(" · ")[0] ?? "Model"
  return `${name}${onMac ? " · Mac" : ""}`
}

export function contextLabel(tokens: number | undefined): string | null {
  if (!tokens) return null
  if (tokens >= 1_000_000) return `${Math.round((tokens / 1_000_000) * 10) / 10}M`
  return `${Math.round(tokens / 1000)}K`
}

export function money(value: number): string {
  if (value === 0) return "0"
  if (value < 0.1) return value.toFixed(3).replace(/0+$/, "")
  if (value < 10) return value.toFixed(2).replace(/\.?0+$/, "")
  return Math.round(value).toString()
}
