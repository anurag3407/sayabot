import {
  isWorksOn,
  rememberSelectedDesktop,
  resolveComputer,
  type ComputerAvailability,
  type ComputerDecision,
  type WorksOn,
} from "@sayabot/core"
import { z } from "zod"
import type { ToolSpec } from "../audited"

export interface SelectComputerOptions {
  /** The bot's Works on setting. Auto until the person picks one. */
  worksOn: WorksOn
  available: ComputerAvailability
  /** Shared with the other computer tools for this turn. */
  params?: Record<string, unknown> | null
  /**
   * Carries out wake or provision. Auto never reaches this for a sleeping or missing Boat.
   * The agent process is unchanged; this only opens the desktop.
   */
  apply?: (decision: ComputerDecision) => Promise<Record<string, unknown>>
}

/**
 * The bot asks to move this turn onto a desktop. Auto does not create or wake a Boat by itself;
 * this tool is how it does.
 */
export function selectComputerTool(opts: SelectComputerOptions): ToolSpec {
  return {
    name: "select_computer",
    description:
      "Choose the desktop for this turn: this_computer, local_vm, boat, vps, or e2b. Auto only reuses a desktop that is already running. Calling this with boat wakes or creates one; with vps it starts this bot's container on the person's server; with e2b it creates or resumes this bot's E2B cloud sandbox. The agent keeps running where it already runs; this only moves its screen and shell.",
    schema: z.object({
      surface: z.enum(["this_computer", "local_vm", "boat", "vps", "e2b"]),
    }),
    dangerous: false,
    execute: async (input: { surface: WorksOn }) => {
      const surface = isWorksOn(input.surface) ? input.surface : "off"
      const decision = resolveComputer(opts.worksOn, opts.available, surface)
      const carried =
        (decision.surface === "boat" ||
          decision.surface === "vps" ||
          decision.surface === "e2b" ||
          decision.surface === "local_vm") &&
        decision.action !== "none"
          ? await opts.apply?.(decision)
          : undefined
      if (opts.params && carried)
        rememberSelectedDesktop(opts.available, opts.params, decision, carried)
      return {
        ok: decision.action !== "none" && carried?.ok !== false,
        surface: decision.surface,
        action: decision.action,
        ...(decision.reason ? { reason: decision.reason } : {}),
        ...(carried ?? {}),
      }
    },
  }
}
