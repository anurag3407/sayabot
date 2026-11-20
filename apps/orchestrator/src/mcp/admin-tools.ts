import { z } from "zod"
import { orchestratorTools } from "../tools/builtins/orchestrator"

/**
 * Saya's workspace-admin tools, projected onto the MCP surface. Derived from the audited tool
 * specs so the two surfaces cannot drift. MCP has no inline approval prompt, so these tools also
 * require the `orchestrator` token scope: an owner has to mint the key deliberately, and the
 * agent must still hold the `orchestrator` capability.
 */

export interface OrchestratorMcpTool {
  name: string
  title: string
  description: string
  schema: z.ZodType
  readOnly?: boolean
  scope?: string
  run: (agent: unknown, input: unknown) => Promise<unknown>
}

export interface OrchestratorMcpContext {
  orgId: string
  agentId: string
  roomId?: string
}

export function orchestratorMcpTools(ctx: OrchestratorMcpContext): OrchestratorMcpTool[] {
  return orchestratorTools(ctx).map((spec) => ({
    name: spec.name,
    title: spec.name.replace(/^sayabot_/, "").replace(/_/g, " "),
    description: spec.description,
    schema: spec.schema,
    readOnly: spec.dangerous === false,
    scope: "orchestrator",
    run: async (_agent: unknown, input: unknown) => await spec.execute(input),
  }))
}
