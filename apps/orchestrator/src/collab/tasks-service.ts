import { and, eq, inArray, ne } from "drizzle-orm"
import {
  type Db,
  agents,
  taskComments,
  taskEvents,
  tasks,
  type OutcomeKind,
  type UnblockNeeds,
} from "@sayabot/db"
import { getDb } from "../db"
import { enqueueTaskWake } from "../jobs"

export class CollabError extends Error {}

export interface TaskMutationActor {
  type: "human" | "agent" | "system"
  id: string
}

export interface TaskMutationInput {
  taskId: string
  actor: TaskMutationActor
  status?: "open" | "in_progress" | "stuck" | "done"
  title?: string
  description?: string
  assigneeUserId?: string | null
  assigneeAgentId?: string | null
  dueAt?: Date | string | null
  unblockNeeds?: UnblockNeeds | null
  unblockDetail?: string | null
  blockedBy?: string[] | null
  outcome?: {
    kind: OutcomeKind
    ref?: string | null
  } | null
  reason?: string | null
  note?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Single service-layer write path for all task mutations.
 * Enforces:
 * 1. Title immutability.
 * 2. Status invariants:
 *    - done requires completed_at and outcome_kind; outcome_kind='none' requires human actor.
 *    - stuck requires unblock_needs.
 *    - stuck with human_answer requires form evidence (agent cannot claim human-fact blocker before reading the form).
 *    - moving to in_progress with unresolved blockers requires an explicit reason.
 * 3. Same-room check for all blocked_by tasks.
 * 4. Atomic transaction updating tasks row and appending task_events row.
 * 5. Auto-closing moot requests linked to tasks completed with done.
 */
export async function applyTaskMutation(input: TaskMutationInput, dbOverride?: Db) {
  const db = dbOverride || getDb()

  const result = await db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1)

    if (!task) {
      throw new CollabError("task not found")
    }

    // Invariant 1: Title is immutable after creation
    if (input.title !== undefined && input.title !== task.title) {
      throw new CollabError("title is immutable after creation")
    }

    // Validate blockedBy array if provided
    const nextBlockedBy =
      input.blockedBy !== undefined ? (input.blockedBy ?? []) : task.blockedBy || []

    if (input.blockedBy !== undefined && input.blockedBy && input.blockedBy.length > 0) {
      if (input.blockedBy.includes(task.id)) {
        throw new CollabError("task cannot be blocked by itself")
      }
      const blockers = await tx
        .select({ id: tasks.id, roomId: tasks.roomId, status: tasks.status })
        .from(tasks)
        .where(inArray(tasks.id, input.blockedBy))

      if (blockers.length !== input.blockedBy.length) {
        throw new CollabError("one or more blocked_by tasks do not exist")
      }
      for (const b of blockers) {
        if (b.roomId !== task.roomId) {
          throw new CollabError("blocked_by tasks must belong to the same room")
        }
      }
    }

    const toStatus = input.status ?? task.status
    const isStatusChanging = input.status !== undefined && input.status !== task.status

    // Invariant 2: Done requires completed_at and outcome_kind; none requires human actor
    const effectiveOutcomeKind = input.outcome?.kind ?? task.outcomeKind

    if (toStatus === "done") {
      if (!effectiveOutcomeKind) {
        throw new CollabError("done tasks require an outcome (kind and optional ref)")
      }
      if (effectiveOutcomeKind === "none" && input.actor.type !== "human") {
        throw new CollabError(
          "agents cannot close tasks with outcome 'none'; an artifact, submission, external_change, or decision is required",
        )
      }
    }

    // Invariant 3: Stuck requires unblock_needs
    const effectiveUnblockNeeds =
      input.unblockNeeds !== undefined ? input.unblockNeeds : task.unblockNeeds
    if (toStatus === "stuck" && !effectiveUnblockNeeds) {
      throw new CollabError("marking a task stuck requires unblock_needs")
    }

