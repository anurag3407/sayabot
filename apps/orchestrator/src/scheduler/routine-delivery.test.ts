import { beforeEach, describe, expect, it, vi } from "vitest"

// One queued result per db.select() chain, in call order.
const rows: unknown[][] = []
vi.mock("../db", () => {
  const chain = () => {
    const q = {
      from: () => q,
      where: () => q,
      limit: async () => rows.shift() ?? [],
    }
    return q
  }
  return { getDb: () => ({ select: chain }), getPool: () => ({}) }
})
vi.mock("../jobs", () => ({ enqueueRoomMessage: vi.fn() }))

const { resolveRoutineDelivery } = await import("./routines")
const { readRoutineTrigger } = await import("./routine-results")

const ORG = "11111111-1111-1111-1111-111111111111"
const CONNECTOR = "22222222-2222-2222-2222-222222222222"
const telegram = (inbound: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  source: "telegram",
  status: "active",
  config: { inbound },
  ...extra,
})

describe("routine delivery to a chat", () => {
  beforeEach(() => {
    rows.length = 0
  })

  it("delivers to an allowed chat on an active messaging connector", async () => {
    rows.push([telegram({ enabled: true, allowedChats: ["-100"] })])
    await expect(
      resolveRoutineDelivery(ORG, { deliverTo: { connectorId: CONNECTOR, chatId: "-100" } }),
    ).resolves.toEqual({
      platform: "telegram",
      connectorId: CONNECTOR,
      chatId: "-100",
      externalId: "",
    })
  })

  it("refuses chats outside the connector's allow-list", async () => {
    rows.push([telegram({ enabled: true, allowedChats: ["-100"] })])
    await expect(
      resolveRoutineDelivery(ORG, { deliverTo: { connectorId: CONNECTOR, chatId: "999" } }),
    ).resolves.toBeNull()
  })

  it("refuses a connector from another org (the lookup is org-scoped and finds nothing)", async () => {
    rows.push([])
    await expect(
      resolveRoutineDelivery(ORG, { deliverTo: { connectorId: CONNECTOR, chatId: "-100" } }),
    ).resolves.toBeNull()
  })

  it("refuses non-messaging, inactive or chat-off connectors", async () => {
    rows.push([telegram({ enabled: true }, { source: "github" })])
    await expect(
      resolveRoutineDelivery(ORG, { deliverTo: { connectorId: CONNECTOR, chatId: "1" } }),
    ).resolves.toBeNull()
    rows.push([telegram({ enabled: true }, { status: "error" })])
    await expect(
      resolveRoutineDelivery(ORG, { deliverTo: { connectorId: CONNECTOR, chatId: "1" } }),
    ).resolves.toBeNull()
    rows.push([telegram({ enabled: false })])
    await expect(
      resolveRoutineDelivery(ORG, { deliverTo: { connectorId: CONNECTOR, chatId: "1" } }),
    ).resolves.toBeNull()
  })

  it("ignores malformed targets without querying", async () => {
    await expect(resolveRoutineDelivery(ORG, {})).resolves.toBeNull()
    await expect(
      resolveRoutineDelivery(ORG, { deliverTo: { connectorId: "x", chatId: "1" } }),
    ).resolves.toBeNull()
    await expect(
      resolveRoutineDelivery(ORG, { deliverTo: { connectorId: CONNECTOR, chatId: "" } }),
    ).resolves.toBeNull()
  })
})

describe("routine trigger", () => {
  it("reads routine metadata and ignores ordinary messages", () => {
    expect(
      readRoutineTrigger({
        kind: "routine",
        routineId: "r",
        routineRunId: "run",
        routineName: "Brief",
      }),
    ).toEqual({
      routineId: "r",
      routineRunId: "run",
      routineName: "Brief",
    })
    expect(readRoutineTrigger({ kind: "routine", routineId: "r" })).toBeNull()
    expect(readRoutineTrigger({ inbound: {} })).toBeNull()
    expect(readRoutineTrigger(null)).toBeNull()
  })
})
