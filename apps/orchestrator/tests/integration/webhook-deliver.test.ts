import { describe, expect, it, vi } from "vitest"

// deliverWebhook: no agent row -> logged + dropped, no network.
vi.mock("../../src/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: () => ({ catch: () => {} }) }),
  }),
}))
vi.mock("../../src/env", () => ({ getEnv: () => ({ MESH_KEK: "k", MESH_ALLOW_PRIVATE_WEBHOOKS: false }) }))

import { deliverWebhook, type WebhookJobData } from "../../src/jobs/webhook"

const data = {
  orgId: "o", roomId: "r", agentId: "a", messageId: "m", sessionId: "s",
  payload: { event: "message.created", room_id: "r", thread_id: null, message_id: "m", sender: { id: "u", name: "U", type: "human" }, content: "hi", mentions: [], context_snapshot: [] },
} as WebhookJobData

describe("deliverWebhook drop paths", () => {
  it("resolves (does not throw) when the agent has no webhook configured", async () => {
    await expect(deliverWebhook(data, 1)).resolves.toBeUndefined()
  })
})
