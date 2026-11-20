import type { ComputerDecision } from "@sayabot/core"
import { BOAT_READY_STATES, type BoatClient } from "./boat"

/** Opens the Boat a select_computer decision asked for. Does not stop it. */
export async function applyBoatDecision(
  client: BoatClient,
  decision: ComputerDecision,
  currentId: string | null,
  name: string,
): Promise<{ ok: true; boatId: string; state: string } | { ok: false; error: string }> {
  if (decision.surface !== "boat") return { ok: false, error: "Not a Boat" }
  if (decision.action === "use") {
    if (!currentId) return { ok: false, error: "This Boat has no id" }
    return { ok: true, boatId: currentId, state: "running" }
  }
  try {
    if (decision.action === "wake") {
      if (!currentId) return { ok: false, error: "This Boat has no id to wake" }
      const resumed = await client.resume(currentId)
      const box = BOAT_READY_STATES.has(resumed.state)
        ? resumed
        : await client.waitUntilReady(resumed.id || currentId)
      return { ok: true, boatId: box.id, state: box.state }
    }
    if (decision.action === "provision") {
      const created = await client.create(name)
      const box = BOAT_READY_STATES.has(created.state)
        ? created
        : await client.waitUntilReady(created.id)
      return { ok: true, boatId: box.id, state: box.state }
    }
    return { ok: false, error: "This Boat is already running" }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Boat request failed" }
  }
}
