import { z } from "zod"
import { getConnectorService } from "../../connectors/service"
import { CloudStorageClient } from "../../connectors/storage"
import { STORAGE_CONNECTOR_SOURCES, type ConnectorSource } from "../../connectors/types"
import type { ToolSpec } from "../audited"

export interface StorageToolsOptions {
  orgId: string
  agentId: string
  roomId: string
  preferredProvider?: string
}

export async function storageTools(opts: StorageToolsOptions): Promise<ToolSpec[]> {
  const service = getConnectorService()
  const { orgId, agentId, preferredProvider } = opts

  // The agent's granted storage connector wins; otherwise the workspace's first active one.
  const preferred =
    preferredProvider &&
    preferredProvider !== "default" &&
    STORAGE_CONNECTOR_SOURCES.includes(preferredProvider as ConnectorSource)
      ? preferredProvider
      : undefined

  const target = await service.getStorageTarget({ orgId, agentId, preferredProvider: preferred })
  if (!target) {
    return []
  }
  const activeSource = target.connector.source as ConnectorSource

  const client = new CloudStorageClient({
    source: activeSource,
    token: target.token,
    config: (target.connector.config ?? {}) as Record<string, unknown>,
    baseUrl:
      typeof service.endpointFor === "function" ? service.endpointFor(activeSource) : undefined,
  })

  // Scope is read from the grant of the connector actually in use.
  let scopeConfig: { allowedPrefixes?: string[]; readOnly?: boolean } = {}
  if (target.granted) {
    try {
      scopeConfig = (await service.getAgentScope(agentId, target.connector.id)) as {
        allowedPrefixes?: string[]
        readOnly?: boolean
      }
    } catch {
      // The grant vanished between lookup and read: fall back to unscoped workspace access.
    }
  }

  function validatePathPrefix(filePath: string) {
    if (!scopeConfig.allowedPrefixes || scopeConfig.allowedPrefixes.length === 0) return
    const clean = filePath.replace(/^\/+/, "")
    const allowed = scopeConfig.allowedPrefixes.some((p) => clean.startsWith(p.replace(/^\/+/, "")))
    if (!allowed) {
      throw new Error(
        `Access denied: path '${filePath}' is outside this agent's allowed storage prefixes (${scopeConfig.allowedPrefixes.join(", ")})`,
      )
    }
  }

  const listFilesTool: ToolSpec = {
    name: "storage_list_files",
    description: `List files and artifacts in ${activeSource} cloud storage (${client.getBucketName()}).`,
    schema: z.object({
      prefix: z
        .string()
        .optional()
        .default("")
        .describe("Optional folder/prefix path to list, e.g. 'reports/' or 'artifacts/'"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(30)
        .describe("Maximum number of files to return"),
    }),
    dangerous: false,
    execute: async (input: { prefix?: string; limit?: number }) => {
      const files = await client.listFiles(input.prefix || "", input.limit)
      return {
        provider: activeSource,
        bucket: client.getBucketName(),
        count: files.length,
        files,
      }
    },
  }

  const readFileTool: ToolSpec = {
    name: "storage_read_file",
    description: `Read text content and metadata of a file stored in ${activeSource} cloud storage.`,
    schema: z.object({
      path: z
        .string()
        .min(1)
        .describe("Path or key of the file in cloud storage, e.g. 'reports/summary.md'"),
    }),
    dangerous: false,
    execute: async (input: { path: string }) => {
      validatePathPrefix(input.path)
      const res = await client.readFile(input.path)
      return {
        path: input.path,
        provider: activeSource,
        contentType: res.contentType,
        content: res.content,
      }
    },
  }

  const uploadFileTool: ToolSpec = {
    name: "storage_upload_file",
    description: `Upload text, code, JSON, or report files to ${activeSource} cloud storage.`,
    schema: z.object({
      path: z
        .string()
        .min(1)
        .describe("Destination path/key in cloud storage, e.g. 'reports/analysis.json'"),
      content: z.string().describe("The file text or content to save"),
      contentType: z
        .string()
        .optional()
        .default("text/plain")
        .describe("MIME type, e.g. 'application/json' or 'text/markdown'"),
    }),
    // A write the whole workspace (and anything reading the bucket) can see, same as delete.
    dangerous: true,
    execute: async (input: { path: string; content: string; contentType?: string }) => {
      if (scopeConfig.readOnly) {
        throw new Error("Access denied: this agent has read-only storage permissions")
      }
      validatePathPrefix(input.path)
      const res = await client.uploadFile(input.path, input.content, input.contentType)
      return {
        ok: true,
        path: res.path,
        provider: activeSource,
        bucket: client.getBucketName(),
      }
    },
  }

  const deleteFileTool: ToolSpec = {
    name: "storage_delete_file",
    description: `Permanently delete a file from ${activeSource} cloud storage. Always requires operator approval.`,
    schema: z.object({
      path: z.string().min(1).describe("Path of the file to permanently delete"),
    }),
    // Follows Rule 4 in AGENTS.md: Destructive mutations MUST be dangerous: true
    dangerous: true,
    execute: async (input: { path: string }) => {
      if (scopeConfig.readOnly) {
        throw new Error("Access denied: this agent has read-only storage permissions")
      }
      validatePathPrefix(input.path)
      const res = await client.deleteFile(input.path)
      return {
        ok: true,
        deleted: res.path,
        provider: activeSource,
      }
    },
  }

  return [listFilesTool, readFileTool, uploadFileTool, deleteFileTool]
}
