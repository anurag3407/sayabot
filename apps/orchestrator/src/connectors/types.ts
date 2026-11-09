export type ConnectorSource = "google_drive" | "slack" | "github" | "jira"

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
  allowedChannels?: string[]
  allowedRepos?: string[]
  readOnly?: boolean
}
