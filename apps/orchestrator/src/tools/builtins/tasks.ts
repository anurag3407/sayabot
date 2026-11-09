import { z } from "zod"
import {
  assignTask,
  castVote,
  claimTask,
  CollabError,
  createTask,
  listTasks,
  planTask,
  requestHumanDecision,
  startVote,
  updateTask,
  type CollabAgent,
} from "../../collab"
import { classifyAndRecordCheckin } from "../../collab/classify-checkin"
import type { ToolSpec } from "../audited"

const statusSchema = z.enum(["open", "in_progress", "stuck", "done"])
const unblockNeedsSchema = z.enum([
  "human_answer",
  "another_agent",
  "credential",
  "external_access",
  "time",
  "other",
])
const outcomeKindSchema = z.enum([
  "artifact",
  "submission",
  "external_change",
  "decision",
  "none",
  "legacy",
])

async function friendly<T>(run: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof CollabError) return { error: error.message }
    throw error
  }
}

/**
 * Board, decision and vote tools for built-in agents. They share their logic with
 * the MCP server so an LLM agent and a bot in someone's ChatGPT see the same rules.
 */
export function taskTools(args: {
  roomId: string
  orgId: string
  agentId: string
  handle: string
}): ToolSpec[] {
  const agent: CollabAgent = { agentId: args.agentId, orgId: args.orgId, handle: args.handle }
  const handoff =
    " To get a teammate to act on it during this turn, also mention them with @handle in your reply."
  return [
    {
      name: "list_tasks",
      description:
        "List tasks and requests on this room's board. Use it before creating duplicates or when a human asks what is still open.",
      schema: z.object({ status: statusSchema.optional(), mine: z.boolean().optional() }),
      dangerous: false,
      execute: (input: { status?: z.infer<typeof statusSchema>; mine?: boolean }) =>
        friendly(() => listTasks(agent, { roomId: args.roomId, ...input })),
    },
    {
      name: "create_task",
      description:
        "Create a task on this room's board. Break large goals into several tasks; set assign_to_me false to leave a task for a teammate to claim.",
      schema: z.object({
        title: z.string().min(2).max(120),
        description: z.string().max(4_000).optional(),
        assign_to_me: z.boolean().optional(),
      }),
      dangerous: false,
      execute: (input: { title: string; description?: string; assign_to_me?: boolean }) =>
        friendly(() =>
          createTask(agent, {
            roomId: args.roomId,
            title: input.title,
            description: input.description,
            assignToMe: input.assign_to_me,
          }),
        ),
    },
    {
      name: "schedule_followup",
      description:
        "Schedule an autonomous follow-up reminder or delayed action for yourself. The orchestrator will post your note into the room and wake you up when the timer expires. Use when waiting on builds, deployments, asynchronous human feedback, or scheduled audits.",
      schema: z.object({
        in_minutes: z.number().int().min(1).max(10_080).describe("Delay in minutes (1 min to 7 days)"),
        title: z.string().min(2).max(120).describe("Short title for the follow-up task"),
        note: z.string().max(2_000).describe("Detailed reminder or action note for what to check when awakened"),
      }),
      dangerous: false,
      execute: async (input: { in_minutes: number; title: string; note: string }) => {
        const dueAt = new Date(Date.now() + input.in_minutes * 60_000)
        return friendly(async () => {
          const task = await createTask(agent, {
            roomId: args.roomId,
            title: `[Follow-up] ${input.title}`,
            description: input.note,
            assignToMe: true,
          })
          await updateTask(agent, {
            taskId: task.id,
            unblockNeeds: "time",
            unblockDetail: `Follow up in ${input.in_minutes} minutes: ${input.note}`,
            dueAt: dueAt.toISOString(),
          })
          return {
            ok: true,
            taskId: task.id,
            scheduledFor: dueAt.toISOString(),
            inMinutes: input.in_minutes,
            message: `Follow-up scheduled for ${dueAt.toLocaleTimeString()} (${input.in_minutes}m from now).`,
          }
        })
      },
    },
    {
      name: "claim_task",
      description:
        "Claim an unassigned task before you start on it. Fails safely, telling you who holds it, if another agent got there first.",
      schema: z.object({ task_id: z.string().uuid() }),
      dangerous: false,
      execute: (input: { task_id: string }) => friendly(() => claimTask(agent, { taskId: input.task_id })),
    },
    {
      name: "report_checkin",
      description:
        "Report task progress or status changes during scheduled room check-ins. In digest mode, reports with no actual state changes are kept quiet in the daily digest. Stuck transitions, requests, and approvals always break through." +
        handoff,
      schema: z.object({
        summary: z.string().max(1_000).optional(),
        changed: z
          .array(
            z.object({
              task_ref: z.string().optional(),
              task_id: z.string().optional(),
              event_id: z.string().optional(),
            }),
          )
          .optional(),
        no_change: z.boolean().optional(),
      }),
      dangerous: false,
      execute: (input: {
        summary?: string
        changed?: Array<{ task_ref?: string; task_id?: string; event_id?: string }>
        no_change?: boolean
      }) =>
        friendly(() =>
          classifyAndRecordCheckin(agent, {
            roomId: args.roomId,
            summary: input.summary,
            changed: input.changed?.map((c) => ({
              taskRef: c.task_ref,
              taskId: c.task_id,
              eventId: c.event_id,
            })),
            noChange: input.no_change,
          }),
        ),
    },
    {
      name: "update_task",
      description:
        "Report progress on a task you hold: status, a progress note, or release it. Done requires outcome (artifact, submission, external_change, or decision). Stuck requires unblock_needs. Stuck with human_answer requires form evidence (form_ref or explicit form and required field in unblock_detail). Moving to in_progress with open blockers requires reason." +
        handoff,
      schema: z.object({
        task_id: z.string().uuid(),
        status: statusSchema.optional(),
        note: z.string().max(4_000).optional(),
        ask_help_from: z.string().optional(),
        release: z.boolean().optional(),
        due_at: z.string().optional(),
        unblock_needs: unblockNeedsSchema.optional(),
        unblock_detail: z.string().max(1_000).optional(),
        form_ref: z.string().optional(),
        blocked_by: z.array(z.string().uuid()).optional(),
        outcome: z
          .object({
            kind: outcomeKindSchema,
            ref: z.string().optional(),
          })
          .optional(),
        reason: z.string().optional(),
      }),
      dangerous: false,
      execute: (input: {
        task_id: string
        status?: z.infer<typeof statusSchema>
        note?: string
        ask_help_from?: string
        release?: boolean
        due_at?: string
        unblock_needs?: z.infer<typeof unblockNeedsSchema>
        unblock_detail?: string
        form_ref?: string
        blocked_by?: string[]
        outcome?: {
          kind: z.infer<typeof outcomeKindSchema>
          ref?: string
        }
        reason?: string
      }) =>
        friendly(() =>
          updateTask(agent, {
            taskId: input.task_id,
            status: input.status,
            note: input.note,
            askHelpFrom: input.ask_help_from,
            release: input.release,
            dueAt: input.due_at,
            unblockNeeds: input.unblock_needs,
            unblockDetail: input.unblock_detail,
            formRef: input.form_ref,
            blockedBy: input.blocked_by,
            outcome: input.outcome,
            reason: input.reason,
          }),
        ),
    },
    {
      name: "request_human_decision",
      description:
        "Check with the humans first. Puts a decision card in their Inbox for anything high-stakes, costly, irreversible or unclear. Give 2–6 short options so they can answer in one tap. Repeats with same question or fold_key fold into the existing question. Asks for completed tasks auto-close as moot.",
      schema: z.object({
        task_id: z.string().uuid().optional(),
        question: z.string().min(4).max(120),
        details: z.string().max(4_000).optional(),
        options: z.array(z.string().min(1).max(60)).max(6).optional(),
        fold_key: z.string().max(64).optional(),
      }),
      dangerous: false,
      execute: (input: { task_id?: string; question: string; details?: string; options?: string[]; fold_key?: string }) =>
        friendly(() =>
          requestHumanDecision(agent, {
            roomId: args.roomId,
            taskId: input.task_id,
            question: input.question,
            details: input.details,
            options: input.options,
            foldKey: input.fold_key,
          }),
        ),
    },
    {
      name: "start_vote",
      description:
        "Ask the other agents to vote between approaches. Returns a vote_id they use with cast_vote." + handoff,
      schema: z.object({
        question: z.string().min(4).max(300),
        options: z.array(z.string().min(1).max(120)).min(2).max(8),
      }),
      dangerous: false,
      execute: (input: { question: string; options: string[] }) =>
        friendly(() => startVote(agent, { roomId: args.roomId, ...input })),
    },
    {
      name: "cast_vote",
      description: "Vote on an open vote by option text or 1-based number, with a one-line reason.",
      schema: z.object({
        vote_id: z.string().uuid(),
        option: z.string().min(1),
        reason: z.string().max(500).optional(),
      }),
      dangerous: false,
      execute: (input: { vote_id: string; option: string; reason?: string }) =>
        friendly(() => castVote(agent, { voteId: input.vote_id, option: input.option, reason: input.reason })),
    },
    {
      name: "plan_task",
      description:
        "Break down a parent task into up to 12 coordinated subtasks with dependencies and assignees. Automatically detects cycles and wakes unblocked assignees.",
      schema: z.object({
        task_id: z.string().uuid(),
        subtasks: z
          .array(
            z.object({
              key: z.string().min(1).max(32),
              title: z.string().min(1).max(200),
              description: z.string().max(4_000).optional(),
              assignee: z.string().optional(),
              blockedBy: z.array(z.string()).optional(),
              budgetTurns: z.number().int().min(1).max(20).optional(),
            }),
          )
          .min(1)
          .max(12),
      }),
      dangerous: false,
      execute: (input: { task_id: string; subtasks: any[] }) =>
        friendly(() => planTask(agent, { taskId: input.task_id, subtasks: input.subtasks })),
    },
    {
      name: "assign_task",
      description: "Assign a task to an agent (@handle) or human (human:<name>).",
      schema: z.object({
        task_id: z.string().uuid(),
        assignee: z.string().min(1),
      }),
      dangerous: false,
      execute: (input: { task_id: string; assignee: string }) =>
        friendly(() => assignTask(agent, { taskId: input.task_id, assignee: input.assignee })),
    },
  ]
}
