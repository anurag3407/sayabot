import {
  getNextCronRun,
  humanReadableCron,
  isValidCron,
  normalizeCronExpression,
} from "@sayabot/core"
import { agents, routines } from "@sayabot/db"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "../../db"
import { runRoutineNow } from "../../scheduler/routines"
import type { ToolSpec } from "../audited"

export interface CronjobToolOptions {
  orgId: string
  agentId: string
  roomId: string
}

const cronjobInputSchema = z.object({
  action: z
    .enum(["create", "list", "update", "pause", "resume", "run", "remove"])
    .describe("The action to perform on scheduled cron routines."),
  id: z
    .string()
    .optional()
    .describe("Routine ID required for update, pause, resume, run, or remove actions."),
  name: z
    .string()
    .optional()
    .describe("Human-readable title/name of the routine (e.g. 'Daily Standup Summary', 'Hourly Monitor')."),
  schedule: z
    .string()
    .optional()
    .describe(
      "Cron expression (e.g. '0 9 * * 1-5', '*/15 * * * *') or shorthand ('daily at 9am', 'every 2h', 'weekdays at 10:00').",
    ),
  prompt: z
    .string()
    .optional()
    .describe("The exact task instructions to provide to the agent when triggered."),
  description: z.string().optional().describe("Optional description of the routine's purpose."),
  timezone: z
    .string()
    .optional()
    .describe("Timezone for scheduling (e.g. 'UTC', 'America/New_York', 'Asia/Kolkata'). Defaults to 'UTC'."),
  targetRoomId: z
    .string()
    .optional()
    .describe("Room ID to post the routine results to. Defaults to current room."),
  targetAgentId: z
    .string()
    .optional()
    .describe("Agent ID that should execute the routine. Defaults to current agent."),
})

