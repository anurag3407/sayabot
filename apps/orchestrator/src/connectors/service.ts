import { and, eq } from "drizzle-orm"
import { decryptSecret } from "@sayabot/llm"
import {
  agentConnectorGrants,
  workspaceConnectors,
  type WorkspaceConnectorRow,
} from "@sayabot/db"
import { getDb } from "../db"
import { getEnv } from "../env"
import { GitHubConnector } from "./github"
import { GoogleDriveConnector } from "./google-drive"
import { DiscordConnector, normalizePhone, TelegramConnector, WhatsAppConnector } from "./messaging"
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

  async readGitHubFile(args: {
    agentId: string
    orgId: string
    repo: string
    path: string
    ref?: string
  }): Promise<ConnectorDoc> {
    return this.getGitHubFile(args)
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

  async readGitHubIssue(args: {
    agentId: string
    orgId: string
    repo: string
    issueNumber: number
  }): Promise<ConnectorDoc> {
    return this.getGitHubIssueOrPr(args)
  }

  // ── Messaging (Slack send, Discord, Telegram, WhatsApp) ──────────────────

  /** A send needs a grant that is not read-only; the channel must be in scope when one is set. */
  private assertCanSend(scope: ConnectorScopeConfig, label: string) {
    if (scope.readOnly) throw new Error(`Access Denied: this agent has read-only access to ${label}.`)
  }

  private assertChannel(scope: ConnectorScopeConfig, channel: string, label: string) {
    const allowed = scope.allowedChannels
    if (allowed && allowed.length > 0 && !allowed.includes(channel.replace(/^#/, ""))) {
      throw new Error(`Access Denied: ${label} ${channel} is outside this agent's allowed list (${allowed.join(", ")}).`)
    }
  }

  async postSlackMessage(args: {
    agentId: string
    orgId: string
    channel: string
    text: string
    threadTs?: string
  }): Promise<{ ts: string; channel: string }> {
    const { connector, token } = await this.getDecryptedConnector(args.orgId, "slack")
    const scope = await this.getAgentScope(args.agentId, connector.id)
    this.assertCanSend(scope, "Slack")
    this.assertChannel(scope, args.channel, "Slack channel")
    return new SlackConnector({ botToken: token, fetchFn: this.fetchFn }).postMessage(args.channel, args.text, args.threadTs)
  }

  private async discord(orgId: string, agentId: string) {
    const { connector, token } = await this.getDecryptedConnector(orgId, "discord")
    const scope = await this.getAgentScope(agentId, connector.id)
    const config = (connector.config ?? {}) as { guildId?: string }
    return { scope, config, client: new DiscordConnector({ botToken: token, fetchFn: this.fetchFn }) }
  }

  async listDiscordChannels(args: { agentId: string; orgId: string; guildId?: string }) {
    const { scope, config, client } = await this.discord(args.orgId, args.agentId)
    const guildId = args.guildId ?? config.guildId
    if (!guildId) {
      const guilds = await client.listGuilds()
      return { guilds, channels: [] as { id: string; name: string }[] }
    }
    const channels = await client.listChannels(guildId)
    const allowed = scope.allowedChannels
    return {
      guilds: [] as { id: string; name: string }[],
      channels: allowed?.length ? channels.filter((c) => allowed.includes(c.id)) : channels,
    }
  }

  async readDiscordMessages(args: { agentId: string; orgId: string; channelId: string; limit?: number }) {
    const { scope, client } = await this.discord(args.orgId, args.agentId)
    this.assertChannel(scope, args.channelId, "Discord channel")
    return client.readMessages(args.channelId, args.limit)
  }

  async sendDiscordMessage(args: { agentId: string; orgId: string; channelId: string; content: string }) {
    const { scope, client } = await this.discord(args.orgId, args.agentId)
    this.assertCanSend(scope, "Discord")
    this.assertChannel(scope, args.channelId, "Discord channel")
    return client.sendMessage(args.channelId, args.content)
  }

  private async telegram(orgId: string, agentId: string) {
    const { connector, token } = await this.getDecryptedConnector(orgId, "telegram")
    const scope = await this.getAgentScope(agentId, connector.id)
    return { scope, client: new TelegramConnector({ botToken: token, fetchFn: this.fetchFn }) }
  }

  async readTelegramMessages(args: { agentId: string; orgId: string; limit?: number }) {
    const { scope, client } = await this.telegram(args.orgId, args.agentId)
    const messages = await client.recentMessages(args.limit)
    const allowed = scope.allowedChannels
    return allowed?.length ? messages.filter((m) => allowed.includes(m.chatId)) : messages
  }

  async sendTelegramMessage(args: { agentId: string; orgId: string; chatId: string; text: string }) {
    const { scope, client } = await this.telegram(args.orgId, args.agentId)
    this.assertCanSend(scope, "Telegram")
    this.assertChannel(scope, args.chatId, "Telegram chat")
    return client.sendMessage(args.chatId, args.text)
  }

  private async whatsapp(orgId: string, agentId: string, to: string) {
    const { connector, token } = await this.getDecryptedConnector(orgId, "whatsapp")
    const scope = await this.getAgentScope(agentId, connector.id)
    this.assertCanSend(scope, "WhatsApp")
    const number = normalizePhone(to)
    const allowed = (scope.allowedRecipients ?? []).map((n) => {
      try {
        return normalizePhone(n)
      } catch {
        return n
      }
    })
    if (allowed.length > 0 && !allowed.includes(number)) {
      throw new Error(`Access Denied: +${number} is not one of the numbers this agent may message.`)
    }
    const config = (connector.config ?? {}) as { phoneNumberId?: string }
    return {
      number,
      client: new WhatsAppConnector({ accessToken: token, phoneNumberId: config.phoneNumberId ?? "", fetchFn: this.fetchFn }),
    }
  }

  async sendWhatsAppText(args: { agentId: string; orgId: string; to: string; text: string }) {
    const { number, client } = await this.whatsapp(args.orgId, args.agentId, args.to)
    return client.sendText(number, args.text)
  }

  async sendWhatsAppTemplate(args: { agentId: string; orgId: string; to: string; template: string; language: string }) {
    const { number, client } = await this.whatsapp(args.orgId, args.agentId, args.to)
    return client.sendTemplate(number, args.template, args.language)
  }
}

let serviceInstance: ConnectorService | null = null

export function getConnectorService(): ConnectorService {
  if (!serviceInstance) {
    serviceInstance = new ConnectorService()
  }
  return serviceInstance
}
