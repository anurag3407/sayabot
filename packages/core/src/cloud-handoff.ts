/**
 * The first time Cloud is ready, this Mac's bots, chats, routines, and keys move there once.
 * When the plan ends they come back. A later resubscribe can copy again.
 */

export interface HandoffRecord {
  id: string
  [key: string]: unknown
}

export interface LocalWorkspaceSnapshot {
  bots: HandoffRecord[]
  chats: HandoffRecord[]
  routines: HandoffRecord[]
  keys: HandoffRecord[]
}

export type HandoffStep = "copy_to_cloud" | "copy_back" | "none"

export function planCloudHandoff(input: {
  cloudReady: boolean
  /** A copy is sitting on Cloud and has not been restored. */
  copied: boolean
  /** The paid plan is still active. */
  planActive: boolean
}): HandoffStep {
  if (input.cloudReady && input.planActive && !input.copied) return "copy_to_cloud"
  if (input.copied && !input.planActive) return "copy_back"
  return "none"
}

function byId<T extends HandoffRecord>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]))
}

/**
 * Moves one list onto the destination. The destination's row wins when both sides have the same id,
 * so a Cloud that already had its own bots keeps them.
 */
export function mergeRecords<T extends HandoffRecord>(destination: T[], incoming: T[]): T[] {
  const merged = byId(destination)
  for (const row of incoming) {
    if (!merged.has(row.id)) merged.set(row.id, row)
  }
  return [...merged.values()]
}

export function applyHandoff(
  destination: LocalWorkspaceSnapshot,
  incoming: LocalWorkspaceSnapshot,
): LocalWorkspaceSnapshot {
  return {
    bots: mergeRecords(destination.bots, incoming.bots),
    chats: mergeRecords(destination.chats, incoming.chats),
    routines: mergeRecords(destination.routines, incoming.routines),
    keys: mergeRecords(destination.keys, incoming.keys),
  }
}
