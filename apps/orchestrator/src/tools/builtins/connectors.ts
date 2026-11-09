import { z } from "zod"
import type { ConnectorSource } from "../../connectors/types"
import { getConnectorService } from "../../connectors/service"
import type { ToolSpec } from "../audited"

export interface ConnectorToolsOptions {
  orgId: string
  agentId: string
  roomId: string
  sources?: ConnectorSource[]
}

export function connectorTools(opts: ConnectorToolsOptions): ToolSpec[] {
  const service = getConnectorService()
  const { orgId, agentId } = opts

  const gdriveSearchTool: ToolSpec = {
    name: "gdrive_search",
    description:
      "Search Google Drive files, spreadsheets, and meeting notes scoped to this agent's allowed folders.",
    schema: z.object({
      query: z.string().min(1).describe("Search keywords or document title"),
      limit: z.number().int().min(1).max(20).optional().default(8),
    }),
    dangerous: false,
    execute: async (input: { query: string; limit?: number }) => {
      const files = await service.searchGoogleDrive({
        agentId,
        orgId,
        query: input.query,
        limit: input.limit,
      })

      return {
        query: input.query,
        count: files.length,
        files: files.map((f) => ({
          id: f.id,
          title: f.title,
          url: f.url,
          mime_type: f.metadata.mimeType,
          last_modified: f.metadata.lastModified,
          author: f.metadata.author,
        })),
      }
    },
  }

  const gdriveReadFileTool: ToolSpec = {
    name: "gdrive_read_file",
    description:
      "Read full text and data content from a Google Drive document, spreadsheet (CSV), or presentation.",
    schema: z.object({
      file_id: z.string().min(1).describe("Google Drive file ID from search results"),
    }),
    dangerous: false,
    execute: async (input: { file_id: string }) => {
      const doc = await service.readGoogleDriveFile({
        agentId,
        orgId,
        fileId: input.file_id,
      })

      return {
        id: doc.id,
        title: doc.title,
        url: doc.url,
        content: doc.content,
        metadata: doc.metadata,
      }
    },
  }

  const slackSearchTool: ToolSpec = {
    name: "slack_search",
    description:
      "Search team messages, updates, and discussions across allowed Slack channels.",
    schema: z.object({
      query: z.string().min(1).describe("Search terms or topic"),
      limit: z.number().int().min(1).max(20).optional().default(10),
    }),
    dangerous: false,
    execute: async (input: { query: string; limit?: number }) => {
      const messages = await service.searchSlack({
        agentId,
        orgId,
        query: input.query,
        limit: input.limit,
      })

      return {
        query: input.query,
        count: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          title: m.title,
          url: m.url,
          content: m.content,
          channel: m.metadata.channelName,
          author: m.metadata.author,
          thread_ts: m.metadata.threadTs,
        })),
      }
    },
  }

  const slackReadThreadTool: ToolSpec = {
    name: "slack_read_thread",
    description:
      "Read all replies and full discussion in a Slack message thread with participant names.",
    schema: z.object({
      channel_id: z.string().min(1).describe("Slack channel ID (e.g. C123456)"),
      thread_ts: z.string().min(1).describe("Thread parent timestamp (ts)"),
    }),
    dangerous: false,
    execute: async (input: { channel_id: string; thread_ts: string }) => {
      const thread = await service.readSlackThread({
        agentId,
        orgId,
        channelId: input.channel_id,
        threadTs: input.thread_ts,
      })

      return {
        id: thread.id,
        title: thread.title,
        url: thread.url,
        discussion: thread.content,
        reply_count: thread.metadata.replyCount,
      }
    },
  }

  const githubSearchCodeTool: ToolSpec = {
    name: "github_search_code",
    description:
      "Search source code and files across this agent's allowed GitHub repositories.",
    schema: z.object({
      query: z.string().min(1).describe("Code search query or symbol name"),
      limit: z.number().int().min(1).max(20).optional().default(10),
    }),
    dangerous: false,
    execute: async (input: { query: string; limit?: number }) => {
      const files = await service.searchGitHubCode({
        agentId,
        orgId,
        query: input.query,
        limit: input.limit,
      })

      return {
        query: input.query,
        count: files.length,
        items: files.map((f) => ({
          id: f.id,
          title: f.title,
          url: f.url,
          repo: f.metadata.repo,
          path: f.metadata.path,
        })),
      }
    },
  }

  const githubGetFileTool: ToolSpec = {
    name: "github_get_file",
    description: "Read file contents from an allowed GitHub repository.",
    schema: z.object({
      repo: z.string().min(1).describe("Repository in 'owner/name' format"),
      path: z.string().min(1).describe("File path relative to repository root"),
      ref: z.string().optional().default("main").describe("Branch, tag, or commit SHA"),
    }),
    dangerous: false,
    execute: async (input: { repo: string; path: string; ref?: string }) => {
      const file = await service.getGitHubFile({
        agentId,
        orgId,
        repo: input.repo,
        path: input.path,
        ref: input.ref,
      })

      return {
        title: file.title,
        url: file.url,
        content: file.content,
        metadata: file.metadata,
      }
    },
  }

  const githubGetIssueOrPrTool: ToolSpec = {
    name: "github_get_issue_or_pr",
    description:
      "Fetch a GitHub Issue or Pull Request description, status, review comments, and discussion.",
    schema: z.object({
      repo: z.string().min(1).describe("Repository in 'owner/name' format"),
      issue_number: z.number().int().positive().describe("Issue or PR number"),
    }),
    dangerous: false,
    execute: async (input: { repo: string; issue_number: number }) => {
      const issue = await service.getGitHubIssueOrPr({
        agentId,
        orgId,
        repo: input.repo,
        issueNumber: input.issue_number,
      })

      return {
        id: issue.id,
        title: issue.title,
        url: issue.url,
        content: issue.content,
        metadata: issue.metadata,
      }
    },
  }

  const tools: ToolSpec[] = []
  const sources = opts.sources ?? ["google_drive", "slack", "github"]
  if (sources.includes("google_drive")) {
    tools.push(gdriveSearchTool, gdriveReadFileTool)
  }
  if (sources.includes("slack")) {
    tools.push(slackSearchTool, slackReadThreadTool)
  }
  if (sources.includes("github")) {
    tools.push(githubSearchCodeTool, githubGetFileTool, githubGetIssueOrPrTool)
  }

  return tools
}
