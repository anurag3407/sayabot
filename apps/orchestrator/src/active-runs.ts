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
  /** When this run last did something visible: a step, a text delta, or a tool event. */
  lastActivityAt: number
  /** Tools of this run that have started and not yet finished. */
  toolsInFlight: number
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
    lastActivityAt: Date.now(),
    toolsInFlight: 0,
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

/** Marks visible progress, so a watchdog can tell a working turn from a wedged one. */
export function touchRun(runId: string): void {
  const run = runs.get(runId)
  if (run) run.lastActivityAt = Date.now()
}

/** A tool that is still running extends the silence a turn is allowed. */
export function beginRunTool(runId: string): void {
  const run = runs.get(runId)
  if (!run) return
  run.toolsInFlight += 1
  run.lastActivityAt = Date.now()
}

export function endRunTool(runId: string): void {
  const run = runs.get(runId)
  if (!run) return
  run.toolsInFlight = Math.max(0, run.toolsInFlight - 1)
  run.lastActivityAt = Date.now()
}

export interface RunActivity {
  runId: string
  roomId: string
  lastActivityAt: number
  toolsInFlight: number
}

/** Every run this process owns, with what it is doing, for the stall watchdog. */
export function runActivity(): RunActivity[] {
  return [...runs.values()].map((run) => ({
    runId: run.runId,
    roomId: run.roomId,
    lastActivityAt: run.lastActivityAt,
    toolsInFlight: run.toolsInFlight,
  }))
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
