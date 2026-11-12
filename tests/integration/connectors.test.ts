import { describe, it, expect, vi, beforeEach } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import {
  encryptSecret,
  decryptSecret,
  sealSecret,
  openSecret,
} from "@sayabot/llm"
import { redactSecrets, createRunScrubber } from "@sayabot/core"
import type { WorkspaceConnectorRow, AgentConnectorGrantRow } from "@sayabot/db"
import { ConnectorService } from "../../apps/orchestrator/src/connectors/service"
import { fetchWithRetry } from "../../apps/orchestrator/src/connectors/rate-limiter"

// ── Test Constants & Encryption Setup ────────────────────────────────────────

const TEST_KEK = Buffer.alloc(32, 42).toString("base64")
const ORG_ID = "00000000-0000-0000-0000-000000000001"
const AGENT_ID = "00000000-0000-0000-0000-000000000002"
const UNAUTHORIZED_AGENT_ID = "00000000-0000-0000-0000-000000000099"

const GDRIVE_TOKEN = "ya29.a0AfH6SMA-google-drive-test-token-secret"
const SLACK_TOKEN = "xoxb-mock-slack-test-token-redact-12345"
const GITHUB_TOKEN = "ghp_mocktesttoken1234567890abcdefghijklmnopqrstuvwxyz"

// ── Mock DB Builder ──────────────────────────────────────────────────────────

function createMockDb(records: {
  connectors: WorkspaceConnectorRow[]
  grants: AgentConnectorGrantRow[]
}) {
  const dialect = new PgDialect()
  return {
    select: () => ({
      from: (table: any) => ({
        where: (cond: any) => {
          const { sql, params } = dialect.sqlToQuery(cond)
          let results: any[] = []

          if (sql.includes("workspace_connectors")) {
            const orgIdx = sql.indexOf('"org_id" = $1') !== -1 ? 0 : 1
            const sourceIdx = orgIdx === 0 ? 1 : 0
            results = records.connectors.filter(
              (c) => c.orgId === params[orgIdx] && c.source === params[sourceIdx],
            )
          } else if (sql.includes("agent_connector_grants")) {
            const agentIdx = sql.indexOf('"agent_id" = $1') !== -1 ? 0 : 1
            const connIdx = agentIdx === 0 ? 1 : 0
            results = records.grants.filter(
              (g) => g.agentId === params[agentIdx] && g.connectorId === params[connIdx],
            )
          }

          return {
            limit: (n: number) => Promise.resolve(results.slice(0, n)),
            then: (resolve: any, reject: any) => Promise.resolve(results).then(resolve, reject),
          }
        },
      }),
    }),
  }
}

