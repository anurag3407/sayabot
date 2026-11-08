import { describe, expect, it } from "vitest"
import { RUN_RESUME_QUEUE, ROOM_MESSAGE_QUEUE, TASK_WAKE_QUEUE, WEBHOOK_QUEUE, enqueueRoomMessage, enqueueRunResume, enqueueWebhook } from "../../src/jobs"

describe("job queue names + enqueue guards (no boss started)", () => {
  it("queue names are stable strings", () => {
    expect(ROOM_MESSAGE_QUEUE).toBe("room.message")
    expect(WEBHOOK_QUEUE).toBe("webhook.deliver")
    expect(TASK_WAKE_QUEUE).toBe("task.wake")
    expect(RUN_RESUME_QUEUE).toBe("run.resume")
  })

  it("enqueue* throw a clear error when the queue was never started", async () => {
    await expect(enqueueRoomMessage("r", "m")).rejects.toThrow(/not started/)
    await expect(enqueueRunResume("run")).rejects.toThrow(/not started/)
    await expect(enqueueWebhook({} as never)).rejects.toThrow(/not started/)
  })
})
