# GitHub Tool (`github_bridge`)

`github_bridge` is the org-credential GitHub tool: it reads a file, lists issues, or commits a file to a repository through the GitHub REST API (`api.github.com`) using the token configured in Settings → Tools (`github_bridge` tool config or a canonical `GITHUB_TOKEN` agent grant). Reading is safe; `commit_file` is `dangerous` and passes the human approval gate. This is distinct from the grant-scoped connector GitHub tools ([./tool-connectors.md](./tool-connectors.md)), which are read-only.

Source files: `apps/orchestrator/src/tools/builtins/github.ts`, `apps/orchestrator/src/tools/secrets.ts:36-104`

---

## 🎛️ Registration

Registered when the agent has the `github` capability (`src/tools/index.ts:353`):

```typescript
githubTool(args.orgId, args.agent.id)   // agentId optional
```

Tool name: `github_bridge`. Description: *"Read a file or list issues in a GitHub repository, or commit a file (write, requires human approval). Requires a GitHub token in org tool settings."*

## 📥 Schema (`github.ts:7-17`)

One flat object; required fields depend on `action` (validated at execute time):

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `action` | enum `get_file \| list_issues \| commit_file` | Operation to perform |
| `owner` | string (min 1) | Repository owner / org login |
| `repo` | string (min 1) | Repository name |
| `path` | string, optional | File path relative to repo root (required for `get_file` and `commit_file`) |
| `ref` | string, optional | Git ref for `get_file` (`?ref=` query) or `commit_file` (branch to read the existing file from) |
| `state` | enum `open \| closed \| all`, optional | Issue filter for `list_issues`; defaults to `open` |
| `content` | string, optional | New file content for `commit_file` |
| `message` | string, optional | Commit message for `commit_file` |
| `branch` | string, optional | Target branch for `commit_file` |

## ⚠️ Danger evaluation (`github.ts:57`)

```typescript
dangerous: (args) => (args as GithubInput).action === "commit_file"
```

`get_file` and `list_issues` execute immediately; `commit_file` records `pending_approval` and waits up to 5 minutes for a room/org admin ([./approvals.md](./approvals.md)).

## 🔑 Credential resolution (`github.ts:59-63`)

```typescript
const config = await resolveToolCredential({ orgId, agentId, tool: "github_bridge" })
if (!config?.token) {
  throw new Error("github_bridge is not configured. Add a GitHub token in Settings → Tools.")
}
```

Two tiers ([./secrets-broker.md](./secrets-broker.md)):

1. An unrevoked, unexpired `agent_secret_grants` row with `envName = "GITHUB_TOKEN"` joined to `vault_secrets` (sealed, opened with `MESH_KEK`; `token`/`password`/`apiKey` field is picked from JSON or the raw string).
2. Fallback: the `org_tool_configs` row for `(orgId, "github_bridge")`, whose sealed `configEnc` JSON supplies `token`.

## 🌐 HTTP layer (`github.ts:21-49`)

`githubFetch(token, path, init?)` calls `https://api.github.com<path>` with headers:

| Header | Value |
| :--- | :--- |
| `accept` | `application/vnd.github+json` |
| `authorization` | `Bearer <token>` |
| `x-github-api-version` | `2022-11-28` |
| `user-agent` | `sayabot-orchestrator` |

Response bodies are JSON-parsed when possible; non-200 statuses raise `GitHub returned <status>: <body-json>`.

## ⚙️ Actions (`github.ts:64-127`)

### `get_file` (`github.ts:65-80`)

- Requires `path` (else `throw new Error("path is required for get_file")`).
- `GET /repos/:owner/:repo/contents/:path[?ref=<ref>]` — each path segment is URL-encoded (`encodePath`, `github.ts:49`).
- Non-200 → error; a JSON body without `content` → `throw new Error("path is not a file")` (directory listing).
- Content is base64-decoded and truncated to 40,000 characters. Returns `{ path, sha, content }`.

### `list_issues` (`github.ts:81-98`)