describe("Root Connector Lifecycle Integration Suite", () => {
  let mockConnectors: WorkspaceConnectorRow[]
  let mockGrants: AgentConnectorGrantRow[]
  let mockDb: ReturnType<typeof createMockDb>
  let interceptedRequests: Array<{ url: string; method: string; headers: Record<string, string> }>
  let mockFetch: typeof fetch

  beforeEach(() => {
    interceptedRequests = []

    // 1 & 2. Encrypt connector tokens using @sayabot/llm with test KEK
    const gdriveEncrypted = encryptSecret(GDRIVE_TOKEN, TEST_KEK)
    const slackEncrypted = encryptSecret(SLACK_TOKEN, TEST_KEK)
    const githubEncrypted = encryptSecret(GITHUB_TOKEN, TEST_KEK)

    // Set up in-memory mock DB records matching @sayabot/db/schema
    mockConnectors = [
      {
        id: "conn-gdrive-1",
        orgId: ORG_ID,
        ownerUserId: "user-1",
        source: "google_drive",
        name: "Workspace Google Drive",
        status: "active",
        authType: "token",
        ciphertext: gdriveEncrypted.ciphertext,
        iv: gdriveEncrypted.iv,
        tag: gdriveEncrypted.tag,
        last4: "cret",
        config: {},
        lastSyncedAt: new Date(),
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "conn-slack-1",
        orgId: ORG_ID,
        ownerUserId: "user-1",
        source: "slack",
        name: "Workspace Slack",
        status: "active",
        authType: "token",
        ciphertext: slackEncrypted.ciphertext,
        iv: slackEncrypted.iv,
        tag: slackEncrypted.tag,
        last4: "uvwx",
        config: {},
        lastSyncedAt: new Date(),
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "conn-github-1",
        orgId: ORG_ID,
        ownerUserId: "user-1",
        source: "github",
        name: "Workspace GitHub",
        status: "active",
        authType: "token",
        ciphertext: githubEncrypted.ciphertext,
        iv: githubEncrypted.iv,
        tag: githubEncrypted.tag,
        last4: "cdef",
        config: {},
        lastSyncedAt: new Date(),
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "conn-revoked-1",
        orgId: ORG_ID,
        ownerUserId: "user-1",
        source: "jira",
        name: "Revoked Jira",
        status: "revoked",
        authType: "token",
        ciphertext: githubEncrypted.ciphertext,
        iv: githubEncrypted.iv,
        tag: githubEncrypted.tag,
        last4: "cdef",
        config: {},
        lastSyncedAt: new Date(),
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    mockGrants = [
      {
        id: "grant-gdrive-1",
        orgId: ORG_ID,
        agentId: AGENT_ID,
        connectorId: "conn-gdrive-1",
        scopeConfig: {
          allowedFolders: ["folder-roadmaps-101", "folder-designs-202"],
        },
        createdAt: new Date(),
      },
      {
        id: "grant-slack-1",
        orgId: ORG_ID,
        agentId: AGENT_ID,
        connectorId: "conn-slack-1",
        scopeConfig: {
          allowedChannels: ["C01_general", "C02_eng"],
        },
        createdAt: new Date(),
      },
      {
        id: "grant-github-1",
        orgId: ORG_ID,
        agentId: AGENT_ID,
        connectorId: "conn-github-1",
        scopeConfig: {
          allowedRepos: ["sayalabs/core-engine", "sayalabs/web-app"],
        },
        createdAt: new Date(),
      },
    ]

    mockDb = createMockDb({
      connectors: mockConnectors,
      grants: mockGrants,
    })

    // Mock fetchFn router for external APIs
    mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input.toString()
      const method = init?.method ?? "GET"
      const headersRecord: Record<string, string> = {}

      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((val, key) => {
            headersRecord[key.toLowerCase()] = val
          })
        } else if (Array.isArray(init.headers)) {
          for (const [k, v] of init.headers) {
            headersRecord[k.toLowerCase()] = v
          }
        } else {
          for (const [k, v] of Object.entries(init.headers)) {
            headersRecord[k.toLowerCase()] = String(v)
          }
        }
      }

      interceptedRequests.push({ url: urlStr, method, headers: headersRecord })

      // ── Google Drive API Router ──
      if (urlStr.startsWith("https://www.googleapis.com/drive/v3/files")) {
        // 1. Export endpoints
        if (urlStr.includes("/export?mimeType=text/plain")) {
          return new Response("# Q4 Roadmap Document\n\n- Build Connector Mesh\n- Security hardening", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          })
        }
        if (urlStr.includes("/export?mimeType=text/csv")) {
          return new Response("Metric,Oct,Nov\nActiveUsers,12000,18500\nRevenue,45000,68000", {
            status: 200,
            headers: { "Content-Type": "text/csv" },
          })
        }
        // 2. Metadata endpoints for specific files
        if (urlStr.includes("/files/doc-123?")) {
          return new Response(
            JSON.stringify({
              id: "doc-123",
              name: "Q4 Roadmap",
              mimeType: "application/vnd.google-apps.document",
              webViewLink: "https://docs.google.com/document/d/doc-123/edit",
              modifiedTime: "2026-11-10T12:00:00Z",
              owners: [{ displayName: "Alice Product" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        if (urlStr.includes("/files/sheet-456?")) {
          return new Response(
            JSON.stringify({
              id: "sheet-456",
              name: "Growth Metrics",
              mimeType: "application/vnd.google-apps.spreadsheet",
              webViewLink: "https://docs.google.com/spreadsheets/d/sheet-456/edit",
              modifiedTime: "2026-11-11T09:00:00Z",
              owners: [{ displayName: "Bob Growth" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        // 3. Search files endpoint
        if (urlStr.includes("/files?")) {
          return new Response(
            JSON.stringify({
              files: [
                {
                  id: "doc-123",
                  name: "Q4 Roadmap",
                  mimeType: "application/vnd.google-apps.document",
                  webViewLink: "https://docs.google.com/document/d/doc-123/edit",
                  modifiedTime: "2026-11-10T12:00:00Z",
                  owners: [{ displayName: "Alice Product", emailAddress: "alice@sayalabs.in" }],
                },
                {
                  id: "sheet-456",
                  name: "Growth Metrics",
                  mimeType: "application/vnd.google-apps.spreadsheet",
                  webViewLink: "https://docs.google.com/spreadsheets/d/sheet-456/edit",
                  modifiedTime: "2026-11-11T09:00:00Z",
                  owners: [{ displayName: "Bob Growth", emailAddress: "bob@sayalabs.in" }],
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
      }

      // ── Slack API Router ──
      if (urlStr.startsWith("https://slack.com/api/users.info")) {
        const urlObj = new URL(urlStr)
        const user = urlObj.searchParams.get("user")
        if (user === "U111") {
          return new Response(
            JSON.stringify({
              ok: true,
              user: { name: "alice_slack", real_name: "Alice Smith", profile: { display_name: "alice" } },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        if (user === "U222") {
          return new Response(
            JSON.stringify({
              ok: true,
              user: { name: "charlie_slack", real_name: "Charlie Dev", profile: { display_name: "charlie" } },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        return new Response(JSON.stringify({ ok: false, error: "user_not_found" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }

      if (urlStr.startsWith("https://slack.com/api/search.messages")) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: {
              matches: [
                {
                  iid: "msg-match-1",
                  text: "Hey <@U111>, can you check PR from <@U222>?",
                  user: "U111",
                  channel: { id: "C01_general", name: "general" },
                  ts: "1700000000.000100",
                  permalink: "https://slack.com/archives/C01_general/p1700000000000100",
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }

      if (urlStr.startsWith("https://slack.com/api/conversations.replies")) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [
              { user: "U111", text: "Starting thread about database migrations", ts: "1700000000.000100" },
              { user: "U222", text: "Agreed, let us ping <@U111> for schema review", ts: "1700000000.000200" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }

      // ── GitHub API Router ──
      if (urlStr.startsWith("https://api.github.com/search/code")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                name: "crypto.ts",
                path: "src/crypto.ts",
                html_url: "https://github.com/sayalabs/core-engine/blob/main/src/crypto.ts",
                repository: { full_name: "sayalabs/core-engine" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }

      if (urlStr.includes("/contents/src/crypto.ts")) {
        const rawCode = 'export const SECRETS_VERSION = "2.0";\nexport function verify() { return true; }'
        return new Response(
          JSON.stringify({
            name: "crypto.ts",
            path: "src/crypto.ts",
            encoding: "base64",
            content: Buffer.from(rawCode).toString("base64"),
            html_url: "https://github.com/sayalabs/core-engine/blob/main/src/crypto.ts",
            size: rawCode.length,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }

      if (urlStr.includes("/issues/42/comments")) {
        return new Response(
          JSON.stringify([
            {
              user: { login: "reviewer-1" },
              body: "Reviewed the fix, looks solid and tests pass.",
              created_at: "2026-11-11T14:30:00Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }

      if (urlStr.includes("/issues/42")) {
        return new Response(
          JSON.stringify({
            number: 42,
            title: "Implement connector rate-limiter backoff",
            body: "Need exponential backoff and jitter on 429 and 503 errors.",
            state: "closed",
            html_url: "https://github.com/sayalabs/core-engine/issues/42",
            user: { login: "founder" },
            created_at: "2026-11-10T10:00:00Z",
            labels: [{ name: "feature" }, { name: "security" }],
            pull_request: {},
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      }

      return new Response("Not Found", { status: 404 })
    })
  })

  // ── 1. DB & Decryption Lifecycle ───────────────────────────────────────────
  describe("DB and Credential Decryption Lifecycle", () => {
    it("instantiates ConnectorService with mock DB and test KEK, decrypting active connector tokens", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      const { connector, token } = await service.getDecryptedConnector(ORG_ID, "google_drive")
      expect(connector.id).toBe("conn-gdrive-1")
      expect(connector.source).toBe("google_drive")
      expect(token).toBe(GDRIVE_TOKEN)
    })

    it("throws clear error when connector source is not found in workspace", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      await expect(service.getDecryptedConnector("unknown-org", "google_drive")).rejects.toThrow(
        "No connector configured for 'google_drive' in this workspace.",
      )
    })

    it("throws error when connector status is revoked", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      await expect(service.getDecryptedConnector(ORG_ID, "jira" as any)).rejects.toThrow(
        "Connector 'Revoked Jira' is currently revoked.",
      )
    })

    it("enforces agent grant authorization, rejecting agents without an explicit grant", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      await expect(
        service.getAgentScope(UNAUTHORIZED_AGENT_ID, "conn-gdrive-1"),
      ).rejects.toThrow("Access Denied: This agent is not granted access to this connector.")
    })
  })

  // ── 2. Google Drive Flow ───────────────────────────────────────────────────
  describe("Google Drive Flow", () => {
    it("searches Google Drive files with decrypted bearer token and scopes query to allowed folders", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      const results = await service.searchGoogleDrive({
        agentId: AGENT_ID,
        orgId: ORG_ID,
        query: "Roadmap",
        limit: 5,
      })

      expect(results).toHaveLength(2)
      expect(results[0].title).toBe("Q4 Roadmap")
      expect(results[0].source).toBe("google_drive")
      expect(results[0].metadata.mimeType).toBe("application/vnd.google-apps.document")
      expect(results[0].metadata.author).toBe("Alice Product")

      // Verify decrypted bearer token was passed in Authorization header
      const searchReq = interceptedRequests.find((r) =>
        r.url.startsWith("https://www.googleapis.com/drive/v3/files?"),
      )
      expect(searchReq).toBeDefined()
      expect(searchReq?.headers["authorization"]).toBe(`Bearer ${GDRIVE_TOKEN}`)

      // Verify scope enforcement: allowedFolders clauses injected into search query q
      const url = new URL(searchReq!.url)
      const q = url.searchParams.get("q")
      expect(q).toContain("'folder-roadmaps-101' in parents")
      expect(q).toContain("'folder-designs-202' in parents")
    })

    it("reads Google Doc and exports as text/plain using decrypted token", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      const doc = await service.readGoogleDriveFile({
        agentId: AGENT_ID,
        orgId: ORG_ID,
        fileId: "doc-123",
      })

      expect(doc.id).toBe("doc-123")
      expect(doc.title).toBe("Q4 Roadmap")
      expect(doc.content).toContain("# Q4 Roadmap Document")
      expect(doc.content).toContain("Build Connector Mesh")

      const exportReq = interceptedRequests.find((r) =>
        r.url.includes("/files/doc-123/export?mimeType=text/plain"),
      )
      expect(exportReq).toBeDefined()
      expect(exportReq?.headers["authorization"]).toBe(`Bearer ${GDRIVE_TOKEN}`)
    })

    it("reads Google Sheet and exports as text/csv using decrypted token", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      const doc = await service.readGoogleDriveFile({
        agentId: AGENT_ID,
        orgId: ORG_ID,
        fileId: "sheet-456",
      })

      expect(doc.id).toBe("sheet-456")
      expect(doc.title).toBe("Growth Metrics")
      expect(doc.content).toContain("Metric,Oct,Nov")
      expect(doc.content).toContain("ActiveUsers,12000,18500")

      const exportReq = interceptedRequests.find((r) =>
        r.url.includes("/files/sheet-456/export?mimeType=text/csv"),
      )
      expect(exportReq).toBeDefined()
      expect(exportReq?.headers["authorization"]).toBe(`Bearer ${GDRIVE_TOKEN}`)
    })
  })

  // ── 3. Slack Flow ──────────────────────────────────────────────────────────
  describe("Slack Flow", () => {
    it("searches Slack messages, scopes by allowed channels, and resolves user mentions", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      const results = await service.searchSlack({
        agentId: AGENT_ID,
        orgId: ORG_ID,
        query: "database migrations",
      })

      expect(results).toHaveLength(1)
      expect(results[0].source).toBe("slack")
      // User mention <@U111> should be resolved to @alice and <@U222> to @charlie
      expect(results[0].content).toContain("Hey @alice, can you check PR from @charlie?")
      expect(results[0].metadata.author).toBe("@alice")

      // Verify Slack bearer token authentication
      const searchReq = interceptedRequests.find((r) =>
        r.url.startsWith("https://slack.com/api/search.messages"),
      )
      expect(searchReq).toBeDefined()
      expect(searchReq?.headers["authorization"]).toBe(`Bearer ${SLACK_TOKEN}`)

      // Verify channel scoping filter
      const url = new URL(searchReq!.url)
      const q = url.searchParams.get("query")
      expect(q).toContain("in:C01_general")
      expect(q).toContain("in:C02_eng")
    })

    it("blocks search when explicit channel parameter is outside allowed channels", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      await expect(
        service.searchSlack({
          agentId: AGENT_ID,
          orgId: ORG_ID,
          query: "secret discussion",
          channel: "C99_confidential",
        }),
      ).rejects.toThrow("Channel 'C99_confidential' is outside this agent's allowed channels")
    })

    it("reads Slack thread with user resolution and rejects access to unauthorized channels", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      // 1. Unauthorized channel rejection
      await expect(
        service.readSlackThread({
          agentId: AGENT_ID,
          orgId: ORG_ID,
          channelId: "C99_confidential",
          threadTs: "1700000000.000100",
        }),
      ).rejects.toThrow("Access Denied: Agent is not granted access to channel C99_confidential")

      // 2. Authorized channel thread read
      const thread = await service.readSlackThread({
        agentId: AGENT_ID,
        orgId: ORG_ID,
        channelId: "C01_general",
        threadTs: "1700000000.000100",
      })

      expect(thread.id).toBe("slack-thread-C01_general-1700000000.000100")
      expect(thread.metadata.replyCount).toBe(2)
      expect(thread.content).toContain("**@alice**")
      expect(thread.content).toContain("**@charlie**")
      expect(thread.content).toContain("Agreed, let us ping @alice for schema review")
    })
  })

  // ── 4. GitHub Flow ─────────────────────────────────────────────────────────
  describe("GitHub Flow", () => {
    it("searches code scoped to allowed repositories with decrypted GitHub token", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      const results = await service.searchGitHubCode({
        agentId: AGENT_ID,
        orgId: ORG_ID,
        query: "SECRETS_VERSION",
      })

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe("crypto.ts (sayalabs/core-engine)")
      expect(results[0].metadata.repo).toBe("sayalabs/core-engine")

      const searchReq = interceptedRequests.find((r) =>
        r.url.startsWith("https://api.github.com/search/code"),
      )
      expect(searchReq).toBeDefined()
      expect(searchReq?.headers["authorization"]).toBe(`Bearer ${GITHUB_TOKEN}`)
      expect(searchReq?.headers["accept"]).toBe("application/vnd.github.v3+json")

      // Verify repo scoping filter
      const url = new URL(searchReq!.url)
      const q = url.searchParams.get("q")
      expect(q).toContain("repo:sayalabs/core-engine")
      expect(q).toContain("repo:sayalabs/web-app")
    })

    it("reads GitHub file and decodes base64 content, rejecting unauthorized repos", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      // 1. Unauthorized repo rejection
      await expect(
        service.readGitHubFile({
          agentId: AGENT_ID,
          orgId: ORG_ID,
          repo: "sayalabs/private-infra",
          path: "src/crypto.ts",
        }),
      ).rejects.toThrow("Access Denied: Agent is not granted access to repository sayalabs/private-infra")

      // 2. Authorized file read
      const file = await service.readGitHubFile({
        agentId: AGENT_ID,
        orgId: ORG_ID,
        repo: "sayalabs/core-engine",
        path: "src/crypto.ts",
      })

      expect(file.title).toBe("crypto.ts (sayalabs/core-engine)")
      expect(file.content).toContain('export const SECRETS_VERSION = "2.0";')
      expect(file.content).toContain("export function verify() { return true; }")
    })

    it("reads GitHub Issue or PR with full discussion comments, rejecting unauthorized repos", async () => {
      const service = new ConnectorService({
        db: mockDb,
        kek: TEST_KEK,
        fetchFn: mockFetch,
      })

      // 1. Unauthorized repo rejection
      await expect(
        service.readGitHubIssue({
          agentId: AGENT_ID,
          orgId: ORG_ID,
          repo: "sayalabs/secret-billing",
          issueNumber: 42,
        }),
      ).rejects.toThrow("Access Denied: Agent is not granted access to repository sayalabs/secret-billing")

      // 2. Authorized issue read
      const issue = await service.readGitHubIssue({
        agentId: AGENT_ID,
        orgId: ORG_ID,
        repo: "sayalabs/core-engine",
        issueNumber: 42,
      })

      expect(issue.title).toBe("Pull Request #42: Implement connector rate-limiter backoff")
      expect(issue.content).toContain("**Author:** @founder")
      expect(issue.content).toContain("Need exponential backoff and jitter on 429 and 503 errors.")
      expect(issue.content).toContain("**@reviewer-1**")
      expect(issue.content).toContain("Reviewed the fix, looks solid and tests pass.")
      expect(issue.metadata.state).toBe("closed")
    })
  })

  // ── 5. Security & Redaction Contract ───────────────────────────────────────
  describe("Security & Redaction Contracts", () => {
    it("ensures secrets encrypted or sealed with @sayabot/llm never expose plaintext in DB or serialization", () => {
      const sensitiveToken = "ghp_mocksensitivetoken01234567890abcdefghijklmnopqrstuvwxyz"
      const encrypted = encryptSecret(sensitiveToken, TEST_KEK)

      expect(encrypted.ciphertext).not.toContain(sensitiveToken)
      expect(encrypted.iv).not.toContain(sensitiveToken)
      expect(encrypted.tag).not.toContain(sensitiveToken)

      const decrypted = decryptSecret(encrypted, TEST_KEK)
      expect(decrypted).toBe(sensitiveToken)

      const sealed = sealSecret(sensitiveToken, TEST_KEK)
      expect(sealed).not.toContain(sensitiveToken)
      expect(openSecret(sealed, TEST_KEK)).toBe(sensitiveToken)

      // Verify that DB row representation doesn't leak plaintext
      const dbRowJson = JSON.stringify(mockConnectors)
      expect(dbRowJson).not.toContain(GDRIVE_TOKEN)
      expect(dbRowJson).not.toContain(SLACK_TOKEN)
      expect(dbRowJson).not.toContain(GITHUB_TOKEN)
    })

    it("verifies connector secrets pass through @sayabot/core redaction without leaking tokens", () => {
      // 1. Slack token redaction
      const slackLeak = `Connected with bot token ${SLACK_TOKEN}`
      const slackRedacted = redactSecrets(slackLeak)
      expect(slackRedacted.text).not.toContain(SLACK_TOKEN)
      expect(slackRedacted.text).toContain("[REDACTED:slack_token]")

      // 2. GitHub token redaction
      const ghLeak = `GitHub PAT configured: ${GITHUB_TOKEN}`
      const ghRedacted = redactSecrets(ghLeak)
      expect(ghRedacted.text).not.toContain(GITHUB_TOKEN)
      expect(ghRedacted.text).toContain("[REDACTED:github_token]")

      // 3. Exact scrubber for custom secrets
      const scrubber = createRunScrubber([GDRIVE_TOKEN])
      const scrubbed = scrubber(`Bearer ${GDRIVE_TOKEN} sent to Google API`)
      expect(scrubbed).not.toContain(GDRIVE_TOKEN)
      expect(scrubbed).toContain("[REDACTED:secret]")
    })
  })

  // ── 6. Rate Limiter Backoff & Retry ────────────────────────────────────────
  describe("Rate Limiter Backoff and Retry", () => {
    it("returns immediate successful response without retrying", async () => {
      let callCount = 0
      const testFetch = vi.fn(async () => {
        callCount++
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      })

      const res = await fetchWithRetry("https://example.com/api", {}, { fetchFn: testFetch })
      expect(res.status).toBe(200)
      expect(callCount).toBe(1)
    })

    it("retries on HTTP 429 rate limit using Retry-After header and succeeds on next attempt", async () => {
      let callCount = 0
      const testFetch = vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "retry-after": "0" },
          })
        }
        return new Response(JSON.stringify({ data: "success" }), { status: 200 })
      })

      const res = await fetchWithRetry(
        "https://api.github.com/rate-limited",
        {},
        { maxRetries: 2, baseDelayMs: 1, fetchFn: testFetch },
      )

      expect(res.status).toBe(200)
      expect(callCount).toBe(2)
      const data = await res.json()
      expect(data.data).toBe("success")
    })

    it("retries on HTTP 503 transient error and succeeds", async () => {
      let callCount = 0
      const testFetch = vi.fn(async () => {
        callCount++
        if (callCount <= 2) {
          return new Response("Service Unavailable", { status: 503 })
        }
        return new Response(JSON.stringify({ status: "recovered" }), { status: 200 })
      })

      const res = await fetchWithRetry(
        "https://slack.com/api/transient",
        {},
        { maxRetries: 3, baseDelayMs: 1, fetchFn: testFetch },
      )

      expect(res.status).toBe(200)
      expect(callCount).toBe(3)
    })

    it("stops and returns error response after exhausting maxRetries on continuous 429/503", async () => {
      let callCount = 0
      const testFetch = vi.fn(async () => {
        callCount++
        return new Response("Persistent Rate Limit", {
          status: 429,
          headers: { "retry-after": "0" },
        })
      })

      const res = await fetchWithRetry(
        "https://api.github.com/persistent-limit",
        {},
        { maxRetries: 2, baseDelayMs: 1, fetchFn: testFetch },
      )

      // 1 initial attempt + 2 retries = 3 attempts total
      expect(callCount).toBe(3)
      expect(res.status).toBe(429)
    })

    it("retries transient network exceptions before succeeding", async () => {
      let callCount = 0
      const testFetch = vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          throw new Error("ECONNRESET: socket hang up")
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      })

      const res = await fetchWithRetry(
        "https://example.com/network-flaky",
        {},
        { maxRetries: 2, baseDelayMs: 1, fetchFn: testFetch },
      )

      expect(callCount).toBe(2)
      expect(res.status).toBe(200)
    })

    it("does not retry on AbortError, bubbling the error immediately", async () => {
      let callCount = 0
      const testFetch = vi.fn(async () => {
        callCount++
        const err = new Error("The operation was aborted")
        err.name = "AbortError"
        throw err
      })

      await expect(
        fetchWithRetry(
          "https://example.com/aborted",
          {},
          { maxRetries: 3, baseDelayMs: 1, fetchFn: testFetch },
        ),
      ).rejects.toThrow("The operation was aborted")

      expect(callCount).toBe(1)
    })
  })
})
