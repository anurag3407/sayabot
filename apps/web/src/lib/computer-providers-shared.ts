/** Client-safe shape of the workspace's cloud desktop settings. No secrets. */
export interface ComputerProvidersView {
  boat: { last4: string | null; included: boolean }
  e2b: { last4: string | null; included: boolean }
  vps: {
    address: string | null
    alias: string | null
    hasKey: boolean
    startAutomatically: boolean
  }
}

export type CloudProviderId = "boat" | "vps" | "e2b"

export const CLOUD_PROVIDERS: { id: CloudProviderId; label: string; detail: string }[] = [
  {
    id: "boat",
    label: "Boat",
    detail:
      "A hosted desktop at boat.dev. It sleeps after 10 idle minutes and wakes with its files.",
  },
  {
    id: "vps",
    label: "Self-hosted VPS",
    detail:
      "Uses your own Linux machine, connected over SSH. Each bot gets its own Docker container.",
  },
  {
    id: "e2b",
    label: "E2B",
    detail:
      "A cloud Linux sandbox at e2b.dev, one per bot. It pauses when idle and resumes with its files.",
  },
]

export function cloudProviderReady(
  view: ComputerProvidersView | null,
  id: CloudProviderId,
): boolean {
  if (!view) return false
  if (id === "boat") return Boolean(view.boat.last4 || view.boat.included)
  if (id === "e2b") return Boolean(view.e2b.last4 || view.e2b.included)
  return Boolean(view.vps.address || view.vps.alias)
}
