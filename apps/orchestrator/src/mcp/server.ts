import { planCanvasPatch, redactSecrets } from "@sayabot/core"
import { canvasVersions, profiles, rooms } from "@sayabot/db"
import { eq } from "drizzle-orm"
import type { Context } from "hono"
import { Hono } from "hono"
import { z } from "zod"
import { authenticateAgentKey, type BotIdentity } from "../bot/auth"
import { getHocuspocus, loadCanvas, persistCanvasState } from "../canvas/server"
import {
  agentRooms,
  assignTask,
  castVote,
  checkIn,
  claimTask,
  CollabError,
  createTask,
  getInbox,
  getOwnerFacts,
  getRequestStatus,
  getRoomMessages,
  getVote,
  listTasks,
  planTask,
  postAgentMessage,
  rememberOwnerFact,
  requestHumanDecision,
  resolveAgentRoomId,
  sendBotDirectMessage,
  startVote,
  updateAgentProfile,
  updateTask,
  type CollabAgent,
} from "../collab"
import { classifyAndRecordCheckin } from "../collab/classify-checkin"
import { getDb } from "../db"
import { loadTaskBriefContext } from "../runner/context"
import { useSecretTool } from "../tools/builtins/use-secret"
import { waitForActivity } from "./activity"
import { generateSetupInstructions } from "./instructions"

/**
 * Sayabot as an MCP server. Any MCP client — Claude Desktop/Code, ChatGPT connectors,
 * Cursor, Gemini — connects with an agent API key and becomes a room member that
 * uses its owner's own subscription. Transport is Streamable HTTP with plain JSON
 * responses (no server-initiated stream), which every current client supports.
 */

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
const SERVER_INFO = { name: "sayabot", title: "Sayabot rooms", version: "1.0.0" }

const INSTRUCTIONS = [
  "You are connected to Sayabot, a shared workspace where humans and several AI agents work together in rooms.",
  "Start every session with get_inbox: it returns new messages that mention you, tasks you can claim, and answers to questions you asked the humans.",
  "Read a room with get_room_messages before posting. Post with post_message; mention a teammate with @handle to wake them.",
  "Use the task board: claim_task before starting work so two agents never do the same job, update_task to report progress, and status \"stuck\" to ask teammates for help.",
  "Never take high-stakes actions (spending money, deleting data, sending things outside the team) on your own: call request_human_decision with clear options and wait for the answer.",
  "Before asking the humans for a fact about them (start date, salary, city, links), read get_owner_facts. Ask only for what is missing, with request_human_decision items that each carry a key; known keys are answered for you and the same thing is never asked twice.",
  "For choices between approaches, start_vote and let the other agents cast_vote.",
].join("\n")

const uuid = z.string().uuid()
const taskStatus = z.enum(["open", "in_progress", "stuck", "done"])

interface McpTool<S extends z.ZodType = z.ZodType> {
  name: string
  title: string
  description: string
  schema: S
  readOnly?: boolean
  scope?: string
  run: (agent: CollabAgent, input: z.infer<S>) => Promise<unknown>
}

function defineTool<S extends z.ZodType>(t: McpTool<S>): McpTool {
  return t as unknown as McpTool
}

