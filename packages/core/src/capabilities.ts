import { z } from "zod"

export interface AgentCapabilities {
  canvas: boolean
  tasks: boolean
  sandbox: boolean
  webSearch: boolean
  github: boolean
  postgres: boolean
  mcp: boolean
  computer: false | { profile: "standard" | "browser" }
  secrets: boolean
  memory: boolean
  subagents: boolean
  cron: boolean
}

export const DEFAULT_CAPABILITIES: AgentCapabilities = {
  canvas: true,
  tasks: true,
  sandbox: true,
  webSearch: true,
  github: true,
  postgres: true,
  mcp: true,
  computer: false,
  secrets: false,
  memory: true,
  subagents: true,
  cron: true,
}

export const agentCapabilitiesSchema = z.object({
  canvas: z.boolean().default(true),
  tasks: z.boolean().default(true),
  sandbox: z.boolean().default(true),
  webSearch: z.boolean().default(true),
  github: z.boolean().default(true),
  postgres: z.boolean().default(true),
  mcp: z.boolean().default(true),
  computer: z
    .union([
      z.literal(false),
      z.object({
        profile: z.enum(["standard", "browser"]),
      }),
    ])
    .default(false),
  secrets: z.boolean().default(false),
  memory: z.boolean().default(true),
  subagents: z.boolean().default(true),
  cron: z.boolean().default(true),
})

/**
 * Safely parse capabilities with fallback to default values for missing or invalid fields.
 */
export function parseCapabilities(input: unknown): AgentCapabilities {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_CAPABILITIES }
  }

  const raw = input as Record<string, unknown>
  const result: AgentCapabilities = {
    canvas: typeof raw.canvas === "boolean" ? raw.canvas : DEFAULT_CAPABILITIES.canvas,
    tasks: typeof raw.tasks === "boolean" ? raw.tasks : DEFAULT_CAPABILITIES.tasks,
    sandbox: typeof raw.sandbox === "boolean" ? raw.sandbox : DEFAULT_CAPABILITIES.sandbox,
    webSearch: typeof raw.webSearch === "boolean" ? raw.webSearch : DEFAULT_CAPABILITIES.webSearch,
    github: typeof raw.github === "boolean" ? raw.github : DEFAULT_CAPABILITIES.github,
    postgres: typeof raw.postgres === "boolean" ? raw.postgres : DEFAULT_CAPABILITIES.postgres,
    mcp: typeof raw.mcp === "boolean" ? raw.mcp : DEFAULT_CAPABILITIES.mcp,
    computer: false,
    secrets: typeof raw.secrets === "boolean" ? raw.secrets : DEFAULT_CAPABILITIES.secrets,
    memory: typeof raw.memory === "boolean" ? raw.memory : DEFAULT_CAPABILITIES.memory,
    subagents: typeof raw.subagents === "boolean" ? raw.subagents : DEFAULT_CAPABILITIES.subagents,
    cron: typeof raw.cron === "boolean" ? raw.cron : DEFAULT_CAPABILITIES.cron,
  }

  if (raw.computer && typeof raw.computer === "object") {
    const comp = raw.computer as Record<string, unknown>
    if (comp.profile === "standard" || comp.profile === "browser") {
      result.computer = { profile: comp.profile }
    }
  }

  return result
}
