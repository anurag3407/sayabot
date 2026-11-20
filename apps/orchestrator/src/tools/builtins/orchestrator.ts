import { z } from "zod"
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
        "Create a bot in this workspace: a handle, a display name, optional standing instructions, and optional capability toggles. The bot runs on the workspace's default model unless you pass one.",
      schema: z.object({
        handle,
        display_name: z.string().min(1).max(60),
        instructions: z
          .string()
          .max(20_000)
          .optional()
          .describe("The bot's system prompt: who it is and how it should work."),
        model: z.string().max(120).optional().describe("Model id, e.g. anthropic/claude-sonnet-4."),
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
        "Read the resolved workspace configuration: plan, bot/room/MCP/provider counts, provider labels (never keys), MCP server status, and whether a Boat, VPS or E2B computer is configured.",
      schema: z.object({}),
      dangerous: false,
      execute: async () => await configSnapshot(actor),
    },
  ]
}