    // Invariant 3b: Human-fact blocker validation
    // An agent cannot claim a human-fact blocker before reading the form that would ask for it.
    if (
      toStatus === "stuck" &&
      effectiveUnblockNeeds === "human_answer" &&
      input.actor.type === "agent"
    ) {
      const meta = (input.metadata ?? {}) as Record<string, unknown>
      const existingMeta = (task.metadata ?? {}) as Record<string, unknown>
      const formRef =
        (typeof meta.formRef === "string" && meta.formRef.trim().length > 0) ||
        (typeof meta.form_ref === "string" && meta.form_ref.trim().length > 0) ||
        (typeof meta.formUrl === "string" && meta.formUrl.trim().length > 0) ||
        (typeof meta.form_url === "string" && meta.form_url.trim().length > 0) ||
        (typeof existingMeta.formRef === "string" && existingMeta.formRef.trim().length > 0) ||
        (typeof existingMeta.formUrl === "string" && existingMeta.formUrl.trim().length > 0)
      const formRead = meta.formRead === true || existingMeta.formRead === true
      const detail = (input.unblockDetail ?? task.unblockDetail ?? "").trim()
      const detailCitesForm =
        /(form|application|page|url|field|screen|portal)/i.test(detail) && detail.length >= 15

      if (!formRef && !formRead && !detailCitesForm) {
        throw new CollabError(
          "cannot claim a human-fact blocker before reading the form that would ask for it: cite the form or provide form_ref and the specific missing field",
        )
      }
    }

    // Invariant 4: Moving to in_progress with open blockers requires explicit reason
    if (toStatus === "in_progress" && nextBlockedBy.length > 0) {
      const blockers = await tx
        .select({ id: tasks.id, status: tasks.status })
        .from(tasks)
        .where(inArray(tasks.id, nextBlockedBy))

      const hasUnresolved = blockers.some((b) => b.status !== "done")
      if (hasUnresolved && (!input.reason || input.reason.trim().length === 0)) {
        throw new CollabError(
          "moving to in_progress with open blockers requires an explicit reason",
        )
      }
    }

    const now = new Date()
    const statusChangedAt = isStatusChanging ? now : task.statusChangedAt
    let completedAt = task.completedAt
    if (toStatus === "done") {
      completedAt = now
    } else if (isStatusChanging) {
      completedAt = null
    }

    const updates: Partial<typeof tasks.$inferInsert> = {
      status: toStatus,
      statusChangedAt,
      completedAt,
      updatedAt: now,
    }

    if (input.description !== undefined) updates.description = input.description
    if (input.assigneeUserId !== undefined) updates.assigneeUserId = input.assigneeUserId
    if (input.assigneeAgentId !== undefined) updates.assigneeAgentId = input.assigneeAgentId
    if (input.dueAt !== undefined) updates.dueAt = input.dueAt ? new Date(input.dueAt) : null
    if (input.unblockNeeds !== undefined) updates.unblockNeeds = input.unblockNeeds
    if (input.unblockDetail !== undefined) updates.unblockDetail = input.unblockDetail
    if (input.blockedBy !== undefined) updates.blockedBy = input.blockedBy ?? []
    if (input.outcome !== undefined) {
      updates.outcomeKind = input.outcome?.kind ?? null
      updates.outcomeRef = input.outcome?.ref ?? null
    }
    if (input.metadata !== undefined) {
      updates.metadata = { ...(task.metadata as Record<string, unknown>), ...input.metadata }
    }

    const [updatedTask] = await tx
      .update(tasks)
      .set(updates)
      .where(eq(tasks.id, task.id))
      .returning()

    if (!updatedTask) {
      throw new CollabError("failed to update task")
    }

    const [event] = await tx
      .insert(taskEvents)
      .values({
        taskId: task.id,
        actorType: input.actor.type,
        actorId: input.actor.id,
        fromStatus: task.status,
        toStatus: toStatus,
        reason: input.reason ?? null,
        outcomeKind: updates.outcomeKind ?? task.outcomeKind ?? null,
        outcomeRef: updates.outcomeRef ?? task.outcomeRef ?? null,
        metadata: input.metadata ?? {},
        createdAt: now,
      })
      .returning()

    if (!event) {
      throw new CollabError("failed to record task event")
    }

