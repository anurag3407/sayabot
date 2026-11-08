import { describe, expect, it, vi } from "vitest"

vi.mock("../../src/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) }),
  getPool: () => ({ connect: async () => ({ query: async () => {}, release() {}, on() {} }) }),
  notify: async () => {},
}))

import { notifyBotReply, waitForBotReply } from "../../src/bot-reply"

const args = { roomId: "r1", agentId: "a1", threadRootId: null }

describe("bot reply wait/notify (local waiter path)", () => {
  it("resolves with the message id when notified before timeout", async () => {
    const p = waitForBotReply(args, 5_000)
    await new Promise((r) => setTimeout(r, 10))
    await notifyBotReply({ ...args, messageId: "m-99" })
    await expect(p).resolves.toEqual({ messageId: "m-99" })
  })

  it("does not resolve for a different room/agent/thread", async () => {
    const p = waitForBotReply(args, 80)
    await new Promise((r) => setTimeout(r, 10))
    await notifyBotReply({ roomId: "other", agentId: "a1", threadRootId: null, messageId: "m-x" })
    await notifyBotReply({ roomId: "r1", agentId: "a1", threadRootId: "t1", messageId: "m-y" })
    await expect(p).resolves.toBeNull()
  })

  it("thread-scoped waiters only match their thread", async () => {
    const p = waitForBotReply({ ...args, threadRootId: "t1" }, 5_000)
    await new Promise((r) => setTimeout(r, 10))
    await notifyBotReply({ ...args, threadRootId: "t1", messageId: "m-t" })
    await expect(p).resolves.toEqual({ messageId: "m-t" })
  })
})
