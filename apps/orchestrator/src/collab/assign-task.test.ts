import { beforeEach, describe, expect, it, vi } from "vitest"

const results: unknown[][] = []
const chain: any = {
  select: () => chain,
  from: () => chain,
  innerJoin: () => chain,
  where: () => chain,
  limit: async () => results.shift() ?? [],
}
const authz = vi.hoisted(() => ({ canUserReadRoom: vi.fn(), isAgentInRoom: vi.fn() }))
const applyTaskMutation = vi.hoisted(() => vi.fn())

vi.mock("../db", () => ({ getDb: () => chain, notify: vi.fn() }))
vi.mock("../authz", () => authz)
vi.mock("../push", () => ({ notifyHumansNeeded: vi.fn() }))
vi.mock("./tasks-service", async (original) => ({
  ...(await original<typeof import("./tasks-service")>()),
  applyTaskMutation,
}))

import { assignTask } from "./index"

const taskId = "00000000-0000-0000-0000-00000000000a"
const roomId = "00000000-0000-0000-0000-00000000000b"
const agent = { agentId: "agent-1", orgId: "org-1", handle: "codex" }

/** The task lookup and room check that every assignment starts with. */
function loadTask(...rest: unknown[][]) {
  results.length = 0
  results.push([{ id: taskId, roomId, orgId: "org-1" }], [{ roomId }], ...rest)
}

describe("assignTask", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    applyTaskMutation.mockResolvedValue({ task: { id: taskId, number: 7, title: "t", status: "in_progress" } })
  })

  it("refuses a person who shares the name but can't read the room", async () => {
    loadTask([{ id: "stranger" }])
    authz.canUserReadRoom.mockResolvedValue(false)
    await expect(assignTask(agent, { taskId, assignee: "human:Sam" })).rejects.toThrow("not in this room")
    expect(applyTaskMutation).not.toHaveBeenCalled()
  })

  it("asks rather than guesses between two people with the same name", async () => {
    loadTask([{ id: "sam-1" }, { id: "sam-2" }])
    authz.canUserReadRoom.mockResolvedValue(true)
    await expect(assignTask(agent, { taskId, assignee: "human:Sam" })).rejects.toThrow("more than one person")
  })

  it("assigns the one person in the room with that name", async () => {
    loadTask([{ id: "outsider" }, { id: "teammate" }])
    authz.canUserReadRoom.mockImplementation(async (id: string) => id === "teammate")
    await assignTask(agent, { taskId, assignee: "human:Sam" })
    expect(applyTaskMutation).toHaveBeenCalledWith(expect.objectContaining({ assigneeUserId: "teammate" }))
  })

  it("refuses an agent that isn't in the room", async () => {
    loadTask([{ id: "agent-2", handle: "hermes" }])
    authz.isAgentInRoom.mockResolvedValue(false)
    await expect(assignTask(agent, { taskId, assignee: "@hermes" })).rejects.toThrow("not in this room")
  })
})
