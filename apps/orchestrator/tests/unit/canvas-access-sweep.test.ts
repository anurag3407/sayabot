import { describe, expect, it, vi } from "vitest"

vi.mock("../../src/db", () => ({ getDb: vi.fn() }))
vi.mock("../../src/env", () => ({ getEnv: vi.fn() }))

import { revokeStaleCanvasConnections } from "../../src/canvas/server"

function connection(userId: string | null, roomId = "room") {
  return { context: { userId, roomId }, close: vi.fn() }
}

function server(connections: ReturnType<typeof connection>[]) {
  return { documents: new Map([["doc", { getConnections: () => connections }]]) } as never
}

describe("revokeStaleCanvasConnections", () => {
  it("closes only people who lost the room", async () => {
    const kept = connection("kept")
    const removed = connection("removed")
    const count = await revokeStaleCanvasConnections(server([kept, removed]), async (id) => id === "kept")
    expect(count).toBe(1)
    expect(removed.close).toHaveBeenCalledOnce()
    expect(kept.close).not.toHaveBeenCalled()
  })

  it("keeps everyone when the access check fails", async () => {
    const person = connection("person")
    const count = await revokeStaleCanvasConnections(server([person]), async () => {
      throw new Error("db down")
    })
    expect(count).toBe(0)
    expect(person.close).not.toHaveBeenCalled()
  })

  it("checks a person once across several tabs", async () => {
    const canRead = vi.fn(async () => true)
    await revokeStaleCanvasConnections(server([connection("a"), connection("a")]), canRead)
    expect(canRead).toHaveBeenCalledOnce()
  })
})
