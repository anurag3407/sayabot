export interface RunInterrupt {
  messageId: string
  content: string
  senderId?: string
}

export interface ActiveRun {
  runId: string
  roomId: string
  agentId?: string
  engine?: string
  controller: AbortController
  pendingInterrupts: RunInterrupt[]
}

const runs = new Map<string, ActiveRun>()

export function registerRun(
  runId: string,
  roomId: string,
  meta?: { agentId?: string; engine?: string },
): AbortController {
  const controller = new AbortController()
  runs.set(runId, {
    runId,
    roomId,
    agentId: meta?.agentId,
    engine: meta?.engine,
    controller,
    pendingInterrupts: [],
  })
  return controller
}

export function unregisterRun(runId: string): void {
  runs.delete(runId)
}

export function abortRun(runId: string): boolean {
  const run = runs.get(runId)
  if (!run) return false
  run.controller.abort(new Error("stopped by request"))
  return true
}

export function abortRoomRuns(roomId: string, exceptRunId?: string): number {
  let count = 0
  for (const run of runs.values()) {
    if (run.roomId === roomId && run.runId !== exceptRunId) {
      run.controller.abort(new Error("superseded by a new human message"))
      count++
    }
  }
  return count
}

export function addRunInterrupt(runId: string, interrupt: RunInterrupt): boolean {
  const run = runs.get(runId)
  if (!run) return false
  run.pendingInterrupts.push(interrupt)
  return true
}

export function consumeRunInterrupts(runId: string): RunInterrupt[] {
  const run = runs.get(runId)
  if (!run || run.pendingInterrupts.length === 0) return []
  const interrupts = [...run.pendingInterrupts]
  run.pendingInterrupts = []
  return interrupts
}

export function findActiveRunForAgent(roomId: string, agentId: string): ActiveRun | undefined {
  for (const run of runs.values()) {
    if (run.roomId === roomId && run.agentId === agentId) {
      return run
    }
  }
  return undefined
}

export function activeRunIds(): string[] {
  return [...runs.keys()]
}

/** Every run in progress in a room (for side notes delivered to all of them). */
export function roomRuns(roomId: string): ActiveRun[] {
  return [...runs.values()].filter((run) => run.roomId === roomId)
}
