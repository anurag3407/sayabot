import { z } from "zod"
import {
  configureWorkspace,
  decideApproval,
  delegateTask,
  listApprovals,
  listErrors,
  listModels,
  manageRoutines,
  removeBotFromRoom,
  retryRun,
} from "../../orchestrator-admin/control"
import {
  addBotToRoom,
  configSnapshot,
  createBot,
  createRoom,
  listBots,
  listRooms,
  updateBot,
  usageSummary,
} from "../../orchestrator-admin/service"
import type { ToolSpec } from "../audited"

/**
 * Saya's workspace-admin tools. Gated by the `orchestrator` capability, so no ordinary bot can
 * ever assemble them. Every mutation is marked `dangerous`, which routes it through the normal
 * human approval gate in `toAuditedTools`; reads are safe.
 *
 * The same specs feed the MCP surface (`mcp/admin-tools.ts`), so the chat tools and the CLI/MCP
 * tools are one implementation.
 */

export interface OrchestratorToolOptions {
  orgId: string
  /** The acting agent row, recorded on the audit trail. */
  agentId?: string
  /** The room the turn is running in, used as the member template for new rooms. */
  roomId?: string
}

const handle = z
  .string()
  .min(2)
  .max(32)
  .describe("Lowercase handle without the @, e.g. `scout`. Letters, numbers, _ and - only.")
const capabilityToggles = z
  .record(z.string(), z.boolean())
  .optional()
  .describe(
    "Capability toggles, e.g. { webSearch: false, sandbox: true }. The orchestrator flag cannot be granted.",
  )

