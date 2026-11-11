import {
  canonicalFactKey,
  factsVisibleInRoom,
  humanizeFactKey,
  MAX_FACT_VALUE,
  type KnownFact,
} from "@sayabot/core"
import { ownerFacts } from "@sayabot/db"
import { and, eq, isNull, or } from "drizzle-orm"
import { getDb } from "../db"
import { CollabError } from "./tasks-service"

/**
 * Owner facts as seen by bots: what the people in the room have already answered.
 * Reads are scoped to the room (room facts + workspace-wide facts); bots never see
 * another room's facts.
 */

export async function loadFactsForRoom(orgId: string, roomId: string): Promise<KnownFact[]> {
  const rows = await getDb()
    .select({
      key: ownerFacts.key,
      label: ownerFacts.label,
      value: ownerFacts.value,
      roomId: ownerFacts.roomId,
      source: ownerFacts.source,
      updatedAt: ownerFacts.updatedAt,
    })
    .from(ownerFacts)
    .where(
      and(eq(ownerFacts.orgId, orgId), or(isNull(ownerFacts.roomId), eq(ownerFacts.roomId, roomId))),
    )
    .limit(500)
  return factsVisibleInRoom(
    rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
    roomId,
  )
}

/** The shape bots get back: small, stable, no internal ids. */
export function factsForAgent(facts: readonly KnownFact[]) {
  return facts.map((f) => ({
    key: f.key,
    label: f.label,
    value: f.value,
    scope: f.roomId ? "this_room" : "workspace",
    from: f.source === "agent" ? "a bot (unconfirmed)" : "the owner",
  }))
}

/**
 * A bot records something it learned from the owner's own material (a resume, a message,
 * a file they shared). It may add a new fact or correct one a bot wrote, but never
 * overwrite what a person answered: those change only from the owner's side.
 */
export async function saveAgentFact(input: {
  orgId: string
  roomId: string
  agentId: string
  key: string
  value: string
  note?: string
}) {
  const key = canonicalFactKey(input.key)
  const value = input.value.trim().slice(0, MAX_FACT_VALUE)
  if (!key) throw new CollabError("key is required, e.g. start_date or linkedin_url")
  if (!value) throw new CollabError("value is required")
  const note = input.note?.trim().slice(0, 300) || null

  const db = getDb()
  const [existing] = await db
    .select({ id: ownerFacts.id, source: ownerFacts.source, value: ownerFacts.value })
    .from(ownerFacts)
    .where(and(eq(ownerFacts.orgId, input.orgId), eq(ownerFacts.roomId, input.roomId), eq(ownerFacts.key, key)))
    .limit(1)

  if (existing && existing.source !== "agent") {
    return {
      saved: false,
      key,
      value: existing.value,
      reason:
        "The owner already answered this. Use their answer; if you think it changed, ask them with request_human_decision.",
    }
  }

  if (existing) {
    await db
      .update(ownerFacts)
      .set({ value, note, sourceAgentId: input.agentId, updatedAt: new Date() })
      .where(eq(ownerFacts.id, existing.id))
  } else {
    await db.insert(ownerFacts).values({
      orgId: input.orgId,
      roomId: input.roomId,
      key,
      label: humanizeFactKey(key),
      value,
      source: "agent",
      sourceAgentId: input.agentId,
      note,
    })
  }
  return {
    saved: true,
    key,
    value,
    scope: "this_room",
    next: "Saved as unconfirmed. The owner can see, edit or delete it under Inbox → What your agents know.",
  }
}