export const MCP_TOOLS: McpTool[] = [
  defineTool({
    name: "check_in",
    title: "Check in",
    description:
      "Start here whenever you work in this room on Saaya: at the room's check-in times, when you join, or when the person running you asks. Returns your identity, room details, house rules, unread messages/mentions, available and assigned tasks, and pending human decisions.",
    schema: z.object({
      room_id: z.string().optional().describe("Room ID. If you only belong to one room, this is optional."),
      room: z.string().optional().describe("Room ID or room name (from check-in instructions)."),
    }),
    readOnly: true,
    run: (agent, input) => checkIn(agent, { roomId: input.room_id, room: input.room }),
  }),
  defineTool({
    name: "whoami",
    title: "Who am I",
    description: "Your Sayabot identity and the rooms you belong to.",
    schema: z.object({}),
    readOnly: true,
    run: async (agent) => ({ handle: `@${agent.handle}`, rooms: await agentRooms(agent) }),
  }),
  defineTool({
    name: "get_inbox",
    title: "Get inbox",
    description:
      "Everything new for you since you last checked: messages that mention you or @all_bots, direct messages from other bots, open tasks you can claim or already hold, and answers to your human requests. Call this first, and again whenever you finish a piece of work.",
    schema: z.object({
      mark_as_read: z.boolean().optional().describe("Default true. Set false to peek without advancing your read cursor."),
    }),
    readOnly: true,
    run: (agent, input) => getInbox(agent, { markAsRead: input.mark_as_read }),
  }),
  defineTool({
    name: "list_rooms",
    title: "List rooms",
    description: "Rooms you are a member of, with their directive.",
    schema: z.object({}),
    readOnly: true,
    run: (agent) => agentRooms(agent),
  }),
  defineTool({
    name: "get_room_messages",
    title: "Read room messages",
    description: "Recent messages in a room (or one thread), oldest first. Marks the room as read for you.",
    schema: z.object({
      room_id: z.string().optional(),
      room: z.string().optional(),
      thread_id: uuid.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    readOnly: true,
    run: (agent, input) =>
      getRoomMessages(agent, { roomId: input.room_id, room: input.room, threadId: input.thread_id, limit: input.limit }),
  }),
  defineTool({
    name: "post_message",
    title: "Post message",
    description:
      "Post a message to a room as yourself. Markdown is rendered. Mentioning another agent with @handle wakes it to reply. Use thread_id to reply inside a thread.",
    schema: z.object({
      room_id: z.string().optional(),
      room: z.string().optional(),
      content: z.string().min(1).max(32_000).optional(),
      text: z.string().min(1).max(32_000).optional().describe("Message text (alias for content)."),
      thread_id: uuid.optional(),
    }),
    run: (agent, input) => {
      const content = (input.content ?? input.text ?? "").trim()
      if (!content) throw new CollabError("message text is required")
      return postAgentMessage(agent, {
        roomId: input.room_id,
        room: input.room,
        content,
        threadRootId: input.thread_id,
      })
    },
  }),
  defineTool({
    name: "send_message",
    title: "Send message",
    description: "Alias for post_message. Post a message to a room as yourself.",
    schema: z.object({
      room_id: z.string().optional(),
      room: z.string().optional(),
      content: z.string().min(1).max(32_000).optional(),
      text: z.string().min(1).max(32_000).optional(),
      thread_id: uuid.optional(),
      reply_to: uuid.optional(),
    }),
    run: (agent, input) => {
      const content = (input.content ?? input.text ?? "").trim()
      if (!content) throw new CollabError("message text is required")
      return postAgentMessage(agent, {
        roomId: input.room_id,
        room: input.room,
        content,
        threadRootId: input.thread_id ?? input.reply_to,
      })
    },
  }),
  defineTool({
    name: "send_direct_message",
    title: "Message another bot",
    description:
      "Send a direct message to one teammate bot to coordinate. It wakes that bot. The humans who own the room can read every bot-to-bot message.",
    schema: z.object({
      room_id: z.string().optional(),
      room: z.string().optional(),
      to: z.string().min(1).describe("Handle of the bot, e.g. @gemini"),
      content: z.string().min(1).max(16_000),
    }),
    run: (agent, input) =>
      sendBotDirectMessage(agent, {
        roomId: input.room_id,
        room: input.room,
        toHandle: input.to,
        content: input.content,
      }),
  }),
  defineTool({
    name: "list_tasks",
    title: "List tasks",
    description: "The room's task board. Check it before creating a task so you do not duplicate one.",
    schema: z.object({
      room_id: z.string().optional(),
      room: z.string().optional(),
      status: taskStatus.optional(),
      mine: z.boolean().optional(),
    }),
    readOnly: true,
    run: (agent, input) =>
      listTasks(agent, { roomId: input.room_id, room: input.room, status: input.status, mine: input.mine }),
  }),
  defineTool({
    name: "create_task",
    title: "Create task",
    description:
      "Add a task to the room's board. By default you take it yourself; set assign_to_me false to leave it for a teammate to claim. Split big goals into several tasks.",
    schema: z.object({
      room_id: z.string().optional(),
      room: z.string().optional(),
      title: z.string().min(2).max(120),
      description: z.string().max(4_000).optional(),
      assign_to_me: z.boolean().optional(),
    }),
    run: (agent, input) =>
      createTask(agent, {
        roomId: input.room_id,
        room: input.room,
        title: input.title,
        description: input.description,
        assignToMe: input.assign_to_me,
      }),
  }),
  defineTool({
    name: "claim_task",
    title: "Claim task",
    description: "Atomically claim an unassigned task. If another agent already holds it you are told who, and nothing changes.",
    schema: z.object({ task_id: uuid }),
    run: (agent, input) => claimTask(agent, { taskId: input.task_id }),
  }),
  defineTool({
    name: "take_task",
    title: "Take task",
    description: "Alias for claim_task. Atomically claim an unassigned task.",
    schema: z.object({ task_id: uuid }),
    run: (agent, input) => claimTask(agent, { taskId: input.task_id }),
  }),
  defineTool({
    name: "report_checkin",
    title: "Report check-in",
    description:
      "Report task progress or status changes during scheduled room check-ins. In digest mode, reports with no actual state changes are kept quiet in the daily digest. Stuck transitions, requests, and approvals always break through.",
    schema: z.object({
      room_id: z.string().optional(),
      room: z.string().optional(),
      summary: z.string().max(1_000).optional().describe("Summary of what moved or where things stand"),
      changed: z
        .array(
          z.object({
            task_ref: z.string().optional(),
            task_id: z.string().optional(),
            event_id: z.string().optional(),
          }),
        )
        .optional()
        .describe("Specific task events that changed since last check-in"),
      no_change: z.boolean().optional().describe("Set true if work is continuing with no new state changes"),
    }),
    run: (agent, input) =>
      classifyAndRecordCheckin(agent, {
        roomId: input.room_id,
        room: input.room,
        summary: input.summary,
        changed: input.changed?.map((c) => ({
          taskRef: c.task_ref,
          taskId: c.task_id,
          eventId: c.event_id,
        })),
        noChange: input.no_change,
      }),
  }),
  defineTool({
    name: "update_task",
    title: "Update task",
    description:
      "Report progress on a task you hold: change status, add a progress note, or release it. Setting status \"stuck\" requires unblock_needs. Setting status \"stuck\" with unblock_needs \"human_answer\" is a human-fact blocker: you cannot claim a human-fact blocker before reading the form or application that would ask for it; provide form_ref or cite the exact form/field in unblock_detail. Setting status \"done\" requires an outcome (artifact, submission, external_change, or decision). Moving to in_progress with open blockers requires a reason.",
    schema: z.object({
      task_id: uuid,
      status: taskStatus.optional(),
      note: z.string().max(4_000).optional(),
      ask_help_from: z.string().optional().describe("Handle of the teammate best placed to unstick you"),
      release: z.boolean().optional().describe("Give the task back to the board"),
      due_at: z.string().optional().describe("ISO timestamp when the task is due"),
      unblock_needs: z
        .enum([
          "human_answer",
          "another_agent",
          "credential",
          "external_access",
          "time",
          "other",
        ])
        .optional()
        .describe("Required when status is stuck"),
      unblock_detail: z.string().max(1_000).optional().describe("Explanation of blocker. When unblock_needs is human_answer, must cite form/application evidence."),
      form_ref: z.string().optional().describe("URL or canvas/form citation when setting stuck due to human_answer (cannot claim human-fact blocker before reading the form)"),
      blocked_by: z.array(uuid).optional().describe("Array of task IDs blocking this task"),
      outcome: z
        .object({
          kind: z.enum([
            "artifact",
            "submission",
            "external_change",
            "decision",
            "none",
            "legacy",
          ]),
          ref: z.string().optional().describe("Canvas ID, URL, or commit/task ref"),
        })
        .optional()
        .describe("Required when status is done"),
      reason: z.string().optional().describe("Reason for override or status transition"),
    }),
    run: (agent, input) =>
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
  }),
  defineTool({
    name: "request_human_decision",
    title: "Ask the humans",
    description:
      "Check with the humans first. Sends an approval card to their Inbox (and a push alert) for high-stakes decisions, spending, anything irreversible, or missing information. Repeats with the same question or fold_key automatically fold into the existing question. Asks for completed tasks auto-close as moot.",
    schema: z.object({
      room_id: z.string().optional(),
      room: z.string().optional(),
      task_id: uuid.optional().describe("Optional task ID this request blocks or belongs to; asks for completed tasks auto-close as moot"),
      question: z.string().min(4).max(120).describe("One-line headline the person sees first"),
      details: z.string().max(4_000).optional(),
      options: z.array(z.string().min(1).max(60)).max(6).optional(),
      fold_key: z.string().max(64).optional().describe("Optional deduplication key; defaults to normalized question hash"),
      items: z
        .array(
          z.object({
            key: z
              .string()
              .max(48)
              .describe(
                "Stable snake_case name for the fact, e.g. start_date, work_authorization, expected_salary, current_salary, notice_period, location, relocation, linkedin_url, github_url, graduation_date, cgpa, years_of_experience, or go_<thing> for a yes/no decision",
              ),
            question: z.string().min(2).max(300).describe("The plain question for this one item"),
            hint: z.string().max(300).optional().describe("Why you need it or what format helps"),
            options: z.array(z.string().min(1).max(60)).max(6).optional().describe("Quick answers, e.g. Yes / No"),
          }),
        )
        .max(8)
        .optional()
        .describe(
          "Ask for several facts at once, one item each. Items already answered come back in `known` and are not shown to the person; items another open question already asks are not repeated.",
        ),
    }),
    run: (agent, input) =>
      requestHumanDecision(agent, {
        roomId: input.room_id,
        room: input.room,
        taskId: input.task_id,
        question: input.question,
        details: input.details,
        options: input.options,
        foldKey: input.fold_key,
        items: input.items,
      }),
  }),
  defineTool({
    name: "get_owner_facts",
    title: "What the owner already told us",
    description:
      "Facts the people in this room have already answered (start date, salary, links, decisions). Read this before asking them anything: never ask for a key that is here.",
    schema: z.object({ room_id: z.string().optional(), room: z.string().optional() }),
    readOnly: true,
    run: (agent, input) => getOwnerFacts(agent, { roomId: input.room_id, room: input.room }),
  }),
  defineTool({
    name: "remember_owner_fact",
    title: "Remember a fact about the owner",
    description:
      "Record a fact you found in the owner's own material (their resume, a file or message they shared) so no bot asks them for it. It is saved as unconfirmed and the owner can edit or delete it. You cannot overwrite something the owner answered.",
    schema: z.object({
      room_id: z.string().optional(),
      room: z.string().optional(),
      key: z.string().min(1).max(48).describe("snake_case key, e.g. cgpa or linkedin_url"),
      value: z.string().min(1).max(1_000),
      note: z.string().max(300).optional().describe("Where you found it, e.g. 'resume PDF, 27 Oct'"),
    }),
    run: (agent, input) =>
      rememberOwnerFact(agent, {
        roomId: input.room_id,
        room: input.room,
        key: input.key,
        value: input.value,
        note: input.note,
      }),
  }),
  defineTool({
    name: "ask_for_help",
    title: "Ask for help or approval",
    description:
      "Ask the room owner for approval, permission, or guidance before taking high-stakes actions.",
    schema: z.object({
      room_id: z.string().optional(),
      room: z.string().optional(),
      type: z.enum(["approval", "permission", "question", "heads_up", "help"]).optional(),
      text: z.string().min(1).max(4000).optional(),
      question: z.string().min(1).max(120).optional(),
      details: z.string().max(4000).optional(),
      options: z.array(z.string().min(1).max(60)).max(6).optional(),
    }),
    run: (agent, input) => {
      const question = (input.question ?? input.text ?? "").slice(0, 120)
      if (!question) throw new CollabError("question or text is required")
      return requestHumanDecision(agent, {
        roomId: input.room_id,
        room: input.room,
        question,
        details: input.details ?? (input.text && input.text.length > 120 ? input.text : undefined),
        options: input.options,
      })
    },
  }),
  defineTool({
    name: "update_my_profile",
    title: "Update your profile",
    description:
      "Tell the room what you're good at (e.g. 'code review, frontend bug fixes') so teammates know how to divide work.",
    schema: z.object({
      good_at: z.string().max(300).optional(),
      name: z.string().max(80).optional(),
    }),
    run: (agent, input) => updateAgentProfile(agent, { goodAt: input.good_at, name: input.name }),
  }),
  defineTool({
    name: "get_request_status",
    title: "Check a human request",
    description: "Whether the humans have answered one of your requests yet, and what they said.",
    schema: z.object({ request_id: uuid }),
    readOnly: true,
    run: (agent, input) => getRequestStatus(agent, { requestId: input.request_id }),
  }),
  defineTool({
    name: "start_vote",
    title: "Start a vote",
    description: "Ask the other agents to vote between approaches. Wakes every bot in the room unless wake is false.",
    schema: z.object({
      room_id: uuid,
      question: z.string().min(4).max(300),
      options: z.array(z.string().min(1).max(120)).min(2).max(8),
      wake: z.boolean().optional(),
    }),
    run: (agent, input) =>
      startVote(agent, { roomId: input.room_id, question: input.question, options: input.options, wake: input.wake }),
  }),
  defineTool({
    name: "cast_vote",
    title: "Cast a vote",
    description: "Vote on an open vote by option text or 1-based number, with a one-line reason. Voting again replaces your ballot.",
    schema: z.object({ vote_id: uuid, option: z.string().min(1), reason: z.string().max(500).optional() }),
    run: (agent, input) => castVote(agent, { voteId: input.vote_id, option: input.option, reason: input.reason }),
  }),
  defineTool({
    name: "get_vote",
    title: "Vote results",
    description: "Current ballots and the leading option for a vote.",
    schema: z.object({ vote_id: uuid }),
    readOnly: true,
    run: (agent, input) => getVote(agent, { voteId: input.vote_id }),
  }),
  defineTool({
    name: "wait_for_activity",
    title: "Wait for activity",
    description:
      "Long-poll for mentions, assigned tasks, or direct messages. Blocks until activity arrives or timeout occurs. Ideal for background loops.",
    schema: z.object({
      timeout_ms: z.number().int().min(1000).max(60000).optional().describe("Timeout in milliseconds (1000-60000, default 30000)"),
    }),
    readOnly: true,
    scope: "room:read",
    run: (agent, input) => waitForActivity(agent, { timeoutSeconds: Math.round((input.timeout_ms ?? 30000) / 1000) }),
  }),
  defineTool({
    name: "get_task_brief",
    title: "Get task brief",
    description: "Get full task brief including parent context, subtasks, notes, and blocker details.",
    schema: z.object({
      task_id: uuid.describe("Task ID"),
    }),
    readOnly: true,
    scope: "tasks:read",
    run: async (_agent, input) => {
      const brief = await loadTaskBriefContext(input.task_id)
      if (!brief) throw new CollabError("task not found")
      return { task_id: input.task_id, brief }
    },
  }),
  defineTool({
    name: "plan_task",
    title: "Plan subtasks",
    description: "Break down a task into subtasks with dependencies and optional assignees.",
    schema: z.object({
      task_id: uuid.describe("Parent task ID"),
      subtasks: z
        .array(
          z.object({
            key: z.string().min(1).max(32).describe("Subtask key (e.g. step1)"),
            title: z.string().min(2).max(120),
            description: z.string().max(4000).optional(),
            assignee_handle: z.string().optional().describe("Teammate handle to assign, e.g. @coder"),
            depends_on: z.array(z.string()).optional().describe("Array of keys this subtask depends on"),
          }),
        )
        .min(1)
        .max(20),
    }),
    scope: "tasks:write",
    run: (agent, input) =>
      planTask(agent, {
        taskId: input.task_id,
        subtasks: input.subtasks.map((s) => ({
          key: s.key,
          title: s.title,
          description: s.description,
          assigneeHandle: s.assignee_handle,
          dependsOn: s.depends_on,
        })),
      }),
  }),
  defineTool({
    name: "assign_task",
    title: "Assign task",
    description: "Assign an open or owned task to a teammate bot or human.",
    schema: z.object({
      task_id: uuid.describe("Task ID"),
      assignee_handle: z.string().min(1).describe("Assignee handle, e.g. @reviewer"),
    }),
    scope: "tasks:write",
    run: (agent, input) =>
      assignTask(agent, {
        taskId: input.task_id,
        assignee: input.assignee_handle,
      }),
  }),
  defineTool({
    name: "canvas_read",
    title: "Read canvas",
    description: "Read the current text content and metadata of a room's canvas document.",
    schema: z.object({
      canvas_id: uuid.describe("Canvas ID"),
      room_id: z.string().optional(),
    }),
    readOnly: true,
    scope: "canvas:read",
    run: async (agent, input) => {
      const roomId = await resolveAgentRoomId(agent, input.room_id)
      const canvas = await loadCanvas(input.canvas_id)
      if (!canvas || canvas.roomId !== roomId) throw new CollabError("canvas not found in this room")
      return { canvasId: canvas.id, title: canvas.title, content: canvas.snapshotText, updatedAt: canvas.updatedAt }
    },
  }),
  defineTool({
    name: "canvas_patch",
    title: "Patch canvas",
    description: "Apply search/replace edits to a room canvas with conflict-free Yjs splices.",
    schema: z.object({
      canvas_id: uuid.describe("Canvas ID"),
      room_id: z.string().optional(),
      edits: z.array(z.object({ search: z.string().min(1), replace: z.string() })).min(1).max(50),
    }),
    scope: "canvas:write",
    run: async (agent, input) => {
      const roomId = await resolveAgentRoomId(agent, input.room_id)
      const canvas = await loadCanvas(input.canvas_id)
      if (!canvas || canvas.roomId !== roomId) throw new CollabError("canvas not found in this room")
      const connection = await getHocuspocus().openDirectConnection(input.canvas_id, {
        agentId: agent.agentId,
      })
      try {
        let newText = ""
        await connection.transact((doc) => {
          const text = doc.getText("content")
          const plan = planCanvasPatch(text.toString(), input.edits)
          for (const splice of plan.splices) {
            text.delete(splice.from, splice.to - splice.from)
            if (splice.insert) text.insert(splice.from, splice.insert)
          }
          newText = text.toString()
        })
        if (connection.document) await persistCanvasState(input.canvas_id, connection.document, newText)
        await getDb()
          .insert(canvasVersions)
          .values({ canvasId: input.canvas_id, authorType: "agent", authorId: agent.agentId, snapshotText: newText })
        return { ok: true, canvasId: input.canvas_id, edits: input.edits.length, characters: newText.length }
      } finally {
        await connection.disconnect()
      }
    },
  }),
  defineTool({
    name: "use_secret",
    title: "Use secret",
    description:
      "Execute an HTTPS request using a granted secret token without exposing the secret to the model. URL host must match the secret grant's allowlist.",
    schema: z.object({
      env_name: z.string().min(1).max(64).describe("Environment variable name of the granted secret, e.g. STRIPE_API_KEY"),
      url: z.string().url().describe("Target HTTPS URL"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    }),
    scope: "secrets:use",
    run: async (agent, input) => {
      const tool = useSecretTool({ agentId: agent.agentId, orgId: agent.orgId })
      return tool.execute({
        envName: input.env_name,
        request: {
          method: input.method,
          url: input.url,
          headers: input.headers,
          body: input.body,
        },
      })
    },
  }),
]

const toolsByName = new Map(MCP_TOOLS.map((t) => [t.name, t]))

export function listTools() {
  return MCP_TOOLS.map((t) => {
    const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(t.schema, { io: "input" }) as Record<
      string,
      unknown
    >
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: { type: "object", ...inputSchema },
      annotations: { title: t.title, readOnlyHint: Boolean(t.readOnly), openWorldHint: false },
    }
  })
}

interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

type RpcResponse = { jsonrpc: "2.0"; id: string | number | null } & (
  | { result: unknown }
  | { error: { code: number; message: string } }
)

function rpcError(id: JsonRpcMessage["id"], code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }
}

async function callTool(agent: CollabAgent, params: Record<string, unknown> | undefined) {
  const name = typeof params?.name === "string" ? params.name : ""
  const tool = toolsByName.get(name)
  if (!tool) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true }

  if (tool.scope && agent.scopes && agent.scopes.length > 0) {
    const hasScope = agent.scopes.includes(tool.scope) || agent.scopes.includes("*")
    if (!hasScope) {
      return {
        content: [{ type: "text", text: `Permission denied: token missing required scope '${tool.scope}'` }],
        isError: true,
      }
    }
  }

  const parsed = tool.schema.safeParse(params?.arguments ?? {})
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")
    return { content: [{ type: "text", text: `Invalid arguments: ${issues}` }], isError: true }
  }
  try {
    const result = await tool.run(agent, parsed.data)
    const text = redactSecrets(JSON.stringify(result, null, 2) ?? "null").text
    return {
      content: [{ type: "text", text }],
      ...(result && typeof result === "object" && !Array.isArray(result) ? { structuredContent: result } : {}),
    }
  } catch (error) {
    const message =
      error instanceof CollabError
        ? error.message
        : (console.error(`[mcp] tool ${name} failed`, error), "internal error running the tool")
    return { content: [{ type: "text", text: message }], isError: true }
  }
}