export function orchestratorTools(opts: OrchestratorToolOptions): ToolSpec[] {
  const actor = { orgId: opts.orgId, agentId: opts.agentId ?? null }

  return [
    {
      name: "sayabot_bots",
      description:
        "List every bot in this workspace with its handle, model, and which capabilities are on. Use it before creating or changing a bot.",
      schema: z.object({}),
      dangerous: false,
      execute: async () => ({ bots: await listBots(actor) }),
    },
    {
      name: "sayabot_create_bot",
      description:
        "Create a bot in this workspace. First call sayabot_models and ask the admin which model to use. Pass only an id they chose. Do not invent one, and do not create the bot until they answer.",
      schema: z.object({
        handle,
        display_name: z.string().min(1).max(60),
        instructions: z
          .string()
          .max(20_000)
          .optional()
          .describe("The bot's system prompt: who it is and how it should work."),
        model: z
          .string()
          .max(120)
          .optional()
          .describe(
            "Model id the admin chose. Omit this to be told to ask them. Never invent an id.",
          ),
        capabilities: capabilityToggles,
      }),
      dangerous: true,
      execute: async (input: {
        handle: string
        display_name: string
        instructions?: string
        model?: string
        capabilities?: Record<string, boolean>
      }) =>
        await createBot(actor, {
          handle: input.handle,
          displayName: input.display_name,
          instructions: input.instructions,
          model: input.model,
          capabilities: input.capabilities,
        }),
    },
    {
      name: "sayabot_update_bot",
      description:
        "Change a bot's display name, instructions, model, or capability toggles. Identify it by handle or id. Cannot grant the orchestrator capability.",
      schema: z.object({
        handle: handle.optional(),
        agent_id: z.string().uuid().optional(),
        display_name: z.string().min(1).max(60).optional(),
        instructions: z.string().max(20_000).optional(),
        model: z.string().max(120).nullable().optional(),
        capabilities: capabilityToggles,
      }),
      dangerous: true,
      execute: async (input: {
        handle?: string
        agent_id?: string
        display_name?: string
        instructions?: string
        model?: string | null
        capabilities?: Record<string, boolean>
      }) => {
        if (!input.handle && !input.agent_id) {
          throw new Error("Pass the bot's handle or agent_id")
        }
        return await updateBot(actor, {
          handle: input.handle,
          agentId: input.agent_id,
          displayName: input.display_name,
          instructions: input.instructions,
          model: input.model,
          capabilities: input.capabilities,
        })
      },
    },
    {
      name: "sayabot_rooms",
      description:
        "List this workspace's rooms with their kind, timezone, turn mode and bot count. Use it before creating a room or adding a bot to one.",
      schema: z.object({}),
      dangerous: false,
      execute: async () => ({ rooms: await listRooms(actor) }),
    },
    {
      name: "sayabot_create_room",
      description:
        "Create a room. People from the current room are copied in so the new chat is visible; the orchestrator joins it too. Add bots afterwards with sayabot_add_bot_to_room.",
      schema: z.object({
        name: z.string().min(1).max(60),
        kind: z.enum(["public", "private", "dm"]).optional(),
        timezone: z.string().max(64).optional().describe("IANA timezone, e.g. Europe/Berlin."),
        member_room_id: z
          .string()
          .uuid()
          .optional()
          .describe("Room whose people should be copied in. Defaults to the current room."),
      }),
      dangerous: true,
      execute: async (input: {
        name: string
        kind?: "public" | "private" | "dm"
        timezone?: string
        member_room_id?: string
      }) =>
        await createRoom(actor, {
          name: input.name,
          kind: input.kind,
          timezone: input.timezone,
          memberRoomId: input.member_room_id ?? opts.roomId,
        }),
    },
    {
      name: "sayabot_add_bot_to_room",
      description: "Add an existing bot to a room so it can take turns there.",
      schema: z.object({
        room_id: z.string().uuid(),
        handle: handle.optional(),
        agent_id: z.string().uuid().optional(),
      }),
      dangerous: true,
      execute: async (input: { room_id: string; handle?: string; agent_id?: string }) => {
        if (!input.handle && !input.agent_id) {
          throw new Error("Pass the bot's handle or agent_id")
        }
        return await addBotToRoom(actor, {
          roomId: input.room_id,
          handle: input.handle,
          agentId: input.agent_id,
        })
      },
    },
    {
      name: "sayabot_usage",
      description:
        "This calendar month's usage for the workspace: turns, input/output tokens, cost in USD, and the same per bot. Check it before recommending heavy automations.",
      schema: z.object({}),
      dangerous: false,
      execute: async () => await usageSummary(actor),
    },
    {
      name: "sayabot_config",
      description:
        "Read the resolved workspace configuration: plan, counts, provider labels (never keys), connectors, MCP server status, desktop computers, and whether a Boat, VPS or E2B computer is configured.",
      schema: z.object({}),
      dangerous: false,
      execute: async () => await configSnapshot(actor),
    },
    {
      name: "sayabot_models",
      description:
        "Models this workspace can assign. Lists up to 25 models per saved provider, plus the model each bot already uses. No keys.",
      schema: z.object({}),
      dangerous: false,
      execute: async () => await listModels(actor),
    },
    {
      name: "sayabot_configure",
      description:
        "Change workspace configuration. target room: name, timezone, system_directive, turn_mode, execution_mode (review_all or ask_risky only). target bot: display name, instructions, model, capabilities. Cannot rewrite Saya's instructions, grant orchestrator, or set auto/turbo.",
      schema: z.object({
        target: z.enum(["room", "bot"]),
        room_id: z.string().uuid().optional(),
        room: z.string().max(60).optional().describe("Room name, when room_id is omitted."),
        handle: handle.optional(),
        agent_id: z.string().uuid().optional(),
        name: z.string().min(1).max(60).optional(),
        timezone: z.string().max(64).optional(),
        system_directive: z.string().max(4_000).nullable().optional(),
        turn_mode: z.enum(["mentions", "debate", "moderated"]).optional(),
        execution_mode: z.enum(["review_all", "ask_risky", "auto", "turbo"]).optional(),
        display_name: z.string().min(1).max(60).optional(),
        instructions: z.string().max(20_000).optional(),
        model: z.string().max(120).nullable().optional(),
        capabilities: capabilityToggles,
      }),
      dangerous: true,
      execute: async (input: {
        target: "room" | "bot"
        room_id?: string
        room?: string
        handle?: string
        agent_id?: string
        name?: string
        timezone?: string
        system_directive?: string | null
        turn_mode?: string
        execution_mode?: string
        display_name?: string
        instructions?: string
        model?: string | null
        capabilities?: Record<string, boolean>
      }) =>
        await configureWorkspace(actor, {
          target: input.target,
          roomId: input.room_id ?? (input.target === "room" ? opts.roomId : undefined),
          room: input.room,
          handle: input.handle,
          agentId: input.agent_id,
          name: input.name,
          timezone: input.timezone,
          systemDirective: input.system_directive,
          turnMode: input.turn_mode,
          executionMode: input.execution_mode,
          displayName: input.display_name,
          instructions: input.instructions,
          model: input.model,
          capabilities: input.capabilities,
        }),
    },
    {
      name: "sayabot_delegate",
      description:
        "Give a task to another bot and wake them. The bot is added to the room if they are not already in it. Do not delegate to yourself.",
      schema: z.object({
        title: z.string().min(1).max(200),
        instructions: z.string().max(4_000).optional(),
        handle: handle.optional(),
        agent_id: z.string().uuid().optional(),
        room_id: z.string().uuid().optional(),
        room: z.string().max(60).optional(),
      }),
      dangerous: true,
      execute: async (input: {
        title: string
        instructions?: string
        handle?: string
        agent_id?: string
        room_id?: string
        room?: string
      }) =>
        await delegateTask(actor, {
          title: input.title,
          instructions: input.instructions,
          handle: input.handle,
          agentId: input.agent_id,
          roomId: input.room_id ?? opts.roomId,
          room: input.room,
        }),
    },
    {
      name: "sayabot_remove_bot_from_room",
      description: "Remove a bot from a room. The bot itself is kept.",
      schema: z.object({
        room_id: z.string().uuid(),
        handle: handle.optional(),
        agent_id: z.string().uuid().optional(),
      }),
      dangerous: true,
      execute: async (input: { room_id: string; handle?: string; agent_id?: string }) =>
        await removeBotFromRoom(actor, {
          roomId: input.room_id,
          handle: input.handle,
          agentId: input.agent_id,
        }),
    },
    {
      name: "sayabot_approvals",
      description:
        "Pending commands waiting for a person. Args are redacted. self is true when the command is yours: you cannot decide those.",
      schema: z.object({}),
      dangerous: false,
      execute: async () => ({ approvals: await listApprovals(actor) }),
    },
    {
      name: "sayabot_decide",
      description:
        "Approve or reject another bot's pending command. Put what it does in summary. You cannot approve your own command, use_secret, or sayabot_decide. In a room, approving waits for the owner. An MCP client with the orchestrator scope is that owner.",
      schema: z.object({
        tool_call_id: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
        summary: z
          .string()
          .min(8)
          .max(280)
          .describe("What the command does, so the approval card and the audit say it plainly."),
      }),
      dangerous: (args) => args.decision === "approve",
      execute: async (input: {
        tool_call_id: string
        decision: "approve" | "reject"
        summary: string
      }) =>
        await decideApproval(actor, {
          toolCallId: input.tool_call_id,
          decision: input.decision,
          summary: input.summary,
        }),
    },
    {
      name: "sayabot_errors",
      description:
        "Recent failed turns and failed tool calls in this workspace. Errors are redacted.",
      schema: z.object({}),
      dangerous: false,
      execute: async () => await listErrors(actor),
    },
    {
      name: "sayabot_retry",
      description:
        "Run a failed turn's message again. The coordinator locks the room when the new turn starts.",
      schema: z.object({ run_id: z.string().uuid() }),
      dangerous: true,
      execute: async (input: { run_id: string }) => await retryRun(actor, input.run_id),
    },
    {
      name: "sayabot_routines",
      description:
        "Schedules for this workspace. action list is a read. create, pause, resume, and remove change a routine. create needs a name, a schedule (cron or 'daily at 9am'), a prompt, and a bot handle.",
      schema: z.object({
        action: z.enum(["list", "create", "pause", "resume", "remove"]),
        id: z.string().uuid().optional(),
        name: z.string().max(80).optional(),
        schedule: z.string().max(80).optional(),
        prompt: z.string().max(8_000).optional(),
        timezone: z.string().max(64).optional(),
        handle: handle.optional(),
        agent_id: z.string().uuid().optional(),
        room_id: z.string().uuid().optional(),
        room: z.string().max(60).optional(),
      }),
      dangerous: (args) => args.action !== "list",
      execute: async (input: {
        action: "list" | "create" | "pause" | "resume" | "remove"
        id?: string
        name?: string
        schedule?: string
        prompt?: string
        timezone?: string
        handle?: string
        agent_id?: string
        room_id?: string
        room?: string
      }) =>
        await manageRoutines(actor, {
          action: input.action,
          id: input.id,
          name: input.name,
          schedule: input.schedule,
          prompt: input.prompt,
          timezone: input.timezone,
          handle: input.handle,
          agentId: input.agent_id,
          roomId: input.room_id,
          room: input.room,
        }),
    },
  ]
}
