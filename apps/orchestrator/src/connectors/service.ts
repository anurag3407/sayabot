import { and, desc, eq } from "drizzle-orm"
import { decryptSecret, unwrapConnectorSecret } from "@sayabot/llm"
import {
  agentConnectorGrants,
  messages,
  messagingInbound,
  workspaceConnectors,
  type WorkspaceConnectorRow,
} from "@sayabot/db"
import { getDb } from "../db"
import { getEnv } from "../env"
import { ComposioConnector, isReadOnlyComposioTool } from "./composio"
import { GitHubConnector } from "./github"
import { GoogleDriveConnector } from "./google-drive"
import {
  DiscordConnector,
  normalizePhone,
  TelegramConnector,
  WhatsAppConnector,
  type MessagingMessage,
} from "./messaging"
import { queryPasswordManager, type PasswordConfig, type PasswordSource } from "./passwords"
import { SlackConnector } from "./slack"
import {
  STORAGE_CONNECTOR_SOURCES,
  type ConnectorDoc,
  type ConnectorScopeConfig,
  type ConnectorSource,
} from "./types"

export interface ConnectorServiceOptions {
  db?: any
  fetchFn?: typeof fetch
  kek?: string
  /**
   * Test seam: origin overrides per source, so integration tests can point a connector at a local
   * stub HTTP server instead of the vendor. Unset in production, where every client uses its
   * real vendor origin.
   */
  endpoints?: Partial<Record<ConnectorSource, string>>
}

export class ConnectorService {
  private db: any
  private fetchFn?: typeof fetch
  private kek?: string
  private endpoints: Partial<Record<ConnectorSource, string>>

  constructor(opts?: ConnectorServiceOptions) {
    this.db = opts?.db ?? getDb()
    this.fetchFn = opts?.fetchFn
    this.kek = opts?.kek
    this.endpoints = opts?.endpoints ?? {}
  }

  /** Origin override for a source, when one is configured (tests only). */
  endpointFor(source: ConnectorSource): string | undefined {
    return this.endpoints[source]
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

    const token = unwrapConnectorSecret(
      decryptSecret(
        {
          ciphertext: connector.ciphertext,
          iv: connector.iv,
          tag: connector.tag,
        },
        this.kek ?? getEnv().MESH_KEK,
      ),
    ).token

    return { connector, token }
  }

  /**
   * Picks the cloud-storage connector this agent should use: the storage connector it was granted
   * (the preferred provider wins when it granted several), otherwise the workspace's first active
   * storage connector. Returns null when the workspace has no active storage connector at all.
   */
  async getStorageTarget(args: {
    orgId: string
    agentId: string
    preferredProvider?: string
  }): Promise<{ connector: WorkspaceConnectorRow; token: string; granted: boolean } | null> {
    const rows = await this.db
      .select({ connector: workspaceConnectors })
      .from(agentConnectorGrants)
      .innerJoin(workspaceConnectors, eq(agentConnectorGrants.connectorId, workspaceConnectors.id))
      .where(
        and(
          eq(agentConnectorGrants.orgId, args.orgId),
          eq(agentConnectorGrants.agentId, args.agentId),
          eq(workspaceConnectors.status, "active"),
        ),
      )

    const granted = (rows as { connector: WorkspaceConnectorRow }[])
      .map((row) => row.connector)
      .filter((connector) =>
        STORAGE_CONNECTOR_SOURCES.includes(connector.source as ConnectorSource),
      )

    const pick =
      granted.find((connector) => connector.source === args.preferredProvider) ?? granted[0]
    if (pick) {
      const token = unwrapConnectorSecret(
        decryptSecret(
          { ciphertext: pick.ciphertext, iv: pick.iv, tag: pick.tag },
          this.kek ?? getEnv().MESH_KEK,
        ),
      ).token
      return { connector: pick, token, granted: true }
    }

    const ordered = args.preferredProvider
      ? [
          ...STORAGE_CONNECTOR_SOURCES.filter((source) => source === args.preferredProvider),
          ...STORAGE_CONNECTOR_SOURCES.filter((source) => source !== args.preferredProvider),
        ]
      : STORAGE_CONNECTOR_SOURCES

    for (const source of ordered) {
      try {
        const { connector, token } = await this.getDecryptedConnector(args.orgId, source)
        return { connector, token, granted: false }
      } catch {
        // Try the next storage provider.
      }
    }

    return null
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

    // The optional "domain / root folder" field is used as an extra folder scope when it is a
    // folder id; a Workspace domain name is not a Drive query filter, so it is ignored here.
    const config = (connector.config ?? {}) as { domain?: string }
    const rootFolderId =
      typeof config.domain === "string" && /^[A-Za-z0-9_-]{19,}$/.test(config.domain)
        ? config.domain
        : undefined

    const client = new GoogleDriveConnector({
      accessToken: token,
      fetchFn: this.fetchFn,
      baseUrl: this.endpoints.google_drive,
    })
    return client.searchFiles({
      query: args.query,
      limit: args.limit,
      allowedFolders: scope.allowedFolders,
      rootFolderId,
    })
  }

