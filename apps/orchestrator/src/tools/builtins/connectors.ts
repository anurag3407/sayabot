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

  const slackSendTool: ToolSpec = {
    name: "slack_send_message",
    description:
      "Post a message to a Slack channel (or reply in a thread) as the workspace bot. Waits for a person's OK.",
    schema: z.object({
      channel: z.string().min(1).describe("Channel ID (C123…) or name without #"),
      text: z.string().min(1).max(40_000).describe("Message text (Slack mrkdwn)"),
      thread_ts: z.string().optional().describe("Parent message ts to reply in its thread"),
    }),
    dangerous: true,
    execute: async (input: { channel: string; text: string; thread_ts?: string }) => {
      const sent = await service.postSlackMessage({
        agentId,
        orgId,
        channel: input.channel,
        text: input.text,
        threadTs: input.thread_ts,
      })
      return { ok: true, channel: sent.channel, ts: sent.ts }
    },
  }

  const discordListChannelsTool: ToolSpec = {
    name: "discord_list_channels",
    description:
      "List the Discord text channels this agent may use. With no server set up, lists the servers the bot is in.",
    schema: z.object({
      guild_id: z.string().optional().describe("Discord server ID; defaults to the one set on the connector"),
    }),
    dangerous: false,
    execute: async (input: { guild_id?: string }) =>
      service.listDiscordChannels({ agentId, orgId, guildId: input.guild_id }),
  }

  const discordReadTool: ToolSpec = {
    name: "discord_read_messages",
    description: "Read the latest messages in a Discord channel, newest first.",
    schema: z.object({
      channel_id: z.string().min(1).describe("Discord channel ID"),
      limit: z.number().int().min(1).max(100).optional().default(25),
    }),
    dangerous: false,
    execute: async (input: { channel_id: string; limit?: number }) => {
      const messages = await service.readDiscordMessages({
        agentId,
        orgId,
        channelId: input.channel_id,
        limit: input.limit,
      })
      return { channel_id: input.channel_id, count: messages.length, messages }
    },
  }

  const discordSendTool: ToolSpec = {
    name: "discord_send_message",
    description: "Post a message in a Discord channel as the bot. Waits for a person's OK.",
    schema: z.object({
      channel_id: z.string().min(1).describe("Discord channel ID"),
      content: z.string().min(1).max(2000).describe("Message text (Discord markdown, up to 2000 characters)"),
    }),
    dangerous: true,
    execute: async (input: { channel_id: string; content: string }) => {
      const sent = await service.sendDiscordMessage({
        agentId,
        orgId,
        channelId: input.channel_id,
        content: input.content,
      })
      return { ok: true, ...sent }
    },
  }

  const telegramReadTool: ToolSpec = {
    name: "telegram_read_messages",
    description:
      "Read messages people sent the Telegram bot in the last 24 hours, with each chat's ID for replying.",
    schema: z.object({
      limit: z.number().int().min(1).max(100).optional().default(25),
    }),
    dangerous: false,
    execute: async (input: { limit?: number }) => {
      const messages = await service.readTelegramMessages({ agentId, orgId, limit: input.limit })
      return { count: messages.length, messages }
    },
  }

  const telegramSendTool: ToolSpec = {
    name: "telegram_send_message",
    description:
      "Send a Telegram message from the bot to a chat that has talked to it (or a channel it admins). Waits for a person's OK.",
    schema: z.object({
      chat_id: z.string().min(1).describe("Numeric chat ID from telegram_read_messages, or @channelname"),
      text: z.string().min(1).max(4096),
    }),
    dangerous: true,
    execute: async (input: { chat_id: string; text: string }) => {
      const sent = await service.sendTelegramMessage({ agentId, orgId, chatId: input.chat_id, text: input.text })
      return { ok: true, message_id: sent.id }
    },
  }

  const whatsappSendTool: ToolSpec = {
    name: "whatsapp_send_message",
    description:
      "Send a WhatsApp text from the business number. Works only within 24 hours of the person's last message; otherwise use whatsapp_send_template. Waits for a person's OK.",
    schema: z.object({
      to: z.string().min(7).describe("Phone number with country code, like +14155550123"),
      text: z.string().min(1).max(4096),
    }),
    dangerous: true,
    execute: async (input: { to: string; text: string }) => {
      const sent = await service.sendWhatsAppText({ agentId, orgId, to: input.to, text: input.text })
      return { ok: true, message_id: sent.id }
    },
  }

  const whatsappTemplateTool: ToolSpec = {
    name: "whatsapp_send_template",
    description:
      "Send an approved WhatsApp message template (needed to start a conversation). Waits for a person's OK.",
    schema: z.object({
      to: z.string().min(7).describe("Phone number with country code"),
      template: z.string().min(1).describe("Template name as approved in WhatsApp Manager, e.g. hello_world"),
      language: z.string().min(2).max(10).optional().default("en_US"),
    }),
    dangerous: true,
    execute: async (input: { to: string; template: string; language?: string }) => {
      const sent = await service.sendWhatsAppTemplate({
        agentId,
        orgId,
        to: input.to,
        template: input.template,
        language: input.language ?? "en_US",
      })
      return { ok: true, message_id: sent.id }
    },
  }

  const tools: ToolSpec[] = []
  const sources = opts.sources ?? ["google_drive", "slack", "github"]
  if (sources.includes("google_drive")) {
    tools.push(gdriveSearchTool, gdriveReadFileTool)
  }
  if (sources.includes("slack")) {
    tools.push(slackSearchTool, slackReadThreadTool, slackSendTool)
  }
  if (sources.includes("github")) {
    tools.push(githubSearchCodeTool, githubGetFileTool, githubGetIssueOrPrTool)
  }
  for (const source of ["onepassword", "bitwarden", "protonpass"] as const) {
    if (!sources.includes(source)) continue
    const label = source === "onepassword" ? "1Password" : source === "bitwarden" ? "Bitwarden" : "Proton Pass"
    tools.push(
      {
        name: `${source}_search`,
        description: `Find ${label} items by name. Returns titles and ids only, never the secret.`,
        schema: z.object({
          query: z.string().min(1).max(200),
          vault: z.string().max(80).optional().describe("Vault name or id, when the agent is limited to some vaults"),
        }),
        dangerous: false,
        execute: async (input: { query: string; vault?: string }) =>
          service.queryPassword({ agentId, orgId, source, action: "search", query: input.query, vault: input.vault }),
      },
      {
        name: `${source}_read`,
        description: `Read one ${label} item, including its password. Waits for a person's OK.`,
        schema: z.object({
          query: z.string().min(1).max(200).describe("Item id or exact name from search"),
          vault: z.string().max(80).optional(),
        }),
        dangerous: true,
        execute: async (input: { query: string; vault?: string }, signal?: AbortSignal) =>
          service.queryPassword({ agentId, orgId, source, action: "read", query: input.query, vault: input.vault, signal }),
      },
    )
  }
  if (sources.includes("discord")) {
    tools.push(discordListChannelsTool, discordReadTool, discordSendTool)
  }
  if (sources.includes("telegram")) {
    tools.push(telegramReadTool, telegramSendTool)
  }
  if (sources.includes("whatsapp")) {
    tools.push(whatsappSendTool, whatsappTemplateTool)
  }

  return tools
}