    if (input.note && input.note.trim().length > 0) {
      await tx.insert(taskComments).values({
        taskId: task.id,
        authorType: input.actor.type,
        authorId: input.actor.id,
        content: input.note.trim().slice(0, 4_000),
        createdAt: now,
      })
    }

    // Auto-close moot requests linked to this task when task is completed
    if (toStatus === "done" && task.kind === "task") {
      const openRequests = await tx
        .select({
          id: tasks.id,
          number: tasks.number,
          metadata: tasks.metadata,
          blockedBy: tasks.blockedBy,
        })
        .from(tasks)
        .where(
          and(eq(tasks.roomId, task.roomId), eq(tasks.kind, "request"), eq(tasks.status, "open")),
        )

      for (const req of openRequests) {
        const reqMeta = (req.metadata || {}) as Record<string, unknown>
        const isLinkedByMeta = reqMeta.taskId === task.id
        const isLinkedByBlockedBy =
          (req.blockedBy || []).includes(task.id) || (task.blockedBy || []).includes(req.id)

        if (isLinkedByMeta || isLinkedByBlockedBy) {
          await tx
            .update(tasks)
            .set({
              status: "done",
              statusChangedAt: now,
              completedAt: now,
              outcomeKind: "decision",
              outcomeRef: `auto-closed: task ${task.id} completed`,
              updatedAt: now,
            })
            .where(eq(tasks.id, req.id))

          await tx.insert(taskEvents).values({
            taskId: req.id,
            actorType: "system",
            actorId: null,
            fromStatus: "open",
            toStatus: "done",
            reason: `auto-closed: task MESH-${task.number} completed, ask is moot`,
            outcomeKind: "decision",
            outcomeRef: `auto-closed: task ${task.id} completed`,
            metadata: { autoClosed: true, reason: "parent_task_completed", taskId: task.id },
            createdAt: now,
          })
        }
      }
    }

    // Collect any wakes to enqueue after transaction commit
    const wakesToEnqueue: Array<{
      taskId: string
      agentId: string
      reason: "assigned" | "unblocked" | "synthesize"
    }> = []

    // 1. If assigned to an agent now and status is open or in_progress, wake them
    const assigneeChanged =
      input.assigneeAgentId !== undefined && input.assigneeAgentId !== task.assigneeAgentId
    if (updatedTask.assigneeAgentId && (assigneeChanged || isStatusChanging)) {
      if (updatedTask.status === "open" || updatedTask.status === "in_progress") {
        wakesToEnqueue.push({
          taskId: updatedTask.id,
          agentId: updatedTask.assigneeAgentId,
          reason: "assigned",
        })
      }
    }

    // 2. Cascade unblocking and synthesis when done
    if (toStatus === "done") {
      // Find other tasks in the room blocked by this task
      const candidateBlockedTasks = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.roomId, task.roomId), ne(tasks.status, "done")))

      for (const cand of candidateBlockedTasks) {
        if (cand.blockedBy && cand.blockedBy.includes(task.id)) {
          const remainingBlockers = cand.blockedBy.filter((bId) => bId !== task.id)
          let allRemainingDone = true
          if (remainingBlockers.length > 0) {
            const openRemaining = await tx
              .select({ id: tasks.id })
              .from(tasks)
              .where(and(inArray(tasks.id, remainingBlockers), ne(tasks.status, "done")))
              .limit(1)
            if (openRemaining.length > 0) {
              allRemainingDone = false
            }
          }
          if (allRemainingDone && cand.assigneeAgentId) {
            wakesToEnqueue.push({
              taskId: cand.id,
              agentId: cand.assigneeAgentId,
              reason: "unblocked",
            })
          }
        }
      }

      // Synthesis check if subtask of a parent
      if (task.parentTaskId) {
        const siblingSubtasks = await tx
          .select({ id: tasks.id, status: tasks.status })
          .from(tasks)
          .where(and(eq(tasks.parentTaskId, task.parentTaskId), ne(tasks.id, task.id)))

        const allSiblingsDone = siblingSubtasks.every((s) => s.status === "done")
        if (allSiblingsDone) {
          const [parent] = await tx
            .select({ id: tasks.id, leadAgentId: tasks.leadAgentId })
            .from(tasks)
            .where(eq(tasks.id, task.parentTaskId))
            .limit(1)

          if (parent?.leadAgentId) {
            wakesToEnqueue.push({
              taskId: parent.id,
              agentId: parent.leadAgentId,
              reason: "synthesize",
            })
          }
        }
      }
    }

    return {
      task: updatedTask,
      event,
      wakes: wakesToEnqueue,
    }
  })

  // Enqueue wakes outside transaction
  for (const wake of result.wakes) {
    void enqueueTaskWake(wake)
  }

  return {
    task: result.task,
    event: result.event,
  }
}

