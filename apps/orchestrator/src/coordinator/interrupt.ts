import { turnSessions } from "@sayabot/db"
import { and, eq } from "drizzle-orm"
import { abortRoomRuns, addRunInterrupt, roomRuns } from "../active-runs"
import { getDb, notify } from "../db"
import { handleMidRunInterrupt, type MessageInterruptCheck } from "../engine/interrupts"

export const INTERRUPT_CHANNEL = "mesh_room_interrupt"

/**
 * New human input handling:
 * In v2, if the message mentions an actively running agent, the steering message is delivered
 * directly to the agent's run without superseding or aborting it.
 * Otherwise, mark active sessions superseded and abort any in-flight run.
 */
export async function interruptRoom(
  roomId: string,
  incoming?: MessageInterruptCheck,
): Promise<void> {
  if (incoming && incoming.senderType === "human") {
    const result = handleMidRunInterrupt(roomId, incoming)
    if (result.steered) {
      // Steered into the running agent; do not mark session superseded
      return
    }
  }

  await getDb()
    .update(turnSessions)
    .set({ state: "superseded", updatedAt: new Date() })
    .where(and(eq(turnSessions.roomId, roomId), eq(turnSessions.state, "active")))
  abortRoomRuns(roomId)
  await notify(INTERRUPT_CHANNEL, { roomId }).catch(() => {})
}

/**
 * A "/btw" side note: hand it to every agent working in the room right now (agents that read
 * mid-run notes pick it up on their next step) and change nothing else: no abort, no new turn.
 * Agents that can't take notes mid-run read it in the transcript on their next round.
 */
export function deliverSideNote(roomId: string, note: MessageInterruptCheck): number {
  let delivered = 0
  for (const run of roomRuns(roomId)) {
    if (
      run.engine === "v2" &&
      addRunInterrupt(run.runId, { messageId: note.id, content: note.content })
    )
      delivered++
  }
  return delivered
}
