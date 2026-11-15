import { describe, expect, it } from "vitest"
import { BOAT_IDLE_MS, BOAT_ROUTINE_LOOKAHEAD_MS } from "@sayabot/core"
import { idleBoatIds } from "./sleep"

const now = 1_700_000_000_000

describe("idleBoatIds", () => {
  it("sleeps an idle Boat and keeps one with a routine or a running command", () => {
    const ids = idleBoatIds(now, [
      { boatId: "idle", lastUsedAt: now - BOAT_IDLE_MS - 1, nextRoutineAt: null, backgroundStartedAt: null, watching: false },
      { boatId: "soon", lastUsedAt: now - BOAT_IDLE_MS - 1, nextRoutineAt: now + BOAT_ROUTINE_LOOKAHEAD_MS - 1, backgroundStartedAt: null, watching: false },
      { boatId: "due", lastUsedAt: now - BOAT_IDLE_MS - 1, nextRoutineAt: now - 60_000, backgroundStartedAt: null, watching: false },
      { boatId: "busy", lastUsedAt: now - BOAT_IDLE_MS - 1, nextRoutineAt: null, backgroundStartedAt: now - 1000, watching: false },
      { boatId: "unknown", lastUsedAt: null, nextRoutineAt: null, backgroundStartedAt: null, watching: false },
    ])
    expect(ids).toEqual(["idle"])
  })
})
