import {
  abortRoomRuns,
  addRunInterrupt,
  findActiveRunForAgent,
  type RunInterrupt,
} from "../active-runs"

export interface MessageInterruptCheck {
  id: string
  content: string
  senderType: string
  mentions?: string[]
}

export interface InterruptResult {
  steered: boolean
  steeredRunIds: string[]
  abortedCount: number
}

/**
 * In Engine v2, a human message that mentions an actively running v2 agent is folded
 * into that agent's run as a mid-run steering message at the next step boundary.
 *
 * If the human message does NOT mention the running agent (or if it's a v1 run),
 * active runs are aborted to make way for the new turn as before.
 */
export function handleMidRunInterrupt(
  roomId: string,
  incoming: MessageInterruptCheck,
): InterruptResult {
  if (incoming.senderType !== "human") {
    return { steered: false, steeredRunIds: [], abortedCount: 0 }
  }

  const mentions = incoming.mentions ?? []
  const steeredRunIds: string[] = []

  for (const agentId of mentions) {
    const activeRun = findActiveRunForAgent(roomId, agentId)
    if (activeRun && activeRun.engine === "v2") {
      const interrupt: RunInterrupt = {
        messageId: incoming.id,
        content: incoming.content,
      }
      const added = addRunInterrupt(activeRun.runId, interrupt)
      if (added) {
        steeredRunIds.push(activeRun.runId)
      }
    }
  }

  // If one or more active v2 runs were steered, abort only the OTHER runs in the room
  if (steeredRunIds.length > 0) {
    let aborted = 0
    for (const steeredId of steeredRunIds) {
      aborted += abortRoomRuns(roomId, steeredId)
    }
    return {
      steered: true,
      steeredRunIds,
      abortedCount: aborted,
    }
  }

  // No running v2 agent mentioned: standard room interrupt
  const abortedCount = abortRoomRuns(roomId)
  return {
    steered: false,
    steeredRunIds: [],
    abortedCount,
  }
}
