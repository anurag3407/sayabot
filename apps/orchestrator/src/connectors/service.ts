import { and, eq } from "drizzle-orm"
import { decryptSecret } from "@sayabot/llm"
import {
  agentConnectorGrants,
  workspaceConnectors,
  type AgentConnectorGrantRow,
  type WorkspaceConnectorRow,
} from "@sayabot/db"
import { getDb } from "../db"
import { getEnv } from "../env"
import { GitHubConnector } from "./github"
import { GoogleDriveConnector } from "./google-drive"
import { SlackConnector } from "./slack"
import type { ConnectorDoc, ConnectorScopeConfig, ConnectorSource } from "./types"

export interface ConnectorServiceOptions {
  db?: any
  fetchFn?: typeof fetch
  kek?: string
}

export class ConnectorService {
  private db: any
  private fetchFn?: typeof fetch
  private kek?: string

  constructor(opts?: ConnectorServiceOptions) {
    this.db = opts?.db ?? getDb()
    this.fetchFn = opts?.fetchFn
    this.kek = opts?.kek
  }

  /**
   * Resolves a workspace connector and decrypts its credentials using KEK envelope encryption.
   */
  async getDecryptedConnector(
    orgId: string,
    source: ConnectorSource,
  ): Promise<{ connector: WorkspaceConnectorRow; token: string }> {
    const [connector] = await this.db
      .select()
      .from(workspaceConnectors)
      .where(and(eq(workspaceConnectors.orgId, orgId), eq(workspaceConnectors.source, source)))
      .limit(1)

    if (!connector) {
      throw new Error(`No connector configured for '${source}' in this workspace.`)
    }

    if (connector.status !== "active") {
      throw new Error(`Connector '${connector.name}' is currently ${connector.status}.`)
    }

    const kek = this.kek ?? getEnv().MESH_KEK
    const token = decryptSecret(
      {
        ciphertext: connector.ciphertext,
        iv: connector.iv,
        tag: connector.tag,
      },
      kek,
    )

    return { connector, token }
  }

  /**
   * Validates whether an agent has been granted access to this connector and retrieves its allowed scope.
   */
  async getAgentScope(agentId: string, connectorId: string): Promise<ConnectorScopeConfig> {
    const [grant] = await this.db
      .select()
      .from(agentConnectorGrants)
      .where(
        and(
          eq(agentConnectorGrants.agentId, agentId),
          eq(agentConnectorGrants.connectorId, connectorId),
        ),
      )
      .limit(1)

    if (!grant) {
      throw new Error("Access Denied: This agent is not granted access to this connector.")
    }

    return (grant.scopeConfig ?? {}) as ConnectorScopeConfig
  }

  // ── Google Drive Actions ──────────────────────────────────────────────────

  async searchGoogleDrive(args: {
    agentId: string
    orgId: string
    query: string
    limit?: number
  }): Promise<ConnectorDoc[]> {
    const { connector, token } = await this.getDecryptedConnector(args.orgId, "google_drive")
    const scope = await this.getAgentScope(args.agentId, connector.id)

    const client = new GoogleDriveConnector({ accessToken: token, fetchFn: this.fetchFn })
    return client.searchFiles({
      query: args.query,
      limit: args.limit,
      allowedFolders: scope.allowedFolders,
    })
  }

  async readGoogleDriveFile(args: {
    agentId: string
    orgId: string
    fileId: string
  }): Promise<ConnectorDoc> {
    const { connector, token } = await this.getDecryptedConnector(args.orgId, "google_drive")
    await this.getAgentScope(args.agentId, connector.id)

    const client = new GoogleDriveConnector({ accessToken: token, fetchFn: this.fetchFn })
    return client.readFile(args.fileId)
  }

  // ── Slack Actions ─────────────────────────────────────────────────────────

