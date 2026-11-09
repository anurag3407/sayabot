import { parseCapabilities } from "@sayabot/core"
import { agentConnectorGrants, agents, mcpServers, workspaceConnectors } from "@sayabot/db"
import { connectMcpServers, openSecret } from "@sayabot/llm"
import type { ToolSet } from "ai"
import { and, eq, isNull, or } from "drizzle-orm"
import { z } from "zod"
import { canvasPatchTool, canvasReadTool, canvasWriteTool } from "../canvas/tools"
import type { ConnectorSource } from "../connectors/types"
import { getDb } from "../db"
import { getEnv } from "../env"
import { RunEvidence, type VerificationEvidence } from "../engine/evidence"
import { updatePlanTool } from "../engine/plan-tool"
import { skillTools } from "../engine/skills"
import { spawnSubagentTool, subagentStatusTool } from "../engine/subagents"
import { partitionToolsForSearch } from "../engine/tool-search"
import { memoryTools } from "../memory/tools"
import { toAuditedTools, type ToolRuntime, type ToolSpec } from "./audited"
import { computerTools } from "./builtins/computer"
import { connectorTools } from "./builtins/connectors"
import { cronjobTool } from "./builtins/cronjob"
import { githubTool } from "./builtins/github"
import { postgresInspectorTool } from "./builtins/postgres"
import { sandboxTool } from "./builtins/sandbox"
import { taskTools } from "./builtins/tasks"
import { useSecretTool } from "./builtins/use-secret"
import { webSearchTool } from "./builtins/web-search"
import { webFetchTool } from "./builtins/web-fetch"
import { verificationTools } from "./builtins/verification"
import { workspaceTools } from "./builtins/workspace"

export interface BuildToolsArgs {
  roomId: string
  orgId: string
  agent: typeof agents.$inferSelect
  runtime: ToolRuntime
}

export interface BuiltTools {
  tools: ToolSet
  /** Every spec behind `tools`, for building scoped tool sets (subagents, critic). */
  specs: ToolSpec[]
  /** Tool names to expose on the next step; undefined means all of them. */
  activeToolNames: () => string[] | undefined
  warnings: string[]
  verification: () => VerificationEvidence
  close: () => Promise<void>
}

async function loadMcpConfigs(args: BuildToolsArgs) {
  const rows = await getDb()
    .select()
    .from(mcpServers)
    .where(
      and(
        eq(mcpServers.orgId, args.orgId),
        eq(mcpServers.enabled, true),
        or(isNull(mcpServers.roomId), eq(mcpServers.roomId, args.roomId)),
      ),
    )
  const allowList = args.agent.toolIds
  const filtered = allowList.length ? rows.filter((row) => allowList.includes(row.id)) : rows
  const warnings: string[] = []
  const configs = filtered.map((row) => {
    let headers: Record<string, string> | undefined
    if (row.headersEnc) {
      try {
        const parsed = JSON.parse(openSecret(row.headersEnc, getEnv().MESH_KEK)) as {
          headers?: Record<string, string>
        }
        headers = parsed.headers
      } catch {
        warnings.push(`MCP server "${row.name}" has unreadable headers; connecting without them`)
      }
    }
    return {
      id: row.id,
      name: row.name,
      transport: row.transport,
      url: row.url,
      headers,
      dangerousTools: row.dangerousTools,
    }
  })
  return { configs, warnings }
}

/**
 * Built-in tools plus every enabled MCP server for the room/org. MCP servers
 * that fail to connect are skipped and reported instead of failing the run.
 */