async function handle(identity: BotIdentity, msg: JsonRpcMessage): Promise<RpcResponse | null> {
  const isNotification = msg.id === undefined
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return isNotification ? null : rpcError(msg.id, -32600, "invalid request")
  }
  if (isNotification) return null
  const agent: CollabAgent = {
    agentId: identity.agentId,
    orgId: identity.orgId,
    handle: identity.agent.handle,
    roomIds: identity.roomIds,
    scopes: identity.scopes,
  }
  switch (msg.method) {
    case "initialize": {
      const requested = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : ""
      return {
        jsonrpc: "2.0",
        id: msg.id ?? null,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: `${INSTRUCTIONS}\n\nYou are @${identity.agent.handle} (${identity.agent.displayName}).`,
        },
      }
    }
    case "ping":
      return { jsonrpc: "2.0", id: msg.id ?? null, result: {} }
    case "tools/list":
      return { jsonrpc: "2.0", id: msg.id ?? null, result: { tools: listTools() } }
    case "tools/call":
      return { jsonrpc: "2.0", id: msg.id ?? null, result: await callTool(agent, msg.params) }
    case "resources/list":
      return { jsonrpc: "2.0", id: msg.id ?? null, result: { resources: [] } }
    case "prompts/list":
      return { jsonrpc: "2.0", id: msg.id ?? null, result: { prompts: [] } }
    default:
      return rpcError(msg.id, -32601, `method not found: ${msg.method}`)
  }
}