export function cronjobTool(options: CronjobToolOptions): ToolSpec {
  return {
    name: "cronjob",
    description:
      "Manage autonomous scheduled routines and cron jobs (Hermes-compatible). Actions: create, list, update, pause, resume, run, remove. Allows scheduling agents to execute recurring tasks.",
    schema: cronjobInputSchema,
    dangerous: false,
    execute: async (rawArgs: z.infer<typeof cronjobInputSchema>) => {
      const db = getDb()
      const args = cronjobInputSchema.parse(rawArgs)

      switch (args.action) {
        case "create": {
          if (!args.name) {
            return { error: "Missing required 'name' for creating a routine" }
          }
          if (!args.schedule) {
            return { error: "Missing required 'schedule' (cron expression or shorthand like 'daily at 9am')" }
          }
          if (!args.prompt) {
            return { error: "Missing required 'prompt' instructions for the agent" }
          }

          const normExpr = normalizeCronExpression(args.schedule)
          if (!isValidCron(normExpr)) {
            return {
              error: `Invalid cron schedule '${args.schedule}'. Use standard 5-part cron (e.g. '0 9 * * 1-5') or natural shorthand ('daily at 9am', 'every 30m').`,
            }
          }

          const tz = args.timezone || "UTC"
          const now = new Date()
          const nextRun = getNextCronRun(normExpr, now, tz)
          const targetRoom = args.targetRoomId || options.roomId
          const targetAgent = args.targetAgentId || options.agentId

          const [created] = await db
            .insert(routines)
            .values({
              orgId: options.orgId,
              roomId: targetRoom,
              agentId: targetAgent,
              name: args.name,
              description: args.description ?? null,
              scheduleExpr: normExpr,
              scheduleKind: "cron",
              timezone: tz,
              prompt: args.prompt,
              enabled: true,
              nextRunAt: nextRun,
              createdByAgentId: options.agentId,
            })
            .returning()

          return {
            success: true,
            routine: {
              id: created?.id,
              name: created?.name,
              schedule: created?.scheduleExpr,
              humanSchedule: humanReadableCron(normExpr),
              timezone: created?.timezone,
              nextRunAt: created?.nextRunAt?.toISOString(),
              prompt: created?.prompt,
            },
          }
        }

        case "list": {
          const list = await db
            .select({
              id: routines.id,
              name: routines.name,
              description: routines.description,
              scheduleExpr: routines.scheduleExpr,
              timezone: routines.timezone,
              enabled: routines.enabled,
              nextRunAt: routines.nextRunAt,
              lastRunAt: routines.lastRunAt,
              lastStatus: routines.lastStatus,
              runCount: routines.runCount,
              agentId: routines.agentId,
              roomId: routines.roomId,
            })
            .from(routines)
            .where(eq(routines.orgId, options.orgId))
            .orderBy(desc(routines.createdAt))
            .limit(50)

          return {
            routines: list.map((r) => ({
              ...r,
              humanSchedule: humanReadableCron(r.scheduleExpr),
              nextRunAt: r.nextRunAt?.toISOString() ?? null,
              lastRunAt: r.lastRunAt?.toISOString() ?? null,
            })),
          }
        }

        case "update": {
          if (!args.id) return { error: "Missing required 'id' for update action" }

          const [existing] = await db
            .select()
            .from(routines)
            .where(and(eq(routines.id, args.id), eq(routines.orgId, options.orgId)))
            .limit(1)

          if (!existing) return { error: `Routine ${args.id} not found` }

          const updateData: Partial<typeof routines.$inferInsert> = {
            updatedAt: new Date(),
          }

          if (args.name !== undefined) updateData.name = args.name
          if (args.description !== undefined) updateData.description = args.description
          if (args.prompt !== undefined) updateData.prompt = args.prompt
          if (args.timezone !== undefined) updateData.timezone = args.timezone

          let newExpr = existing.scheduleExpr
          if (args.schedule) {
            const norm = normalizeCronExpression(args.schedule)
            if (!isValidCron(norm)) {
              return { error: `Invalid cron schedule '${args.schedule}'` }
            }
            newExpr = norm
            updateData.scheduleExpr = norm
          }

          if (args.schedule || args.timezone) {
            const tz = updateData.timezone ?? existing.timezone
            updateData.nextRunAt = getNextCronRun(newExpr, new Date(), tz)
          }

          const [updated] = await db
            .update(routines)
            .set(updateData)
            .where(eq(routines.id, args.id))
            .returning()

          return {
            success: true,
            routine: {
              id: updated?.id,
              name: updated?.name,
              schedule: updated?.scheduleExpr,
              humanSchedule: humanReadableCron(updated?.scheduleExpr ?? ""),
              nextRunAt: updated?.nextRunAt?.toISOString(),
            },
          }
        }

        case "pause": {
          if (!args.id) return { error: "Missing required 'id' for pause action" }

          const [paused] = await db
            .update(routines)
            .set({ enabled: false, updatedAt: new Date() })
            .where(and(eq(routines.id, args.id), eq(routines.orgId, options.orgId)))
            .returning({ id: routines.id, name: routines.name, enabled: routines.enabled })

          if (!paused) return { error: `Routine ${args.id} not found` }
          return { success: true, message: `Routine '${paused.name}' paused.` }
        }

        case "resume": {
          if (!args.id) return { error: "Missing required 'id' for resume action" }

          const [routine] = await db
            .select()
            .from(routines)
            .where(and(eq(routines.id, args.id), eq(routines.orgId, options.orgId)))
            .limit(1)

          if (!routine) return { error: `Routine ${args.id} not found` }

          const nextRun = getNextCronRun(routine.scheduleExpr, new Date(), routine.timezone)

          const [resumed] = await db
            .update(routines)
            .set({ enabled: true, nextRunAt: nextRun, updatedAt: new Date() })
            .where(eq(routines.id, args.id))
            .returning({ id: routines.id, name: routines.name, enabled: routines.enabled })

          return {
            success: true,
            message: `Routine '${resumed?.name}' resumed. Next run at ${nextRun?.toISOString()}`,
          }
        }

        case "run": {
          if (!args.id) return { error: "Missing required 'id' for run action" }
          const res = await runRoutineNow(args.id)
          return res
        }

        case "remove": {
          if (!args.id) return { error: "Missing required 'id' for remove action" }
          const [removed] = await db
            .delete(routines)
            .where(and(eq(routines.id, args.id), eq(routines.orgId, options.orgId)))
            .returning({ id: routines.id, name: routines.name })

          if (!removed) return { error: `Routine ${args.id} not found` }
          return { success: true, message: `Routine '${removed.name}' removed.` }
        }

        default:
          return { error: `Unsupported action '${(args as any).action}'` }
      }
    },
  }
}