  async readGoogleDriveFile(args: {
    agentId: string
    orgId: string
    fileId: string
  }): Promise<ConnectorDoc> {
    const { connector, token } = await this.getDecryptedConnector(args.orgId, "google_drive")
    await this.getAgentScope(args.agentId, connector.id)

    const client = new GoogleDriveConnector({
      accessToken: token,
      fetchFn: this.fetchFn,
      baseUrl: this.endpoints.google_drive,
    })
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

    const client = new SlackConnector({
      botToken: token,
      fetchFn: this.fetchFn,
      baseUrl: this.endpoints.slack,
    })
    if (args.channel && scope.allowedChannels && scope.allowedChannels.length > 0) {
      await client.assertChannelAllowed(args.channel, scope.allowedChannels)
    }

    // With no grant restriction, an optional default channel on the connector scopes the search.
    const config = (connector.config ?? {}) as { defaultChannel?: string }
    const channels = args.channel
      ? [args.channel.replace(/^#/, "")]
      : scope.allowedChannels?.length
        ? scope.allowedChannels
        : config.defaultChannel
          ? [config.defaultChannel.replace(/^#/, "")]
          : undefined

    return client.searchMessages({
      query: args.query,
      limit: args.limit,
      allowedChannels: channels,
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

    const client = new SlackConnector({
      botToken: token,
      fetchFn: this.fetchFn,
      baseUrl: this.endpoints.slack,
    })
    // Grants may name channels (general) or give ids (C123…); both resolve to ids here.
    await client.assertChannelAllowed(args.channelId, scope.allowedChannels)
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

    // With no repo restriction, an optional default org on the connector scopes the search.
    const config = (connector.config ?? {}) as { defaultOrg?: string }
    const org = !scope.allowedRepos?.length && config.defaultOrg ? config.defaultOrg : undefined

    const client = new GitHubConnector({
      token,
      fetchFn: this.fetchFn,
      baseUrl: this.endpoints.github,
    })
    return client.searchCode({
      query: args.query,
      limit: args.limit,
      allowedRepos: scope.allowedRepos,
      org,
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

    const client = new GitHubConnector({
      token,
      fetchFn: this.fetchFn,
      baseUrl: this.endpoints.github,
    })
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

    const client = new GitHubConnector({
      token,
      fetchFn: this.fetchFn,
      baseUrl: this.endpoints.github,
    })
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
    if (scope.readOnly)
      throw new Error(`Access Denied: this agent has read-only access to ${label}.`)
  }

  private assertChannel(scope: ConnectorScopeConfig, channel: string, label: string) {
    const allowed = scope.allowedChannels
    if (allowed && allowed.length > 0 && !allowed.includes(channel.replace(/^#/, ""))) {
      throw new Error(
        `Access Denied: ${label} ${channel} is outside this agent's allowed list (${allowed.join(", ")}).`,
      )
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
    const client = new SlackConnector({
      botToken: token,
      fetchFn: this.fetchFn,
      baseUrl: this.endpoints.slack,
    })
    await client.assertChannelAllowed(args.channel, scope.allowedChannels)
    return client.postMessage(args.channel, args.text, args.threadTs)
  }

  private async discord(orgId: string, agentId: string) {
    const { connector, token } = await this.getDecryptedConnector(orgId, "discord")
    const scope = await this.getAgentScope(agentId, connector.id)
    const config = (connector.config ?? {}) as { guildId?: string }
    return {
      scope,
      config,
      client: new DiscordConnector({
        botToken: token,
        fetchFn: this.fetchFn,
        baseUrl: this.endpoints.discord,
      }),
    }
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

  async readDiscordMessages(args: {
    agentId: string
    orgId: string
    channelId: string
    limit?: number
  }) {
    const { scope, client } = await this.discord(args.orgId, args.agentId)
    this.assertChannel(scope, args.channelId, "Discord channel")
    return client.readMessages(args.channelId, args.limit)
  }

  async sendDiscordMessage(args: {
    agentId: string
    orgId: string
    channelId: string
    content: string
  }) {
    const { scope, client } = await this.discord(args.orgId, args.agentId)
    this.assertCanSend(scope, "Discord")
    this.assertChannel(scope, args.channelId, "Discord channel")
    return client.sendMessage(args.channelId, args.content)
  }

  private async telegram(orgId: string, agentId: string) {
    const { connector, token } = await this.getDecryptedConnector(orgId, "telegram")
    const scope = await this.getAgentScope(agentId, connector.id)
    return {
      connector,
      scope,
      client: new TelegramConnector({
        botToken: token,
        fetchFn: this.fetchFn,
        baseUrl: this.endpoints.telegram,
      }),
    }
  }

  /**
   * Recent messages from the bot, newest first. `getUpdates` only works while no webhook is set;
   * once chat-with-an-agent is turned on Telegram has a webhook, so the messages already recorded
   * by the inbound intake are returned instead of failing with a 409.
   */
  async readTelegramMessages(args: { agentId: string; orgId: string; limit?: number }) {
    const { connector, scope, client } = await this.telegram(args.orgId, args.agentId)
    const limit = args.limit ?? 25
    let found: MessagingMessage[]
    try {
      found = await client.recentMessages(limit)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/webhook/i.test(message)) throw error
      found = await this.recentInboundMessages(connector.id, limit)
    }
    const allowed = scope.allowedChannels
    return allowed?.length ? found.filter((m) => allowed.includes(m.chatId)) : found
  }

  /** Messages Telegram already delivered through the inbound webhook, newest first. */
  private async recentInboundMessages(
    connectorId: string,
    limit: number,
  ): Promise<MessagingMessage[]> {
    const rows = await this.db
      .select({
        externalId: messagingInbound.externalId,
        content: messages.content,
        metadata: messages.metadata,
        createdAt: messages.createdAt,
      })
      .from(messagingInbound)
      .innerJoin(messages, eq(messagingInbound.messageId, messages.id))
      .where(eq(messagingInbound.connectorId, connectorId))
      .orderBy(desc(messages.createdAt))
      .limit(Math.min(100, Math.max(1, limit)))

    return rows.flatMap(
      (row: {
        externalId: string
        content: string
        metadata: Record<string, unknown> | null
        createdAt: Date
      }) => {
        const inbound = (row.metadata?.inbound ?? {}) as { chatId?: string; sender?: string }
        if (!inbound.chatId) return []
        const marker = " says:\n"
        const at = row.content.indexOf(marker)
        const text = at >= 0 ? row.content.slice(at + marker.length) : row.content
        return [
          {
            id: row.externalId,
            author: inbound.sender ?? "unknown",
            text,
            sentAt: row.createdAt.toISOString(),
            chatId: inbound.chatId,
          },
        ]
      },
    )
  }

  async sendTelegramMessage(args: {
    agentId: string
    orgId: string
    chatId: string
    text: string
  }) {
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
      client: new WhatsAppConnector({
        accessToken: token,
        phoneNumberId: config.phoneNumberId ?? "",
        fetchFn: this.fetchFn,
        baseUrl: this.endpoints.whatsapp,
      }),
    }
  }

  async sendWhatsAppText(args: { agentId: string; orgId: string; to: string; text: string }) {
    const { number, client } = await this.whatsapp(args.orgId, args.agentId, args.to)
    return client.sendText(number, args.text)
  }

  async sendWhatsAppTemplate(args: {
    agentId: string
    orgId: string
    to: string
    template: string
    language: string
  }) {
    const { number, client } = await this.whatsapp(args.orgId, args.agentId, args.to)
    return client.sendTemplate(number, args.template, args.language)
  }

  async queryPassword(args: {
    agentId: string
    orgId: string
    source: PasswordSource
    action: "search" | "read"
    query: string
    vault?: string
    signal?: AbortSignal
  }): Promise<unknown> {
    const { connector, token } = await this.getDecryptedConnector(args.orgId, args.source)
    const scope = await this.getAgentScope(args.agentId, connector.id)
    const config = { ...((connector.config ?? {}) as PasswordConfig) }
    if (scope.allowedVaults?.length) config.allowedVaults = scope.allowedVaults
    return queryPasswordManager({
      source: args.source,
      action: args.action,
      query: args.query,
      vault: args.vault,
      token,
      config,
      orgId: args.orgId,
      connectorId: connector.id,
      signal: args.signal,
      // Only when a test endpoint override is in play; production always requires HTTPS.
      allowLocalBase: Boolean(this.endpoints[args.source]),
    })
  }

  // ── Composio connected apps ───────────────────────────────────────────────

  /**
   * The agent's Composio user. One identity per workspace keeps connected accounts (the person's
   * own OAuth grants) separate from every other org's, without storing any extra row.
   */
  private composioUser(orgId: string, config: { userId?: string }): string {
    return config.userId?.trim() || `org:${orgId}`
  }

  private async composio(orgId: string, agentId: string) {
    const { connector, token } = await this.getDecryptedConnector(orgId, "composio")
    const scope = await this.getAgentScope(agentId, connector.id)
    const config = (connector.config ?? {}) as { userId?: string; baseUrl?: string }
    return {
      scope,
      userId: this.composioUser(orgId, config),
      client: new ComposioConnector({
        apiKey: token,
        baseUrl: this.endpoints.composio ?? config.baseUrl,
        fetchFn: this.fetchFn,
      }),
    }
  }

  /** The apps this agent may use: its grant's allow-list, or the whole catalog when unset. */
  private assertComposioApp(scope: ConnectorScopeConfig, toolkit: string) {
    const allowed = (scope.allowedApps ?? []).map((app) => app.toLowerCase())
    if (allowed.length > 0 && !allowed.includes(toolkit.toLowerCase())) {
      throw new Error(
        `Access Denied: ${toolkit} is outside this agent's allowed apps (${allowed.join(", ")}).`,
      )
    }
  }

  /**
   * A tool slug's toolkit is a prefix of the slug (`GMAIL_FETCH_EMAILS`, `GOOGLE_ANALYTICS_…`),
   * so a granted app matches when the slug starts with it. Unknown apps never match.
   */
  private assertComposioTool(scope: ConnectorScopeConfig, slug: string) {
    const allowed = (scope.allowedApps ?? []).map((app) => app.toLowerCase())
    if (allowed.length === 0) return
    const lower = slug.toLowerCase()
    if (allowed.some((app) => lower.startsWith(`${app}_`))) return
    throw new Error(
      `Access Denied: ${slug} is outside this agent's allowed apps (${allowed.join(", ")}).`,
    )
  }

  /** Apps in the catalog, each marked with whether this workspace has connected it. */
  async listComposioApps(args: {
    agentId: string
    orgId: string
    search?: string
    limit?: number
  }) {
    const { scope, userId, client } = await this.composio(args.orgId, args.agentId)
    const [toolkits, accounts] = await Promise.all([
      client.toolkits({ search: args.search, limit: args.limit ?? 50 }),
      client.connectedAccounts({ userId }).catch(() => []),
    ])
    const connected = new Map(accounts.map((account) => [account.toolkit, account.status]))
    const allowed = (scope.allowedApps ?? []).map((app) => app.toLowerCase())
    return toolkits
      .filter((toolkit) => allowed.length === 0 || allowed.includes(toolkit.slug))
      .map((toolkit) => ({
        ...toolkit,
        connected: connected.has(toolkit.slug),
        status: connected.get(toolkit.slug) ?? null,
      }))
  }

  async searchComposioTools(args: {
    agentId: string
    orgId: string
    toolkit: string
    query?: string
    limit?: number
  }) {
    const { scope, client } = await this.composio(args.orgId, args.agentId)
    this.assertComposioApp(scope, args.toolkit)
    const tools = await client.tools({
      toolkit: args.toolkit,
      search: args.query,
      limit: args.limit,
    })
    return tools.map((tool) => ({ ...tool, write: !isReadOnlyComposioTool(tool.slug) }))
  }

  async executeComposioTool(args: {
    agentId: string
    orgId: string
    tool: string
    arguments?: Record<string, unknown>
    connectedAccountId?: string
  }) {
    const { scope, userId, client } = await this.composio(args.orgId, args.agentId)
    this.assertComposioTool(scope, args.tool)
    if (scope.readOnly && !isReadOnlyComposioTool(args.tool)) {
      throw new Error(`Access Denied: this agent has read-only access to Composio (${args.tool}).`)
    }
    return client.execute({
      toolSlug: args.tool,
      userId,
      arguments: args.arguments ?? {},
      connectedAccountId: args.connectedAccountId,
    })
  }

  /** A sign-in link the person opens to connect one app to this workspace. */
  async connectComposioApp(args: { agentId: string; orgId: string; toolkit: string }) {
    const { scope, userId, client } = await this.composio(args.orgId, args.agentId)
    this.assertComposioApp(scope, args.toolkit)
    const url = await client.connectLink({ toolkit: args.toolkit, userId })
    return { toolkit: args.toolkit.toLowerCase(), url }
  }
}

let serviceInstance: ConnectorService | null = null

export function getConnectorService(): ConnectorService {
  if (!serviceInstance) {
    serviceInstance = new ConnectorService()
  }
  return serviceInstance
}

/** Test seam: install a configured service (fake db, stub endpoints) for the tool layer. */
export function setConnectorService(service: ConnectorService | null): void {
  serviceInstance = service
}