export async function buildTools(args: BuildToolsArgs): Promise<BuiltTools> {
  const warnings: string[] = []
  const caps = parseCapabilities(args.agent.capabilities)
  const isV2 = ((args.agent.params as Record<string, unknown> | null)?.engine ?? "v2") === "v2"
  const evidence = new RunEvidence()
  // Filled in once every spec is known; subagents read it at call time.
  let allSpecs: ToolSpec[] = []

  let connectorSpecs: ToolSpec[] = []
  if (caps.connectors) {
    try {
      const grants = await getDb()
        .select({
          source: workspaceConnectors.source,
        })
        .from(agentConnectorGrants)
        .innerJoin(workspaceConnectors, eq(agentConnectorGrants.connectorId, workspaceConnectors.id))
        .where(
          and(
            eq(agentConnectorGrants.orgId, args.orgId),
            eq(agentConnectorGrants.agentId, args.agent.id),
            eq(workspaceConnectors.status, "active"),
          ),
        )

      const sources = [...new Set(grants.map((g) => g.source as ConnectorSource))]
      if (sources.length > 0) {
        connectorSpecs = connectorTools({
          orgId: args.orgId,
          agentId: args.agent.id,
          roomId: args.roomId,
          sources,
        })
      }
    } catch {
      // Connectors table or db read fallback
    }
  }

  const specs: ToolSpec[] = [
    ...connectorSpecs,
    ...(caps.canvas
      ? [
          canvasReadTool({ roomId: args.roomId, agentId: args.agent.id }),
          canvasWriteTool({ roomId: args.roomId, agentId: args.agent.id }),
          canvasPatchTool({ roomId: args.roomId, agentId: args.agent.id }),
        ]
      : []),
    ...(caps.sandbox && !caps.computer ? [sandboxTool()] : []),
    ...(caps.webSearch
      ? [
          webSearchTool({ orgId: args.orgId, agentId: args.agent.id }),
          webFetchTool({ orgId: args.orgId, agentId: args.agent.id }),
        ]
      : []),
    ...(caps.github ? [githubTool(args.orgId, args.agent.id)] : []),
    ...(caps.postgres ? [postgresInspectorTool(args.orgId, args.agent.id)] : []),
    ...(caps.tasks
      ? taskTools({
          roomId: args.roomId,
          orgId: args.orgId,
          agentId: args.agent.id,
          handle: args.agent.handle,
        })
      : []),
    ...(caps.computer
      ? computerTools({
          agentId: args.agent.id,
          orgId: args.orgId,
          roomId: args.roomId,
          profile: caps.computer.profile,
        })
      : []),
    ...(caps.computer && isV2
      ? [
          ...verificationTools({ agentId: args.agent.id, orgId: args.orgId, profile: caps.computer.profile }),
          ...workspaceTools({ agentId: args.agent.id, orgId: args.orgId, roomId: args.roomId, profile: caps.computer.profile }),
        ]
      : []),
    ...(caps.secrets ? [useSecretTool({ agentId: args.agent.id, orgId: args.orgId })] : []),
    ...(caps.memory
      ? memoryTools({
          orgId: args.orgId,
          agentId: args.agent.id,
          roomId: args.roomId,
        })
      : []),
    ...(caps.cron
      ? [
          cronjobTool({
            orgId: args.orgId,
            agentId: args.agent.id,
            roomId: args.roomId,
          }),
        ]
      : []),
    ...(isV2 && args.runtime.runId
      ? [
          updatePlanTool({ runId: args.runtime.runId, roomId: args.roomId }),
          ...skillTools({ orgId: args.orgId, agentId: args.agent.id }),
        ]
      : []),
    ...(isV2 &&
    caps.subagents &&
    args.runtime.runId
      ? [
          spawnSubagentTool({
            parentRunId: args.runtime.runId,
            roomId: args.roomId,
            orgId: args.orgId,
            agent: args.agent,
            getAvailableToolSpecs: () => allSpecs,
            scrub: args.runtime.scrub,
          }),
          subagentStatusTool(),
        ]
      : []),
  ]

  const extraSpecs: ToolSpec[] = []
  let closeMcp = async () => {}
  if (caps.mcp) {
    const { configs, warnings: configWarnings } = await loadMcpConfigs(args)
    warnings.push(...configWarnings)

    const mcp = await connectMcpServers(configs)
    closeMcp = mcp.close
    warnings.push(...mcp.errors.map((e) => `MCP server "${e.serverName}" unavailable: ${e.message}`))

    for (const [name, definition] of Object.entries(mcp.tools)) {
      if (specs.some((s) => s.name === name)) {
        warnings.push(`Skipped MCP tool ${name}: a built-in tool already uses that name`)
        continue
      }
      const meta = mcp.meta[name]
      if (!meta) continue
      extraSpecs.push({
        name,
        description:
          ((definition as { description?: string }).description ?? "") ||
          `MCP tool ${meta.originalName} from ${meta.serverName}`,
        schema: (definition as { inputSchema?: z.ZodType }).inputSchema ?? z.record(z.string(), z.unknown()),
        // Server hints may add an approval gate, never remove one.
        dangerous: meta.dangerous || meta.annotations?.destructiveHint === true,
        execute: async (input: Record<string, unknown>, signal?: AbortSignal) => {
          if (signal?.aborted) throw new Error("run aborted")
          return mcp.call(meta.serverId, meta.originalName, input)
        },
      })
    }
  }

  allSpecs = [...specs, ...extraSpecs].sort((a, b) => a.name.localeCompare(b.name)).map((spec) => evidence.wrap(spec))
  const partition = isV2 ? partitionToolsForSearch(allSpecs) : undefined
  const registered = partition ? partition.all : allSpecs
  const tools = toAuditedTools(registered, args.runtime)

  return {
    tools,
    specs: registered,
    activeToolNames: partition ? partition.activeToolNames : () => undefined,
    warnings,
    verification: () => evidence.snapshot(),
    close: closeMcp,
  }
}