async function serve(c: Context, token: string | undefined) {
  const identity = await authenticateAgentKey(token ? `Bearer ${token}` : c.req.header("authorization"))
  if (!identity) {
    return c.json(rpcError(null, -32001, "invalid or revoked Sayabot agent key"), 401, {
      "www-authenticate": 'Bearer realm="sayabot"',
    })
  }
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(rpcError(null, -32700, "parse error"), 400)
  }
  const batch = Array.isArray(body)
  const items = (batch ? body : [body]) as JsonRpcMessage[]
  const responses = (await Promise.all(items.map((m) => handle(identity, m)))).filter(
    (r): r is RpcResponse => r !== null,
  )
  if (responses.length === 0) return c.body(null, 202)
  return c.json(batch ? responses : responses[0])
}

async function renderInstructions(c: Context, token: string | undefined) {
  const identity = await authenticateAgentKey(token ? `Bearer ${token}` : c.req.header("authorization"))
  if (!identity) {
    return c.text(
      "Saaya setup error: Invalid, revoked, or missing agent key.\n\nPlease copy the complete connection link or generate a new key in Saaya Settings -> Bots.",
      401,
      { "content-type": "text/plain; charset=utf-8" },
    )
  }

  const db = getDb()
  const agentRoomList = await agentRooms({
    agentId: identity.agentId,
    orgId: identity.orgId,
    handle: identity.agent.handle,
  })

  const reqRoom = c.req.query("room")
  let targetRoom = agentRoomList[0]
  if (reqRoom) {
    const found = agentRoomList.find((r) => r.id === reqRoom || r.name.toLowerCase() === reqRoom.toLowerCase())
    if (found) targetRoom = found
  }

  let roomName = targetRoom?.name || "Saaya Workspace"
  const roomId = targetRoom?.id || ""
  let roomDirective = targetRoom?.directive || ""
  let roomOwnerName = "Room Owner"
  let timezone = "Asia/Calcutta"

  if (targetRoom) {
    const [fullRoom] = await db
      .select({
        name: rooms.name,
        timezone: rooms.timezone,
        directive: rooms.systemDirective,
        createdBy: rooms.createdBy,
      })
      .from(rooms)
      .where(eq(rooms.id, targetRoom.id))
      .limit(1)

    if (fullRoom) {
      if (fullRoom.name) roomName = fullRoom.name
      if (fullRoom.timezone) timezone = fullRoom.timezone
      if (fullRoom.directive) roomDirective = fullRoom.directive
      if (fullRoom.createdBy) {
        const [ownerProfile] = await db
          .select({ displayName: profiles.displayName })
          .from(profiles)
          .where(eq(profiles.id, fullRoom.createdBy))
          .limit(1)
        if (ownerProfile?.displayName) {
          roomOwnerName = ownerProfile.displayName
        }
      }
    }
  }

  const proto = c.req.header("x-forwarded-proto") || "http"
  const host = c.req.header("x-forwarded-host") || c.req.header("host") || "localhost:3000"
  const rawToken = token || ""
  const connectionUrl = `${proto}://${host}/mcp/${rawToken}`

  const client = c.req.query("client") || ""

  const instructions = generateSetupInstructions({
    handle: identity.agent.handle,
    displayName: identity.agent.displayName,
    roomName,
    roomId,
    roomOwnerName,
    timezone,
    directive: roomDirective,
    token: rawToken,
    connectionUrl,
    client,
  })

  return c.text(instructions, 200, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  })
}

export const mcpRoutes = new Hono()

// GET returns human- and bot-readable setup instructions in markdown (parity with Jinxo).
// When an agent (Codex, Hermes, etc.) fetches the link, it reads the guide and joins the room.
mcpRoutes.get("/v1/mcp", (c) => renderInstructions(c, undefined))
mcpRoutes.get("/v1/mcp/:token", (c) => renderInstructions(c, c.req.param("token")))

// POST serves standard MCP JSON-RPC Streamable HTTP requests.
mcpRoutes.post("/v1/mcp", (c) => serve(c, undefined))
mcpRoutes.post("/v1/mcp/:token", (c) => serve(c, c.req.param("token")))

for (const path of ["/v1/mcp", "/v1/mcp/:token"]) {
  mcpRoutes.delete(path, (c) => c.body(null, 405, { allow: "GET, POST" }))
}
