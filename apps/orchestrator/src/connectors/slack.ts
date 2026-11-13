import { fetchWithRetry } from "./rate-limiter"
import type { ConnectorDoc, ConnectorSearchOptions } from "./types"

export interface SlackConfig {
  botToken: string
  fetchFn?: typeof fetch
}

export class SlackConnector {
  private userCache = new Map<string, string>()

  constructor(private config: SlackConfig) {}

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.botToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    }
  }

  /**
   * Resolves a Slack User ID (<@U12345>) to their display name or real name.
   */
  async resolveUserName(userId: string): Promise<string> {
    if (this.userCache.has(userId)) {
      return this.userCache.get(userId)!
    }

    try {
      const res = await fetchWithRetry(
        `https://slack.com/api/users.info?user=${userId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.config.botToken}`,
          },
        },
        { fetchFn: this.config.fetchFn },
      )

      if (res.ok) {
        const data = (await res.json()) as {
          ok?: boolean
          user?: { real_name?: string; name?: string; profile?: { display_name?: string } }
        }
        if (data.ok && data.user) {
          const name =
            data.user.profile?.display_name || data.user.real_name || data.user.name || userId
          this.userCache.set(userId, `@${name}`)
          return `@${name}`
        }
      }
    } catch {}

    return `@${userId}`
  }

  /**
   * Formats raw Slack message text, replacing <@U12345> tokens with real human names.
   */
  async formatSlackText(rawText: string): Promise<string> {
    const userMatches = rawText.match(/<@([A-Z0-9]+)>/g) || []
    let formatted = rawText

    for (const match of userMatches) {
      const userId = match.slice(2, -1)
      const name = await this.resolveUserName(userId)
      formatted = formatted.replace(new RegExp(match, "g"), name)
    }

    return formatted
  }

  /**
   * Searches messages across Slack workspace, scoped by allowed channel IDs.
   */
  async searchMessages(options: ConnectorSearchOptions): Promise<ConnectorDoc[]> {
    const limit = Math.min(25, Math.max(1, options.limit ?? 10))
    let query = options.query

    if (options.allowedChannels && options.allowedChannels.length > 0) {
      const channelFilters = options.allowedChannels.map((c) => `in:${c}`).join(" ")
      query = `${query} ${channelFilters}`
    }

    const params = new URLSearchParams({
      query,
      count: String(limit),
      sort: "timestamp",
      sort_dir: "desc",
    })

    const res = await fetchWithRetry(
      `https://slack.com/api/search.messages?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.config.botToken}`,
        },
      },
      { fetchFn: this.config.fetchFn },
    )

    if (!res.ok) {
      throw new Error(`Slack search failed with HTTP ${res.status}`)
    }

    const data = (await res.json()) as {
      ok?: boolean
      error?: string
      messages?: {
        matches?: Array<{
          iid: string
          text: string
          user?: string
          username?: string
          channel?: { id?: string; name?: string }
          ts?: string
          permalink?: string
        }>
      }
    }

    // search.messages only accepts a user token. A normal bot token gets
    // not_allowed_token_type, so scan channel history instead.
    if (!data.ok) {
      if (data.error === "not_allowed_token_type" || data.error === "missing_scope") {
        return this.searchChannelHistory(options)
      }
      throw new Error(`Slack API error: ${data.error || "unknown error"}`)
    }

    const matches = data.messages?.matches ?? []
    const results: ConnectorDoc[] = []

    for (const m of matches) {
      const user = m.user ? await this.resolveUserName(m.user) : m.username || "Slack User"
      const content = await this.formatSlackText(m.text)
      const channelName = m.channel?.name ? `#${m.channel.name}` : m.channel?.id || "slack"

      results.push({
        id: `slack-${m.channel?.id || "ch"}-${m.ts || m.iid}`,
        source: "slack",
        title: `Slack Message in ${channelName} by ${user}`,
        content,
        url: m.permalink || `https://slack.com`,
        metadata: {
          channelId: m.channel?.id,
          channelName,
          author: user,
          threadTs: m.ts,
        },
      })
    }

    return results
  }

  /**
   * Bot-token search: list channels the bot is in and keep messages whose text matches.
   * Capped so one search cannot walk the whole workspace.
   */
  private async searchChannelHistory(options: ConnectorSearchOptions): Promise<ConnectorDoc[]> {
    const limit = Math.min(25, Math.max(1, options.limit ?? 10))
    const needle = options.query.trim().toLowerCase()
    if (!needle) return []

    const listed = await this.slackApi<{
      ok?: boolean
      error?: string
      channels?: Array<{ id: string; name?: string }>
    }>(
      `https://slack.com/api/conversations.list?${new URLSearchParams({
        limit: "100",
        types: "public_channel,private_channel",
        exclude_archived: "true",
      })}`,
    )
    if (!listed.ok) throw new Error(`Slack API error: ${listed.error || "unknown error"}`)

    let channels = listed.channels ?? []
    if (options.allowedChannels && options.allowedChannels.length > 0) {
      const allow = new Set(
        options.allowedChannels.map((channel) => channel.replace(/^#/, "").toLowerCase()),
      )
      channels = channels.filter(
        (channel) =>
          allow.has(channel.id.toLowerCase()) ||
          (channel.name ? allow.has(channel.name.toLowerCase()) : false),
      )
    }

    const results: ConnectorDoc[] = []
    for (const channel of channels.slice(0, 12)) {
      if (results.length >= limit) break
      const history = await this.slackApi<{
        ok?: boolean
        error?: string
        messages?: Array<{ user?: string; username?: string; text?: string; ts?: string }>
      }>(
        `https://slack.com/api/conversations.history?${new URLSearchParams({
          channel: channel.id,
          limit: "40",
        })}`,
      )
      if (!history.ok) continue
      const channelName = channel.name ? `#${channel.name}` : channel.id
      for (const message of history.messages ?? []) {
        if (results.length >= limit) break
        const text = message.text ?? ""
        if (!text.toLowerCase().includes(needle)) continue
        const user = message.user
          ? await this.resolveUserName(message.user)
          : message.username || "Slack User"
        results.push({
          id: `slack-${channel.id}-${message.ts || results.length}`,
          source: "slack",
          title: `Slack Message in ${channelName} by ${user}`,
          content: await this.formatSlackText(text),
          url: message.ts
            ? `https://slack.com/archives/${channel.id}/p${message.ts.replace(".", "")}`
            : "https://slack.com",
          metadata: {
            channelId: channel.id,
            channelName,
            author: user,
            threadTs: message.ts,
          },
        })
      }
    }
    return results
  }

  private async slackApi<T>(url: string): Promise<T> {
    const res = await fetchWithRetry(
      url,
      { method: "GET", headers: { Authorization: `Bearer ${this.config.botToken}` } },
      { fetchFn: this.config.fetchFn },
    )
    if (!res.ok) throw new Error(`Slack search failed with HTTP ${res.status}`)
    return (await res.json()) as T
  }

  /**
   * Fetches an entire discussion thread with all user replies in chronological order.
   */
  async readThread(channelId: string, threadTs: string): Promise<ConnectorDoc> {
    const params = new URLSearchParams({
      channel: channelId,
      ts: threadTs,
      limit: "50",
    })

    const res = await fetchWithRetry(
      `https://slack.com/api/conversations.replies?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.config.botToken}`,
        },
      },
      { fetchFn: this.config.fetchFn },
    )

    if (!res.ok) {
      throw new Error(`Failed to fetch Slack thread: HTTP ${res.status}`)
    }

    const data = (await res.json()) as {
      ok?: boolean
      error?: string
      messages?: Array<{
        user?: string
        text: string
        ts: string
      }>
    }

    if (!data.ok || !data.messages || data.messages.length === 0) {
      throw new Error(`Slack thread error: ${data.error || "No messages found"}`)
    }

    const formattedMessages: string[] = []
    for (const msg of data.messages) {
      const author = msg.user ? await this.resolveUserName(msg.user) : "User"
      const text = await this.formatSlackText(msg.text)
      formattedMessages.push(
        `**${author}** (${new Date(parseFloat(msg.ts) * 1000).toISOString()}):\n${text}`,
      )
    }

    return {
      id: `slack-thread-${channelId}-${threadTs}`,
      source: "slack",
      title: `Slack Thread in ${channelId} (${data.messages.length} replies)`,
      content: formattedMessages.join("\n\n---\n\n"),
      url: `https://slack.com/archives/${channelId}/p${threadTs.replace(".", "")}`,
      metadata: {
        channelId,
        threadTs,
        replyCount: data.messages.length,
      },
    }
  }

  /**
   * Posts a message (optionally as a thread reply). Never retried: a timeout must not post twice.
   * Dangerous tool; it runs only after a person approves it.
   */
  async postMessage(
    channel: string,
    text: string,
    threadTs?: string,
  ): Promise<{ ts: string; channel: string }> {
    if (!text.trim()) throw new Error("Message is empty")
    const res = await fetchWithRetry(
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.botToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          channel,
          text: text.slice(0, 40_000),
          ...(threadTs ? { thread_ts: threadTs } : {}),
        }),
      },
      { fetchFn: this.config.fetchFn, maxRetries: 0 },
    )
    if (!res.ok) throw new Error(`Slack post failed with HTTP ${res.status}`)
    const data = (await res.json()) as {
      ok?: boolean
      error?: string
      ts?: string
      channel?: string
    }
    if (!data.ok || !data.ts) throw new Error(`Slack API error: ${data.error || "unknown error"}`)
    return { ts: data.ts, channel: data.channel ?? channel }
  }
}
