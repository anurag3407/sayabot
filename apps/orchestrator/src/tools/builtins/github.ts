import { z } from "zod"
import type { ToolSpec } from "../audited"
import { loadOrgToolConfig, resolveToolCredential, type OrgToolConfig } from "../secrets"

export { loadOrgToolConfig, type OrgToolConfig }

const githubSchema = z.object({
  action: z.enum(["get_file", "list_issues", "commit_file"]),
  owner: z.string().min(1),
  repo: z.string().min(1),
  path: z.string().optional(),
  ref: z.string().optional(),
  state: z.enum(["open", "closed", "all"]).optional(),
  content: z.string().optional(),
  message: z.string().optional(),
  branch: z.string().optional(),
})

type GithubInput = z.infer<typeof githubSchema>

function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "sayabot-orchestrator",
  }
}

async function githubFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { ...githubHeaders(token), ...(init?.headers as Record<string, string>) },
  })
  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status, body }
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/")

export function githubTool(orgId: string, agentId?: string): ToolSpec {
  return {
    name: "github_bridge",
    description:
      "Read a file or list issues in a GitHub repository, or commit a file (write, requires human approval). Requires a GitHub token in org tool settings.",
    schema: githubSchema,
    dangerous: (args) => (args as GithubInput).action === "commit_file",
    execute: async (input: GithubInput) => {
      const config = await resolveToolCredential({ orgId, agentId, tool: "github_bridge" })
      if (!config?.token) {
        throw new Error("github_bridge is not configured. Add a GitHub token in Settings → Tools.")
      }
      const token = config.token
      const repoPath = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`
      if (input.action === "get_file") {
        if (!input.path) throw new Error("path is required for get_file")
        const ref = input.ref ? `?ref=${encodeURIComponent(input.ref)}` : ""
        const { status, body } = await githubFetch(
          token,
          `${repoPath}/contents/${encodePath(input.path)}${ref}`,
        )
        if (status !== 200) throw new Error(`GitHub returned ${status}: ${JSON.stringify(body)}`)
        if (!body || typeof body !== "object" || !("content" in body)) {
          throw new Error("path is not a file")
        }
        const content = Buffer.from(
          String((body as { content: string }).content),
          "base64",
        ).toString("utf8")
        return {
          path: input.path,
          sha: (body as { sha?: string }).sha,
          content: content.slice(0, 40_000),
        }
      }
      if (input.action === "list_issues") {
        const state = input.state ?? "open"
        const { status, body } = await githubFetch(
          token,
          `${repoPath}/issues?state=${state}&per_page=10`,
        )
        if (status !== 200) throw new Error(`GitHub returned ${status}: ${JSON.stringify(body)}`)
        return {
          issues: (body as Array<Record<string, unknown>>).map((issue) => ({
            number: issue.number,
            title: issue.title,
            state: issue.state,
            url: issue.html_url,
            author: (issue.user as { login?: string } | undefined)?.login,
            is_pull_request: Boolean(issue.pull_request),
          })),
        }
      }
      if (!input.path || input.content === undefined || !input.message) {
        throw new Error("path, content and message are required for commit_file")
      }
      const existing = await githubFetch(
        token,
        `${repoPath}/contents/${encodePath(input.path)}${input.branch ? `?ref=${encodeURIComponent(input.branch)}` : ""}`,
      )
      const sha =
        existing.status === 200 && existing.body && typeof existing.body === "object"
          ? (existing.body as { sha?: string }).sha
          : undefined
      const { status, body } = await githubFetch(
        token,
        `${repoPath}/contents/${encodePath(input.path)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            message: input.message,
            content: Buffer.from(input.content, "utf8").toString("base64"),
            branch: input.branch,
            ...(sha ? { sha } : {}),
          }),
        },
      )
      if (status !== 200 && status !== 201) {
        throw new Error(`GitHub returned ${status}: ${JSON.stringify(body)}`)
      }
      return {
        commit: (body as { commit?: { sha?: string } }).commit?.sha,
        path: input.path,
        url: (body as { content?: { html_url?: string } }).content?.html_url,
      }
    },
  }
}
