import { isEffortLevel, type EffortLevel } from "@sayabot/llm/models/effort"

/** The model picked in the title bar: a provider account (`keyId`) and one of its models. */
export interface ModelSelection {
  /** The picker group's `keyId`: a saved key, `cli:codex`, `host:<id>`, or null for the server's models. */
  keyId: string | null
  /** "" is Auto: each agent keeps the model it is set to. */
  modelId: string
  label: string
  provider: string
  groupLabel: string
  effort?: EffortLevel
}

export const AUTO_SELECTION: ModelSelection = {
  keyId: null,
  modelId: "",
  label: "Auto",
  provider: "saya",
  groupLabel: "",
}

export const MODEL_SELECTION_EVENT = "sayabot:model-changed"

const storageKey = (orgSlug: string) => `sayabot:model-selection:${orgSlug}`

function parse(raw: string | null): ModelSelection | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== "object") return null
    const v = value as Record<string, unknown>
    if (typeof v.modelId !== "string" || typeof v.label !== "string") return null
    if (v.keyId !== null && typeof v.keyId !== "string") return null
    return {
      keyId: v.keyId,
      modelId: v.modelId,
      label: v.label,
      provider: typeof v.provider === "string" ? v.provider : "saya",
      groupLabel: typeof v.groupLabel === "string" ? v.groupLabel : "",
      ...(isEffortLevel(v.effort) ? { effort: v.effort } : {}),
    }
  } catch {
    return null
  }
}

/** This browser's pick for the workspace, or Auto. */
export function readModelSelection(orgSlug: string): ModelSelection {
  if (typeof window === "undefined") return AUTO_SELECTION
  try {
    return parse(window.localStorage.getItem(storageKey(orgSlug))) ?? AUTO_SELECTION
  } catch {
    return AUTO_SELECTION
  }
}

export function saveModelSelection(orgSlug: string, selection: ModelSelection): void {
  try {
    window.localStorage.setItem(storageKey(orgSlug), JSON.stringify(selection))
  } catch {
    // The pick lasts for this visit.
  }
  window.dispatchEvent(new CustomEvent(MODEL_SELECTION_EVENT, { detail: { orgSlug, selection } }))
}
