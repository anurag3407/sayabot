export type ConnectorSource =
  | "google_drive"
  | "slack"
  | "github"
  | "jira"
  | "discord"
  | "telegram"
  | "whatsapp"

/** Sources with native tools in the orchestrator. Jira is reached through the Atlassian app. */
export const NATIVE_CONNECTOR_SOURCES: ConnectorSource[] = [
  "google_drive",
  "slack",
  "github",
  "discord",
  "telegram",
  "whatsapp",
]

export interface ConnectorDoc {
  id: string
  source: ConnectorSource
  title: string
  content: string
  url: string
  metadata: {
    author?: string
    lastModified?: string
    mimeType?: string
    folderId?: string
    channelId?: string
    channelName?: string
    threadTs?: string
    repo?: string
    path?: string
    issueNumber?: number
    labels?: string[]
    [key: string]: unknown
  }
}

export interface ConnectorSearchOptions {
  query: string
  limit?: number
  allowedFolders?: string[]
  allowedChannels?: string[]
  allowedRepos?: string[]
}

export interface ConnectorScopeConfig {
  allowedFolders?: string[]
  /** Slack/Discord channel IDs or Telegram chat IDs this agent may read and post to. */
  allowedChannels?: string[]
  allowedRepos?: string[]
  /** WhatsApp numbers (country code first) this agent may message. */
  allowedRecipients?: string[]
  /** No send tools at all, even with approval. */
  readOnly?: boolean
}
