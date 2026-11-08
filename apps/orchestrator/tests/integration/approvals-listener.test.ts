import { describe, expect, it, vi } from "vitest"

// waitForApproval with no DB rows: the poll path must time out to "rejected".
vi.mock("../../src/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) }),
  getPool: () => ({ connect: async () => ({ query: async () => {}, release() {}, on() {} }) }),
}))

import { resolveApprovalWaiter, waitForApproval } from "../../src/tools/approvals"

const ID = "11111111-1111-4111-8111-111111111111"

describe("waitForApproval", () => {
  it("times out to rejected when nobody decides (short timeout)", async () => {
    await expect(waitForApproval(ID, 60)).resolves.toBe("rejected")
  })

  it("a LISTEN/NOTIFY resolution wins over the timeout", async () => {
    const p = waitForApproval(ID, 5_000)
    // let the waiter register
    await new Promise((r) => setTimeout(r, 10))
    resolveApprovalWaiter(ID, "approved")
    await expect(p).resolves.toBe("approved")
  })

  it("resolving an unknown waiter is a no-op (does not throw)", () => {
    expect(() => resolveApprovalWaiter("no-such-id", "approved")).not.toThrow()
  })

  it("second resolution after settle is ignored", async () => {
    const p = waitForApproval(ID, 5_000)
    await new Promise((r) => setTimeout(r, 10))
    resolveApprovalWaiter(ID, "rejected")
    resolveApprovalWaiter(ID, "approved")
    await expect(p).resolves.toBe("rejected")
  })
})