export interface AutoCloseMootInput {
  roomId?: string
  orgId?: string
}

export interface AutoCloseMootResult {
  closedCount: number
  closedRequestIds: string[]
}

/**
 * Auto-closes moot open requests:
 * 1. Expired requests (expires_at <= now).
 * 2. Requests whose linked task (metadata.taskId) is already done.
 * Records typed task_events for each closure.
 */
export async function autoCloseMootRequests(
  input: AutoCloseMootInput,
  dbOverride?: Db,
): Promise<AutoCloseMootResult> {
  const db = dbOverride || getDb()
  const now = new Date()

  return await db.transaction(async (tx) => {
    const conditions = [eq(tasks.kind, "request"), eq(tasks.status, "open")]
    if (input.roomId) {
      conditions.push(eq(tasks.roomId, input.roomId))
    }
    if (input.orgId) {
      conditions.push(eq(tasks.orgId, input.orgId))
    }

    const openRequests = await tx
      .select({
        id: tasks.id,
        number: tasks.number,
        expiresAt: tasks.expiresAt,
        metadata: tasks.metadata,
      })
      .from(tasks)
      .where(and(...conditions))

    const toClose: Array<{ id: string; number: number; reason: string }> = []

    for (const req of openRequests) {
      // Condition A: Expired
      if (req.expiresAt && req.expiresAt <= now) {
        toClose.push({
          id: req.id,
          number: req.number,
          reason: "auto-closed: request expired without response (moot)",
        })
        continue
      }

      // Condition B: Associated task already done
      const meta = (req.metadata || {}) as Record<string, unknown>
      if (typeof meta.taskId === "string" && meta.taskId.trim().length > 0) {
        const [linkedTask] = await tx
          .select({ status: tasks.status, number: tasks.number })
          .from(tasks)
          .where(eq(tasks.id, meta.taskId))
          .limit(1)

        if (linkedTask && linkedTask.status === "done") {
          toClose.push({
            id: req.id,
            number: req.number,
            reason: `auto-closed: associated task MESH-${linkedTask.number} is already done (moot)`,
          })
        }
      }
    }

    for (const item of toClose) {
      await tx
        .update(tasks)
        .set({
          status: "done",
          statusChangedAt: now,
          completedAt: now,
          outcomeKind: "decision",
          outcomeRef: item.reason,
          updatedAt: now,
        })
        .where(eq(tasks.id, item.id))

      await tx.insert(taskEvents).values({
        taskId: item.id,
        actorType: "system",
        actorId: null,
        fromStatus: "open",
        toStatus: "done",
        reason: item.reason,
        outcomeKind: "decision",
        outcomeRef: item.reason,
        metadata: { autoClosed: true },
        createdAt: now,
      })
    }

    return {
      closedCount: toClose.length,
      closedRequestIds: toClose.map((t) => t.id),
    }
  })
}

export interface TaskCreateInput {
  orgId: string
  roomId: string
  title: string
  description?: string
  kind?: "task" | "request"
  status?: "open" | "in_progress"
  assigneeUserId?: string | null
  assigneeAgentId?: string | null
  requestedByAgentId?: string | null
  requestedFromUserId?: string | null
  dueAt?: Date | string | null
  blockedBy?: string[] | null
  budgetTurns?: number | null
  budgetUsd?: number | string | null
  parentTaskId?: string | null
  leadAgentId?: string | null
  metadata?: Record<string, unknown>
  actor: TaskMutationActor
}

