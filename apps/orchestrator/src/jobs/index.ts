import { PgBoss } from "pg-boss"
import { handleTaskWake, type TaskWakeData } from "../collab/task-wake"
import { processRoomMessage } from "../coordinator"
import { getEnv } from "../env"
import { deliverWebhook, type WebhookJobData } from "./webhook"

export const ROOM_MESSAGE_QUEUE = "room.message"
export const WEBHOOK_QUEUE = "webhook.deliver"
export const TASK_WAKE_QUEUE = "task.wake"
export const RUN_RESUME_QUEUE = "run.resume"

let boss: PgBoss | null = null

export async function startJobs(): Promise<PgBoss> {
  const env = getEnv()
  const poolMax = process.env.DATABASE_POOL_MAX ? parseInt(process.env.DATABASE_POOL_MAX, 10) : 3
  const instance = new PgBoss({
    connectionString: env.DATABASE_URL,
    application_name: "sayabot-orchestrator",
    max: Math.min(poolMax, 3),
  })
  instance.on("error", (error) => console.error("[pg-boss] error", error))
  await instance.start()
  await instance.createQueue(ROOM_MESSAGE_QUEUE, {
    retryLimit: 0,
    expireInSeconds: 1_800,
    deleteAfterSeconds: 86_400,
  })
  await instance.createQueue(WEBHOOK_QUEUE, {
    retryLimit: 5,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 120,
    deleteAfterSeconds: 604_800,
  })
  await instance.createQueue(TASK_WAKE_QUEUE, {
    retryLimit: 2,
    expireInSeconds: 60,
    deleteAfterSeconds: 86_400,
  })
  await instance.createQueue(RUN_RESUME_QUEUE, {
    retryLimit: 3,
    retryDelay: 5,
    expireInSeconds: 300,
    deleteAfterSeconds: 86_400,
  })

  await instance.work<{ roomId: string; messageId: string }>(
    ROOM_MESSAGE_QUEUE,
    { batchSize: 1, localConcurrency: 4, pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await processRoomMessage(job.data.roomId, job.data.messageId, {
            enqueueWebhook: enqueueWebhook,
          })
        } catch (error) {
          console.error(`[coordinator] room ${job.data.roomId} failed`, error)
        }
      }
    },
  )

  await instance.work<WebhookJobData>(
    WEBHOOK_QUEUE,
    { batchSize: 1, localConcurrency: 4, pollingIntervalSeconds: 2 },
    async (jobs) => {
      for (const job of jobs) {
        await deliverWebhook(job.data, job.retryCount + 1)
      }
    },
  )

  await instance.work<TaskWakeData>(
    TASK_WAKE_QUEUE,
    { batchSize: 1, localConcurrency: 4, pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          await handleTaskWake(job.data)
        } catch (error) {
          console.error(`[task.wake] failed for task ${job.data.taskId}`, error)
        }
      }
    },
  )

  await instance.work<{ runId: string; reason?: string }>(
    RUN_RESUME_QUEUE,
    { batchSize: 1, localConcurrency: 4, pollingIntervalSeconds: 1 },
    async (jobs) => {
      for (const job of jobs) {
        try {
          const { resumeRun } = await import("../engine/resume")
          await resumeRun(job.data.runId)
        } catch (error) {
          console.error(`[run.resume] failed for run ${job.data.runId}`, error)
        }
      }
    },
  )

  boss = instance
  console.log("[pg-boss] workers online")
  return instance
}

export async function enqueueRoomMessage(roomId: string, messageId: string): Promise<void> {
  if (!boss) throw new Error("job queue is not started")
  await boss.send(ROOM_MESSAGE_QUEUE, { roomId, messageId })
}

export async function enqueueWebhook(data: WebhookJobData): Promise<void> {
  if (!boss) throw new Error("job queue is not started")
  await boss.send(WEBHOOK_QUEUE, data)
}

export async function enqueueTaskWake(data: TaskWakeData): Promise<void> {
  if (!boss) {
    try {
      await handleTaskWake(data)
    } catch (e) {
      console.error("[task.wake] direct invoke error", e)
    }
    return
  }
  await boss.send(TASK_WAKE_QUEUE, data, {
    retryLimit: 2,
    singletonKey: `${data.taskId}:${data.agentId}`,
    singletonSeconds: 30,
  })
}

export async function enqueueRunResume(runId: string, reason?: string): Promise<void> {
  if (!boss) throw new Error("job queue is not started")
  await boss.send(RUN_RESUME_QUEUE, { runId, reason })
}

export async function stopJobs(): Promise<void> {
  if (!boss) return
  const instance = boss
  boss = null
  await instance.stop({ graceful: true, timeout: 10_000 })
}