- `GET /repos/:owner/:repo/issues?state=<state>&per_page=10`.
- Returns `{ issues: [{ number, title, state, url, author, is_pull_request }] }` — `is_pull_request` is derived from the presence of `issue.pull_request`.

### `commit_file` (`github.ts:99-127`)

1. Requires `path`, `content`, `message` (else `"path, content and message are required for commit_file"`).
2. Reads the existing file (`GET …/contents/:path[?ref=<branch>]`) to obtain its blob `sha` — needed so GitHub performs an update rather than refusing a create-on-existing.
3. `PUT /repos/:owner/:repo/contents/:path` with `{ message, content: base64(content), branch, sha? }`.
4. Non-200/201 → error. Returns `{ commit: <sha>, path, url: <html_url> }`.

Note: no diff/merge logic — a concurrent upstream change wins or the commit fails with GitHub's 409/422, which surfaces as `{ ok: false, error }` to the model.

## 🗃️ Tables and events

| Concern | Details |
| :--- | :--- |
| DB tables | `agent_secret_grants` ⋈ `vault_secrets` (canonical grant tier), `org_tool_configs` (org tier) — read-only; the audit layer writes `tool_calls` |
| Realtime events | standard audit events only; `commit_file` additionally emits `tool.approval_requested` / `tool.approval_resolved` |
| Egress | direct `fetch` to `api.github.com`; no SSRF guard is applied here because the host is fixed |

## 🧪 Example calls

```jsonc
// Read a file (safe, executes immediately)
{ "action": "get_file", "owner": "acme", "repo": "api", "path": "src/index.ts", "ref": "main" }
// → { "path": "src/index.ts", "sha": "9f2a…", "content": "…first 40k chars…" }

// List open issues (safe)
{ "action": "list_issues", "owner": "acme", "repo": "api", "state": "open" }
// → { "issues": [{ "number": 42, "title": "…", "state": "open", "url": "…", "author": "…", "is_pull_request": false }] }

// Commit a file (dangerous → pending_approval → admin approval → PUT)
{ "action": "commit_file", "owner": "acme", "repo": "api", "path": "docs/runbook.md",
  "content": "# Runbook", "message": "docs: add runbook", "branch": "main" }
// → { "commit": "<sha>", "path": "docs/runbook.md", "url": "https://github.com/…" }
```

## ⚠️ Error modes

| Condition | Model-visible result |
| :--- | :--- |
| No token configured | `{ ok: false, error: "github_bridge is not configured. Add a GitHub token in Settings → Tools." }` |
| Missing per-action fields | `{ ok: false, error: "path is required for get_file" }` / `"path, content and message are required for commit_file"` |
| GitHub non-200 (bad ref, no perms, rate limit) | `{ ok: false, error: "GitHub returned <status>: <body>" }` |
| Path points at a directory | `{ ok: false, error: "path is not a file" }` |
| Approval rejected/expired for `commit_file` | `{ ok: false, rejected: true, error: "A room admin rejected this tool call." }` |

## ⚠️ Notes

1. **`github_bridge` vs connector GitHub tools.** `github_bridge` uses one org-level token and can write; the `github_*` connector tools use the workspace `github` connector + per-agent `allowedRepos` grants and are read-only ([./tool-connectors.md](./tool-connectors.md)). AGENTS.md's catalog example `github_issue` ("Create and inspect GitHub issues and pull requests") does not exist in the current code — the implemented actions are `get_file`, `list_issues`, `commit_file` only.
2. **`list_issues` caps at 10 per page** and does not paginate.
3. **Branch semantics.** `commit_file` without `branch` commits to the repository's default branch (GitHub Contents API behavior); with `branch`, the existing file's `sha` is read from that branch first.

Related docs: [./tool-system.md](./tool-system.md) · [./tool-connectors.md](./tool-connectors.md) · [./approvals.md](./approvals.md) · [./secrets-broker.md](./secrets-broker.md) · [../../database/schema-connectors-and-vault.md](../../database/schema-connectors-and-vault.md)
