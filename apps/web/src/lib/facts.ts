import "server-only"
import {
  askItemsFromMetadata,
  canonicalFactKey,
  fillItemsFromFacts,
  formatItemAnswers,
  humanizeFactKey,
  MAX_FACT_VALUE,
  type AskItem,
  type KnownFact,
} from "@sayabot/core"
import { extractHandles } from "@sayabot/core"
import { mutateTaskInOrchestrator, queueRoomMessage } from "@/lib/orchestrator"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Owner facts on the web side: every answer a person gives in the Inbox is kept, and any
 * other open question waiting on the same key is filled in at once, so a fact is answered
 * exactly once across every card and every bot.
 */

export async function upsertFact(input: {
  orgId: string
  roomId: string | null
  key: string
  value: string
  label?: string
  source: "answer" | "manual"
  userId: string
  taskId?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const key = canonicalFactKey(input.key)
  const value = input.value.trim().slice(0, MAX_FACT_VALUE)
  if (!key) return { ok: false, error: "Give it a name" }
  if (!value) return { ok: false, error: "Write the answer" }
  const admin = createAdminClient()

  let query = admin.from("owner_facts").select("id").eq("org_id", input.orgId).eq("key", key)
  query = input.roomId ? query.eq("room_id", input.roomId) : query.is("room_id", null)
  const { data: existing } = await query.maybeSingle()

  const row = {
    label: input.label?.trim().slice(0, 80) || humanizeFactKey(key),
    value,
    source: input.source,
    source_task_id: input.taskId ?? null,
    source_agent_id: null,
    note: null,
    updated_by: input.userId,
  }
  const { error } = existing
    ? await admin.from("owner_facts").update(row).eq("id", existing.id)
    : await admin.from("owner_facts").insert({ ...row, org_id: input.orgId, room_id: input.roomId, key })
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function factsVisibleTo(orgId: string, roomId: string): Promise<KnownFact[]> {
  const { data } = await createAdminClient()
    .from("owner_facts")
    .select("key, label, value, room_id, source, updated_at")
    .eq("org_id", orgId)
    .or(`room_id.is.null,room_id.eq.${roomId}`)
    .limit(500)
  return ((data ?? []) as { key: string; label: string; value: string; room_id: string | null; source: string; updated_at: string }[]).map(
    (r) => ({ key: r.key, label: r.label, value: r.value, roomId: r.room_id, source: r.source, updatedAt: r.updated_at }),
  )
}

/**
 * Fills open keyed questions from facts. Bots get one message with what was filled, and
 * questions with nothing left are closed. `roomIds` limits the sweep (null = whole org,
 * used after a workspace-wide fact changes).
 */
export async function resolveOpenAsksFromFacts(input: {
  orgId: string
  roomIds: string[] | null
  userId: string
  skipTaskIds?: string[]
}): Promise<number> {
  const admin = createAdminClient()
  let query = admin
    .from("tasks")
    .select("id, room_id, requested_by_agent_id, metadata, expires_at")
    .eq("org_id", input.orgId)
    .eq("kind", "request")
    .eq("status", "open")
    .limit(100)
  if (input.roomIds) query = query.in("room_id", input.roomIds)
  const { data } = await query
  const nowIso = new Date().toISOString()
  const rows = ((data ?? []) as {
    id: string
    room_id: string
    requested_by_agent_id: string | null
    metadata: Record<string, unknown>
    expires_at: string | null
  }[]).filter(
    (row) =>
      !input.skipTaskIds?.includes(row.id) &&
      (!row.expires_at || row.expires_at > nowIso) &&
      askItemsFromMetadata(row.metadata).length > 0,
  )

  const factsByRoom = new Map<string, KnownFact[]>()
  let resolved = 0
  for (const row of rows) {
    if (!factsByRoom.has(row.room_id)) factsByRoom.set(row.room_id, await factsVisibleTo(input.orgId, row.room_id))
    const filled = fillItemsFromFacts(askItemsFromMetadata(row.metadata), factsByRoom.get(row.room_id)!, row.room_id)
    if (!filled.answeredKeys.length) continue
    resolved += 1
    await deliverItemAnswers({
      taskId: row.id,
      roomId: row.room_id,
      agentId: row.requested_by_agent_id,
      userId: input.userId,
      items: filled.items,
      answeredKeys: filled.answeredKeys,
      remaining: filled.remaining,
      intro: "Already answered:",
      metadata: row.metadata,
    })
  }
  return resolved
}

/** Posts answered items to the bot, saves them on the request, and closes it when nothing is left. */
export async function deliverItemAnswers(input: {
  taskId: string
  roomId: string
  agentId: string | null
  userId: string
  items: AskItem[]
  answeredKeys: string[]
  remaining: number
  intro?: string
  extra?: string
  targetRoomId?: string
  metadata: Record<string, unknown>
}): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const admin = createAdminClient()
  let handle: string | null = null
  if (input.agentId) {
    const { data } = await admin.from("agents").select("handle").eq("id", input.agentId).maybeSingle()
    handle = data?.handle ?? null
  }
  const lines = formatItemAnswers(input.items, input.answeredKeys)
  const body = [input.intro, lines, input.extra?.trim()].filter(Boolean).join("\n")
  const targetRoomId = input.targetRoomId ?? input.roomId
  const inGroup = targetRoomId === input.roomId
  const content = inGroup && handle ? `@${handle} ${body}` : body
  const tail =
    input.remaining > 0
      ? `\n(${input.remaining} still open on this question.)`
      : ""

  const { data: message, error } = await admin
    .from("messages")
    .insert({
      room_id: targetRoomId,
      sender_type: "human",
      sender_id: input.userId,
      content: content + tail,
      status: "complete",
      mentions: extractHandles(content),
      metadata: {
        taskId: input.taskId,
        requestAnswer: true,
        answeredKeys: input.answeredKeys,
        ...(!inGroup && input.agentId ? { dmToAgentId: input.agentId } : {}),
      },
    })
    .select("id")
    .single()
  if (error || !message) return { ok: false, error: error?.message ?? "Could not post the answer" }
  await queueRoomMessage(targetRoomId, message.id)

  const answeredAt = new Date().toISOString()
  if (input.remaining === 0) {
    await mutateTaskInOrchestrator({
      taskId: input.taskId,
      actor: { type: "human", id: input.userId },
      status: "done",
      outcome: { kind: "decision", ref: message.id },
      reason: "human answered request",
      note: formatItemAnswers(input.items),
      metadata: {
        items: input.items,
        answer: [formatItemAnswers(input.items), input.extra?.trim()].filter(Boolean).join("\n"),
        answeredBy: input.userId,
        answeredAt,
      },
    })
  } else {
    await admin
      .from("tasks")
      .update({ metadata: { ...input.metadata, items: input.items }, updated_at: answeredAt })
      .eq("id", input.taskId)
  }
  return { ok: true, messageId: message.id }
}