  async searchSlack(args: {
    agentId: string
    orgId: string
    query: string
    limit?: number
    channel?: string
  }): Promise<ConnectorDoc[]> {
    const { connector, token } = await this.getDecryptedConnector(args.orgId, "slack")
    const scope = await this.getAgentScope(args.agentId, connector.id)

    if (args.channel && scope.allowedChannels && scope.allowedChannels.length > 0) {
      const clean = args.channel.replace(/^#/, "")
      if (!scope.allowedChannels.includes(clean)) {
        throw new Error(
          `Channel '${args.channel}' is outside this agent's allowed channels (${scope.allowedChannels.join(", ")})`,
        )
      }
    }

    const client = new SlackConnector({ botToken: token, fetchFn: this.fetchFn })
    return client.searchMessages({
      query: args.query,
      limit: args.limit,
      allowedChannels: args.channel ? [args.channel.replace(/^#/, "")] : scope.allowedChannels,
    })
  }

  async readSlackThread(args: {
    agentId: string
    orgId: string
    channelId: string
    threadTs: string
  }): Promise<ConnectorDoc> {
    const { connector, token } = await this.getDecryptedConnector(args.orgId, "slack")
    const scope = await this.getAgentScope(args.agentId, connector.id)

    if (scope.allowedChannels && scope.allowedChannels.length > 0) {
      if (!scope.allowedChannels.includes(args.channelId)) {
        throw new Error(`Access Denied: Agent is not granted access to channel ${args.channelId}`)
      }
    }

    const client = new SlackConnector({ botToken: token, fetchFn: this.fetchFn })
    return client.readThread(args.channelId, args.threadTs)
  }

  // ── GitHub Actions ────────────────────────────────────────────────────────

  async searchGitHubCode(args: {
    agentId: string
    orgId: string
    query: string
    limit?: number
  }): Promise<ConnectorDoc[]> {
    const { connector, token } = await this.getDecryptedConnector(args.orgId, "github")
    const scope = await this.getAgentScope(args.agentId, connector.id)

    const client = new GitHubConnector({ token, fetchFn: this.fetchFn })
    return client.searchCode({
      query: args.query,
      limit: args.limit,
      allowedRepos: scope.allowedRepos,
    })
  }

  async getGitHubFile(args: {
    agentId: string
    orgId: string
    repo: string
    path: string
    ref?: string
  }): Promise<ConnectorDoc> {
    const { connector, token } = await this.getDecryptedConnector(args.orgId, "github")
    const scope = await this.getAgentScope(args.agentId, connector.id)

    if (scope.allowedRepos && scope.allowedRepos.length > 0) {
      if (!scope.allowedRepos.includes(args.repo)) {
        throw new Error(`Access Denied: Agent is not granted access to repository ${args.repo}`)
      }
    }

    const parts = args.repo.split("/")
    const owner = parts[0] || ""
    const repoName = parts[1] || args.repo

    const client = new GitHubConnector({ token, fetchFn: this.fetchFn })
    return client.getFileContent(owner, repoName, args.path, args.ref)
  }

  async getGitHubIssueOrPr(args: {
    agentId: string
    orgId: string
    repo: string
    issueNumber: number
  }): Promise<ConnectorDoc> {
    const { connector, token } = await this.getDecryptedConnector(args.orgId, "github")
    const scope = await this.getAgentScope(args.agentId, connector.id)

    if (scope.allowedRepos && scope.allowedRepos.length > 0) {
      if (!scope.allowedRepos.includes(args.repo)) {
        throw new Error(`Access Denied: Agent is not granted access to repository ${args.repo}`)
      }
    }

    const parts = args.repo.split("/")
    const owner = parts[0] || ""
    const repoName = parts[1] || args.repo

    const client = new GitHubConnector({ token, fetchFn: this.fetchFn })
    return client.getIssueOrPullRequest(owner, repoName, args.issueNumber)
  }
}

let serviceInstance: ConnectorService | null = null

export function getConnectorService(): ConnectorService {
  if (!serviceInstance) {
    serviceInstance = new ConnectorService()
  }
  return serviceInstance
}
