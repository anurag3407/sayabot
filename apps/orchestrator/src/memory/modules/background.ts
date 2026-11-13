import { redactSecrets } from "@sayabot/core"

/**
 * Small in-process queue for memory work that must not hold the room lock or delay the
 * reply: post-turn extraction, embedding, mirror sync, citation reinforcement.
 *
 * Bounded concurrency and a bounded backlog: under pressure new work is dropped (memory is
 * best-effort, the turn itself already succeeded). Work still queued when the process exits
 * is lost; the scheduled backfill re-embeds anything that missed its embedding.
 */

const MAX_CONCURRENT = 2
const MAX_PENDING = 200

interface Job {
  label: string
  task: () => Promise<unknown>
}

const queue: Job[] = []
let running = 0
let idleWaiters: Array<() => void> = []

export function runInBackground(label: string, task: () => Promise<unknown>): boolean {
  if (queue.length >= MAX_PENDING) {
    console.warn(`[memory] background queue full, dropping ${label}`)
    return false
  }
  queue.push({ label, task })
  pump()
  return true
}

function pump(): void {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()
    if (!job) break
    running++
    void job
      .task()
      .catch((error) => {
        console.warn(`[memory] ${job.label} failed:`, redactSecrets(String(error)).text)
      })
      .finally(() => {
        running--
        if (queue.length > 0) pump()
        else if (running === 0) {
          const waiters = idleWaiters
          idleWaiters = []
          for (const resolve of waiters) resolve()
        }
      })
  }
}

/** Resolves once every queued and running job has settled (tests, graceful shutdown). */
export function drainBackground(): Promise<void> {
  if (running === 0 && queue.length === 0) return Promise.resolve()
  return new Promise((resolve) => idleWaiters.push(resolve))
}
