import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase()
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  if (!Number.isFinite(diff)) return ""
  const sec = Math.round(diff / 1000)
  if (sec < 45) return "now"
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0.00"
  if (value < 0.01) return `$${value.toFixed(6)}`
  return `$${value.toFixed(2)}`
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

/** Formats token counts cleanly with K, M, B, T suffixes (e.g. 417M, 14.9M, 781K). */
export function formatTokens(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e12) return `${trimDigits(value / 1e12)}T`
  if (abs >= 1e9) return `${trimDigits(value / 1e9)}B`
  if (abs >= 1e6) return `${trimDigits(value / 1e6)}M`
  if (abs >= 1e3) return `${trimDigits(value / 1e3)}K`
  return new Intl.NumberFormat().format(Math.round(value))
}

function trimDigits(value: number): string {
  const abs = Math.abs(value)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  return value.toFixed(digits).replace(/\.0+$/, "")
}

export function formatPercent(share: number, digits = 1): string {
  const percent = share * 100
  const smallest = 10 ** -digits
  if (percent > 0 && percent < smallest) return `<${smallest.toFixed(digits)}%`
  return `${percent.toFixed(digits)}%`
}


export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-"
  if (value < 1000) return `${value} ms`
  return `${(value / 1000).toFixed(1)} s`
}

export function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  groq: "Groq",
  cerebras: "Cerebras",
  openrouter: "OpenRouter",
  copilot: "GitHub Copilot",
  "openai-compatible": "OpenAI-compatible",
}

export const ROOM_KIND_LABELS: Record<string, string> = {
  public: "public",
  private: "private",
  dm: "dm",
}

export const TURN_MODE_LABELS: Record<string, string> = {
  mentions: "Reply when @mentioned",
  debate: "Debate: agents take set roles",
  moderated: "Moderated: one agent picks who speaks",
}

export const TURN_MODE_SHORT: Record<string, string> = {
  mentions: "agents reply when mentioned",
  debate: "debate",
  moderated: "moderated",
}

export function statusTone(status: string): string {
  switch (status) {
    case "complete":
    case "done":
    case "approved":
      return "text-[var(--color-ok)]"
    case "streaming":
    case "running":
    case "pending_approval":
      return "text-[var(--color-warn)]"
    case "error":
    case "rejected":
      return "text-[var(--color-danger)]"
    case "halted":
      return "text-[var(--color-accent)]"
    default:
      return "text-muted"
  }
}
