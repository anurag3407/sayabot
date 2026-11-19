export type ConnectorSource =
  | "google_drive"
  | "slack"
  | "github"
  | "jira"
  | "discord"
  | "telegram"
  | "whatsapp"
  | "onepassword"
  | "bitwarden"
  | "protonpass"
  | "supabase"
  | "cloudflare_r2"
  | "backblaze_b2"
  | "s3_storage"
  | "huggingface"

/** Sources with native tools in the orchestrator. Jira is reached through the Atlassian app. */
export const NATIVE_CONNECTOR_SOURCES: ConnectorSource[] = [
  "google_drive",
  "slack",
  "github",
  "discord",
  "telegram",
  "whatsapp",
  "onepassword",
  "bitwarden",
  "protonpass",
  "supabase",
  "cloudflare_r2",
  "backblaze_b2",
  "s3_storage",
  "huggingface",
]

export const STORAGE_CONNECTOR_SOURCES: ConnectorSource[] = [
  "supabase",
  "cloudflare_r2",
  "backblaze_b2",
  "s3_storage",
  "huggingface",
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
  /** Password-manager vault names or ids this agent may read. */
  allowedVaults?: string[]
  /** Cloud storage bucket prefix/folder path this agent is restricted to, e.g. "reports/" or "agent-data/". */
  allowedPrefixes?: string[]
  /** No send tools at all, even with approval. */
  readOnly?: boolean
}