export async function applyTaskCreate(input: TaskCreateInput, dbOverride?: Db) {
  const db = dbOverride || getDb()
  const now = new Date()
  const title = input.title.trim().slice(0, 200)
  if (!title) throw new CollabError("task title cannot be empty")

  const result = await db.transaction(async (tx) => {
    // Validate blockedBy if provided
    if (input.blockedBy && input.blockedBy.length > 0) {
      const blockers = await tx
        .select({ id: tasks.id, roomId: tasks.roomId })
        .from(tasks)
        .where(inArray(tasks.id, input.blockedBy))
      if (blockers.length !== input.blockedBy.length) {
        throw new CollabError("one or more blocked_by tasks do not exist")
      }
      for (const b of blockers) {
        if (b.roomId !== input.roomId) {
          throw new CollabError("blocked_by tasks must belong to the same room")
        }
      }
    }

    const initialStatus =
      input.status || (input.assigneeAgentId || input.assigneeUserId ? "in_progress" : "open")

    const [created] = await tx
      .insert(tasks)
      .values({
        orgId: input.orgId,
        roomId: input.roomId,
        kind: input.kind || "task",
        title,
        description: (input.description || "").slice(0, 4_000),
        status: initialStatus,
        assigneeUserId: input.assigneeUserId || null,
        assigneeAgentId: input.assigneeAgentId || null,
        requestedByAgentId: input.requestedByAgentId || null,
        requestedFromUserId: input.requestedFromUserId || null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        blockedBy: input.blockedBy || [],
        budgetTurns: input.budgetTurns || null,
        budgetUsd: input.budgetUsd ? String(input.budgetUsd) : null,
        parentTaskId: input.parentTaskId || null,
        leadAgentId: input.leadAgentId || null,
        createdBy: input.actor.type === "human" ? input.actor.id : null,
        metadata: input.metadata || {},
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!created) throw new CollabError("could not create task")

    const [event] = await tx
      .insert(taskEvents)
      .values({
        taskId: created.id,
        actorType: input.actor.type,
        actorId: input.actor.id,
        fromStatus: null,
        toStatus: initialStatus,
        reason: "created",
        metadata: input.metadata || {},
        createdAt: now,
      })
      .returning()

    return { task: created, event }
  })

  // Wake assigned agent if applicable
  if (result.task.assigneeAgentId) {
    void enqueueTaskWake({
      taskId: result.task.id,
      agentId: result.task.assigneeAgentId,
      reason: "assigned",
    })
  }

  return result
}

export function hasDependencyCycle(
  subtasks: Array<{ key: string; blockedBy?: string[] }>,
): boolean {
  const graph = new Map<string, string[]>()
  for (const s of subtasks) {
    graph.set(s.key, s.blockedBy?.filter((b) => subtasks.some((t) => t.key === b)) || [])
  }
  const visited = new Set<string>()
  const recStack = new Set<string>()

  function isCyclic(node: string): boolean {
    visited.add(node)
    recStack.add(node)
    for (const neighbor of graph.get(node) || []) {
      if (!visited.has(neighbor)) {
        if (isCyclic(neighbor)) return true
      } else if (recStack.has(neighbor)) {
        return true
      }
    }
    recStack.delete(node)
    return false
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      if (isCyclic(node)) return true
    }
  }
  return false
}

export interface TaskPlanSubtask {
  key: string
  title: string
  description?: string
  assignee?: string
  blockedBy?: string[]
  budgetTurns?: number
}

export interface TaskPlanInput {
  parentTaskId: string
  actor: TaskMutationActor
  subtasks: TaskPlanSubtask[]
}

