import { fetchWithRetry } from "./rate-limiter"
import type { ConnectorDoc, ConnectorSearchOptions } from "./types"

export interface GitHubConfig {
  token: string
  fetchFn?: typeof fetch
}

export class GitHubConnector {
  constructor(private config: GitHubConfig) {}

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Sayabot-Workspace-Connector/1.0",
    }
  }

  /**
   * Searches code across specified repositories.
   */
  async searchCode(options: ConnectorSearchOptions): Promise<ConnectorDoc[]> {
    const limit = Math.min(20, Math.max(1, options.limit ?? 10))
    let q = options.query

    if (options.allowedRepos && options.allowedRepos.length > 0) {
      const repoFilters = options.allowedRepos.map((r) => `repo:${r}`).join(" ")
      q = `${q} ${repoFilters}`
    }

    const params = new URLSearchParams({
      q,
      per_page: String(limit),
    })

    const res = await fetchWithRetry(
      `https://api.github.com/search/code?${params.toString()}`,
      {
        method: "GET",
        headers: this.headers,
      },
      { fetchFn: this.config.fetchFn },
    )

    if (!res.ok) {
      throw new Error(`GitHub code search failed with HTTP ${res.status}`)
    }

    const data = (await res.json()) as {
      items?: Array<{
        name: string
        path: string
        html_url: string
        repository?: { full_name?: string }
      }>
    }

    const items = data.items ?? []
    return items.map((item) => ({
      id: `gh-${item.repository?.full_name || "repo"}-${item.path}`,
      source: "github",
      title: `${item.name} (${item.repository?.full_name || ""})`,
      content: `[GitHub Code File: ${item.path} in ${item.repository?.full_name || ""}]`,
      url: item.html_url,
      metadata: {
        repo: item.repository?.full_name,
        path: item.path,
      },
    }))
  }

  /**
   * Fetches the raw text content of a file in a GitHub repository.
   */
  async getFileContent(owner: string, repo: string, path: string, ref = "main"): Promise<ConnectorDoc> {
    const cleanPath = path.replace(/^\/+/, "")
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}?ref=${ref}`

    const res = await fetchWithRetry(
      url,
      {
        method: "GET",
        headers: this.headers,
      },
      { fetchFn: this.config.fetchFn },
    )

    if (!res.ok) {
      throw new Error(`Failed to fetch file from GitHub: ${owner}/${repo}/${path} (${res.status})`)
    }

    const data = (await res.json()) as {
      name: string
      path: string
      content?: string
      encoding?: string
      html_url: string
      size: number
    }

    let decodedContent = ""
    if (data.encoding === "base64" && data.content) {
      decodedContent = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8")
    }

    return {
      id: `gh-${owner}/${repo}-${data.path}`,
      source: "github",
      title: `${data.name} (${owner}/${repo})`,
      content: decodedContent.slice(0, 100_000),
      url: data.html_url,
      metadata: {
        repo: `${owner}/${repo}`,
        path: data.path,
        size: data.size,
      },
    }
  }

  /**
   * Fetches an issue or pull request with all discussion comments.
   */
  async getIssueOrPullRequest(owner: string, repo: string, issueNumber: number): Promise<ConnectorDoc> {
    const issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`
    const commentsUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`

    const [issueRes, commentsRes] = await Promise.all([
      fetchWithRetry(issueUrl, { method: "GET", headers: this.headers }, { fetchFn: this.config.fetchFn }),
      fetchWithRetry(commentsUrl, { method: "GET", headers: this.headers }, { fetchFn: this.config.fetchFn }),
    ])

    if (!issueRes.ok) {
      throw new Error(`Failed to fetch issue/PR #${issueNumber}: HTTP ${issueRes.status}`)
    }

    const issue = (await issueRes.json()) as {
      number: number
      title: string
      body?: string
      state: string
      html_url: string
      user?: { login?: string }
      created_at: string
      labels?: Array<{ name: string }>
      pull_request?: Record<string, unknown>
    }

    const isPR = Boolean(issue.pull_request)
    const typeLabel = isPR ? "Pull Request" : "Issue"

    const comments = commentsRes.ok
      ? ((await commentsRes.json()) as Array<{ user?: { login?: string }; body?: string; created_at: string }>)
      : []

    const discussionLines = [
      `# ${typeLabel} #${issue.number}: ${issue.title} (${issue.state.toUpperCase()})`,
      `**Author:** @${issue.user?.login || "unknown"} | **Created:** ${issue.created_at}`,
      "",
      issue.body || "[No description provided]",
      "",
      "---",
      "## Discussion & Comments",
      "",
    ]

    for (const c of comments) {
      discussionLines.push(`**@${c.user?.login || "user"}** (${c.created_at}):`)
      discussionLines.push(c.body || "")
      discussionLines.push("")
    }

    return {
      id: `gh-${owner}/${repo}-${issue.number}`,
      source: "github",
      title: `${typeLabel} #${issue.number}: ${issue.title}`,
      content: discussionLines.join("\n"),
      url: issue.html_url,
      metadata: {
        repo: `${owner}/${repo}`,
        issueNumber: issue.number,
        state: issue.state,
        author: issue.user?.login,
        labels: issue.labels?.map((l) => l.name) ?? [],
      },
    }
  }
}
