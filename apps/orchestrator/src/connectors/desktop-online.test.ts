import { beforeEach, describe, expect, it, vi } from "vitest"

const rows: unknown[][] = []
vi.mock("../db", () => {
  const chain = () => {
    const q = {
      from: () => q,
      where: () => q,
      orderBy: () => q,
      limit: async () => rows.shift() ?? [],
    }
    return q
  }
  return { getDb: () => ({ select: chain }) }
})

const { desktopOnline, DESKTOP_OFFLINE_AFTER_MS } = await import("./desktop-bridge")

const NOW = Date.parse("2026-11-13T12:00:00Z")

describe("desktopOnline", () => {
  beforeEach(() => {
    rows.length = 0
  })

  it("is online when the host heartbeated recently", async () => {
    rows.push([{ id: "host" }], [{ lastSeenAt: new Date(NOW - 5_000) }])
    await expect(desktopOnline("org", null, NOW)).resolves.toBe(true)
  })

  it("is offline after a minute of silence (lid closed)", async () => {
    rows.push([{ id: "host" }], [{ lastSeenAt: new Date(NOW - DESKTOP_OFFLINE_AFTER_MS - 1) }])
    await expect(desktopOnline("org", null, NOW)).resolves.toBe(false)
  })

  it("is offline when no computer is paired", async () => {
    rows.push([])
    await expect(desktopOnline("org", null, NOW)).resolves.toBe(false)
  })
})