export async function applyTaskPlan(input: TaskPlanInput, dbOverride?: Db) {
  const db = dbOverride || getDb()
  const now = new Date()

  if (!input.subtasks || input.subtasks.length === 0) {
    throw new CollabError("subtasks list cannot be empty")
  }
  if (input.subtasks.length > 12) {
    throw new CollabError("cannot plan more than 12 subtasks in one call")
  }

  // Check for dependency cycles across keys
  if (hasDependencyCycle(input.subtasks)) {
    throw new CollabError("cyclic dependency detected in subtask plan")
  }

  const result = await db.transaction(async (tx) => {
    const [parent] = await tx.select().from(tasks).where(eq(tasks.id, input.parentTaskId)).limit(1)
    if (!parent) throw new CollabError("parent task not found")

    // Update parent leadAgentId if actor is an agent and lead is not yet assigned
    if (input.actor.type === "agent" && !parent.leadAgentId) {
      await tx
        .update(tasks)
        .set({ leadAgentId: input.actor.id, updatedAt: now })
        .where(eq(tasks.id, parent.id))
    }

    const keyToTaskId = new Map<string, string>()
    const keyToAssigneeAgentId = new Map<string, string | null>()
    const createdList: Array<{
      key: string
      taskId: string
      number: number
      assigneeAgentId: string | null
    }> = []

    // 1. Create subtasks
    for (const s of input.subtasks) {
      let assigneeAgentId: string | null = null
      if (s.assignee) {
        if (s.assignee === "me" && input.actor.type === "agent") {
          assigneeAgentId = input.actor.id
        } else {
          const cleanHandle = s.assignee.replace(/^@/, "").trim()
          const [agentRow] = await tx
            .select({ id: agents.id })
            .from(agents)
            .where(and(eq(agents.orgId, parent.orgId), eq(agents.handle, cleanHandle)))
            .limit(1)
          if (agentRow) assigneeAgentId = agentRow.id
        }
      }

      const [subtask] = await tx
        .insert(tasks)
        .values({
          orgId: parent.orgId,
          roomId: parent.roomId,
          kind: "task",
          title: s.title.trim().slice(0, 200),
          description: (s.description || "").slice(0, 4_000),
          status: "open",
          parentTaskId: parent.id,
          assigneeAgentId,
          budgetTurns: s.budgetTurns || null,
          blockedBy: [], // resolved below
          createdBy: input.actor.type === "human" ? input.actor.id : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      if (!subtask) throw new CollabError(`could not create subtask "${s.key}"`)

      keyToTaskId.set(s.key, subtask.id)
      keyToAssigneeAgentId.set(s.key, assigneeAgentId)
      createdList.push({
        key: s.key,
        taskId: subtask.id,
        number: subtask.number,
        assigneeAgentId,
      })

      // Record event
      await tx.insert(taskEvents).values({
        taskId: subtask.id,
        actorType: input.actor.type,
        actorId: input.actor.id,
        fromStatus: null,
        toStatus: "open",
        reason: "planned",
        metadata: { parentTaskId: parent.id, planKey: s.key },
        createdAt: now,
      })
    }

    // 2. Resolve blockedBy keys to task IDs
    const wakesToTrigger: Array<{ taskId: string; agentId: string }> = []

    for (const s of input.subtasks) {
      const subtaskId = keyToTaskId.get(s.key)!
      const resolvedBlockedBy: string[] = []

      if (s.blockedBy && s.blockedBy.length > 0) {
        for (const dep of s.blockedBy) {
          if (keyToTaskId.has(dep)) {
            resolvedBlockedBy.push(keyToTaskId.get(dep)!)
          } else {
            // Check if it's an existing UUID in the room
            resolvedBlockedBy.push(dep)
          }
        }
        await tx
          .update(tasks)
          .set({ blockedBy: resolvedBlockedBy, updatedAt: now })
          .where(eq(tasks.id, subtaskId))
      }

      // If assigned and has no active blockers, queue wake
      const assigneeId = keyToAssigneeAgentId.get(s.key)
      if (assigneeId && resolvedBlockedBy.length === 0) {
        wakesToTrigger.push({ taskId: subtaskId, agentId: assigneeId })
      }
    }

    return {
      created: createdList,
      wakes: wakesToTrigger,
    }
  })

  // Trigger wakes for immediately unblocked assigned subtasks
  for (const w of result.wakes) {
    void enqueueTaskWake({
      taskId: w.taskId,
      agentId: w.agentId,
      reason: "assigned",
    })
  }

  return { created: result.created }
}
