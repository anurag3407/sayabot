/**
 * End-to-end connector coverage against a **real local HTTP server** (no `fetch` mocking).
 *
 * Every native source is driven through the same path a room uses: `connectorTools` /
 * `storageTools` → `ConnectorService` (grant + scope enforcement, KEK decryption) → the vendor
 * client → the stub server standing in for the vendor. The stub records request paths and query
 * strings so the tests can assert *what was asked of the vendor*, not only what came back.
 *
 * The database boundary is an in-memory fake built on Drizzle's own SQL dialect, so the queries
 * the service issues are the real ones.
 */

import { createServer, type Server } from "node:http"
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { encryptSecret } from "@sayabot/llm"
import {
  agentConnectorGrants,
  messages,
  messagingInbound,
  workspaceConnectors,
  type AgentConnectorGrantRow,
  type WorkspaceConnectorRow,
} from "@sayabot/db"
import {
  ConnectorService,
  setConnectorService,
} from "../../apps/orchestrator/src/connectors/service"
import { connectorTools } from "../../apps/orchestrator/src/tools/builtins/connectors"
import { storageTools } from "../../apps/orchestrator/src/tools/builtins/storage"

const KEK = Buffer.alloc(32, 7).toString("base64")
const ORG = "00000000-0000-0000-0000-0000000000aa"
const AGENT = "00000000-0000-0000-0000-0000000000bb"
const ROOM = "00000000-0000-0000-0000-0000000000cc"

interface InboundRecord {
  connectorId: string
  externalId: string
  content: string
  metadata: Record<string, unknown>
  createdAt: Date
}

// ── Stub vendor server ───────────────────────────────────────────────────────

interface StubState {
  requests: { method: string; path: string; query: string; body: string }[]
  telegramWebhook: boolean
}

function startStub(): Promise<{ server: Server; origin: string; state: StubState }> {
  const state: StubState = { requests: [], telegramWebhook: false }

  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => {
      body += chunk.toString()
    })
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      state.requests.push({
        method: req.method ?? "GET",
        path: url.pathname,
        query: url.search,
        body,
      })

      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" })
        res.end(JSON.stringify(value))
      }
      const text = (value: string, status = 200) => {
        res.writeHead(status, { "Content-Type": "text/plain" })
        res.end(value)
      }
      const xml = (value: string) => {
        res.writeHead(200, { "Content-Type": "application/xml" })
        res.end(value)
      }
      const path = url.pathname

      // ── Google Drive ──
      if (path === "/drive/v3/about") return json({ user: { emailAddress: "ops@acme.test" } })
      if (path.endsWith("/export")) {
        return text(
          url.searchParams.get("mimeType") === "text/csv"
            ? "metric,value\nusers,12"
            : "# Roadmap\n- ship it",
        )
      }
      if (path === "/drive/v3/files/file-1")
        return json({
          id: "file-1",
          name: "Roadmap",
          mimeType: "application/vnd.google-apps.document",
          webViewLink: "https://docs.test/file-1",
        })
      if (path === "/drive/v3/files/raw-1")
        return json({
          id: "raw-1",
          name: "notes.txt",
          mimeType: "text/plain",
          webViewLink: "https://docs.test/raw-1",
        })
      if (path === "/drive/v3/files")
        return json({
          files: [
            {
              id: "file-1",
              name: "Roadmap",
              mimeType: "application/vnd.google-apps.document",
              webViewLink: "https://docs.test/file-1",
              modifiedTime: "2026-11-01T00:00:00Z",
              owners: [{ displayName: "Ops", emailAddress: "ops@acme.test" }],
            },
          ],
        })

      // ── Slack ──
      if (path === "/api/auth.test") return json({ ok: true, team: "Acme", user: "sayabot" })
      // A bot token can't search: this forces the history fallback, the real bot-token path.
      if (path === "/api/search.messages")
        return json({ ok: false, error: "not_allowed_token_type" })
      if (path === "/api/conversations.list")
        return json({
          ok: true,
          channels: [
            { id: "C1", name: "general" },
            { id: "C2", name: "security" },
          ],
        })
      if (path === "/api/conversations.history")
        return json({
          ok: true,
          messages: [{ user: "U1", text: "deploy is green", ts: "1700000000.000100" }],
        })
      if (path === "/api/conversations.replies")
        return json({
          ok: true,
          messages: [
            { user: "U1", text: "starting the thread", ts: "1700000000.000100" },
            { user: "U1", text: "second reply", ts: "1700000000.000200" },
          ],
        })
      if (path === "/api/users.info")
        return json({ ok: true, user: { real_name: "Alice", profile: { display_name: "alice" } } })
      if (path === "/api/chat.postMessage")
        return json({ ok: true, ts: "1700000000.000900", channel: "C1" })

      // ── GitHub ──
      if (path === "/user") return json({ login: "octocat" })
      if (path === "/search/code")
        return json({
          items: [
            {
              name: "a.ts",
              path: "src/a.ts",
              html_url: "https://github.test/src/a.ts",
              repository: { full_name: "acme/app" },
            },
          ],
        })
      if (path === "/repos/acme/app/contents/src/a.ts")
        return json({
          name: "a.ts",
          path: "src/a.ts",
          encoding: "base64",
          content: Buffer.from("export const ok = true").toString("base64"),
          html_url: "https://github.test/src/a.ts",
          size: 21,
        })
      if (path === "/repos/acme/app/issues/7/comments")
        return json([{ user: { login: "rev" }, body: "lgtm", created_at: "2026-11-02T00:00:00Z" }])
      if (path === "/repos/acme/app/issues/7")
        return json({
          number: 7,
          title: "Fix the thing",
          body: "please",
          state: "open",
          html_url: "https://github.test/issues/7",
          user: { login: "alice" },
          created_at: "2026-11-01T00:00:00Z",
          labels: [{ name: "bug" }],
        })

      // ── Discord ──
      if (path === "/users/@me") return json({ id: "1", username: "sayabot" })
      if (path === "/guilds/123456/channels")
        return json([
          { id: "22222", name: "general", type: 0 },
          { id: "33333", name: "private", type: 0 },
        ])
      if (path === "/channels/22222/messages" && req.method === "GET")
        return json([
          {
            id: "900",
            content: "hello from discord",
            timestamp: "2026-11-03T00:00:00Z",
            author: { username: "alice" },
          },
        ])
      if (path === "/channels/22222/messages" && req.method === "POST")
        return json({ id: "901", channel_id: "22222", guild_id: "123456" })

      // ── Telegram ──
      if (path.endsWith("/getMe"))
        return json({ ok: true, result: { id: 7, username: "sayabot_bot" } })
      if (path.endsWith("/getUpdates")) {
        if (state.telegramWebhook) {
          return json(
            {
              ok: false,
              description: "Conflict: can't use getUpdates method while webhook is active",
            },
            409,
          )
        }
        return json({
          ok: true,
          result: [
            {
              update_id: 1,
              message: {
                message_id: 55,
                date: 1_760_000_000,
                text: "can you check the deploy?",
                chat: { id: 42, title: "Team" },
                from: { username: "alice" },
              },
            },
          ],
        })
      }
      if (path.endsWith("/sendMessage")) return json({ ok: true, result: { message_id: 56 } })

      // ── WhatsApp ──
      if (path.startsWith("/v21.0/106540352242922/messages"))
        return json({ messages: [{ id: "wamid.1" }] })
      if (path === "/v21.0/106540352242922")
        return json({ display_phone_number: "+1 415 555 0123", verified_name: "Acme" })

      // ── 1Password Connect ──
      if (path === "/connect/v1/vaults") return json([{ id: "v1", name: "Work" }])
      if (path === "/connect/v1/vaults/v1/items") return json([{ id: "i1", title: "AWS prod" }])
      if (path === "/connect/v1/vaults/v1/items/i1")
        return json({
          id: "i1",
          title: "AWS prod",
          fields: [{ label: "password", value: "hunter2" }],
        })

      // ── Bitwarden Secrets Manager ──
      if (path === "/bw/public/secrets") return json({ data: [{ id: "s1", key: "AWS_KEY" }] })
      if (path === "/bw/public/secrets/s1")
        return json({ id: "s1", key: "AWS_KEY", value: "hunter3" })

      // ── Hugging Face ──
      if (path === "/hf/api/whoami-v2") return json({ name: "acme" })
      if (
        path === "/hf/api/datasets/acme/data/tree/main/" ||
        path === "/hf/api/datasets/acme/data/tree/main/reports/"
      )
        return json([
          { path: "reports/a.md", size: 5, type: "file" },
          { path: "reports", size: 0, type: "directory" },
        ])
      if (path === "/hf/datasets/acme/data/resolve/main/reports/a.md") return text("# hi")
      if (path === "/hf/api/datasets/acme/data/commit/main") return json({ commitOid: "abcdef" })

      // ── Composio connected apps ──
      if (path === "/composio/toolkits")
        return json({
          items: [
            { slug: "gmail", name: "Gmail", meta: { description: "Email" } },
            { slug: "notion", name: "Notion", meta: { description: "Docs" } },
          ],
          total_items: 2,
        })
      if (path === "/composio/tools")
        return json({
          items:
            url.searchParams.get("toolkit_slug") === "gmail"
              ? [
                  { slug: "GMAIL_FETCH_EMAILS", name: "Fetch emails", description: "Search Gmail" },
                  { slug: "GMAIL_SEND_EMAIL", name: "Send email", description: "Send mail" },
                ]
              : [{ slug: "NOTION_CREATE_PAGE", name: "Create page", description: "Write a page" }],
        })
      if (path === "/composio/connected_accounts")
        return json({
          items: [{ id: "ca_1", status: "ACTIVE", toolkit: { slug: "gmail" } }],
        })
      if (path === "/composio/connected_accounts/link") {
        return json({ redirect_url: "https://connect.composio.dev/link/abc123" })
      }
      const composioExecute = path.match(/^\/composio\/tools\/execute\/([A-Z0-9_]+)$/)
      if (composioExecute) return json({ successful: true, data: { ran: composioExecute[1] } })

      // ── Supabase Storage ──
      if (path === "/supa/storage/v1/object/list/docs")
        return json([
          {
            name: "report.md",
            updated_at: "2026-11-04T00:00:00Z",
            metadata: { size: 4, mimetype: "text/markdown" },
          },
        ])
      if (path === "/supa/storage/v1/object/docs/reports/report.md" && req.method === "GET")
        return text("data")
      if (path.startsWith("/supa/storage/v1/object/docs/reports/") && req.method === "POST")
        return json({ Key: "docs/reports/report.md" })
      if (path === "/supa/storage/v1/object/docs" && req.method === "DELETE") return json([])
      if (path === "/supa/storage/v1/bucket") return json([{ id: "docs" }])

      // ── S3-compatible (R2 / B2 / MinIO all use path-style against an IP endpoint) ──
      const s3 = path.match(/^\/s3\/([^/]+)(\/.*)?$/)
      if (s3) {
        const key = (s3[2] ?? "/").slice(1)
        if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
          return xml(
            `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
              `<Name>${s3[1]}</Name><KeyCount>1</KeyCount><MaxKeys>30</MaxKeys><IsTruncated>false</IsTruncated>` +
              `<Contents><Key>artifact.txt</Key><LastModified>2026-11-05T00:00:00.000Z</LastModified><ETag>"x"</ETag><Size>2</Size><StorageClass>STANDARD</StorageClass></Contents>` +
              `</ListBucketResult>`,
          )
        }
        if (req.method === "GET") return text("s3")
        if (req.method === "PUT") {
          res.writeHead(200, { ETag: '"abc"' })
          return res.end()
        }
        if (req.method === "DELETE") {
          res.writeHead(204)
          return res.end()
        }
      }

      return json({ error: "not_found", path }, 404)
    })
  })

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      resolve({ server, origin: `http://127.0.0.1:${port}`, state })
    })
  })
}

// ── In-memory database (real Drizzle SQL) ────────────────────────────────────

interface FakeRecords {
  connectors: WorkspaceConnectorRow[]
  grants: AgentConnectorGrantRow[]
  inbound: InboundRecord[]
}

function columnChecks(dialect: PgDialect, cond: unknown): { column: string; value: unknown }[] {
  const { sql, params } = dialect.sqlToQuery(cond as never)
  const checks: { column: string; value: unknown }[] = []
  const pattern = /"([a-z_]+)"\s*=\s*\$(\d+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)))
    checks.push({ column: match[1], value: params[Number(match[2]) - 1] })
  return checks
}

function createFakeDb(records: FakeRecords) {
  const dialect = new PgDialect()

  const grantView = (grant: AgentConnectorGrantRow) => ({
    id: grant.id,
    org_id: grant.orgId,
    agent_id: grant.agentId,
    connector_id: grant.connectorId,
  })
  const connectorView = (connector: WorkspaceConnectorRow) => ({
    id: connector.id,
    org_id: connector.orgId,
    source: connector.source,
    status: connector.status,
  })

  function execute(state: {
    table: unknown
    joined?: unknown
    cond?: unknown
    limit?: number
    shape?: Record<string, unknown>
  }): unknown[] {
    const checks = state.cond ? columnChecks(dialect, state.cond) : []
    const matches = (view: Record<string, unknown>) =>
      checks.every((check) => view[check.column] === check.value)

    // agent_connector_grants ⋈ workspace_connectors
    if (state.table === agentConnectorGrants && state.joined === workspaceConnectors) {
      const rows = records.grants.flatMap((grant) => {
        const connector = records.connectors.find((row) => row.id === grant.connectorId)
        if (!connector) return []
        const view = { ...connectorView(connector), ...grantView(grant) }
        if (!matches(view)) return []
        return [{ connector }]
      })
      return rows.slice(0, state.limit ?? rows.length)
    }

    // messaging_inbound ⋈ messages
    if (state.table === messagingInbound && state.joined === messages) {
      const rows = records.inbound
        .filter((row) => matches({ connector_id: row.connectorId }))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .flatMap((row) => [
          {
            externalId: row.externalId,
            content: row.content,
            metadata: row.metadata,
            createdAt: row.createdAt,
          },
        ])
      return rows.slice(0, state.limit ?? rows.length)
    }

    if (state.table === workspaceConnectors) {
      return records.connectors
        .filter((row) => matches(connectorView(row)))
        .slice(0, state.limit ?? Infinity)
    }
    if (state.table === agentConnectorGrants) {
      return records.grants
        .filter((row) => matches(grantView(row)))
        .slice(0, state.limit ?? Infinity)
    }
    return []
  }

  function builder(state: {
    table: unknown
    joined?: unknown
    cond?: unknown
    limit?: number
    shape?: Record<string, unknown>
  }): unknown {
    const chain = {
      where: (cond: unknown) => builder({ ...state, cond }),
      innerJoin: (table: unknown) => builder({ ...state, joined: table }),
      orderBy: () => chain,
      limit: (limit: number) => builder({ ...state, limit }),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(execute(state)).then(resolve, reject),
    }
    return chain
  }

  return {
    select: (shape?: Record<string, unknown>) => ({
      from: (table: unknown) => builder({ table, shape }),
    }),
  }
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe("connectors end to end against a stub vendor", () => {
  let stub: Awaited<ReturnType<typeof startStub>>
  let fakeBinDir = ""
  let originalPath = ""
  let records: FakeRecords

  const row = (
    source: string,
    id: string,
    config: Record<string, unknown> = {},
    token = `token-${source}`,
  ): WorkspaceConnectorRow => {
    const sealed = encryptSecret(token, KEK)
    return {
      id,
      orgId: ORG,
      ownerUserId: "user-1",
      source,
      name: `${source} connector`,
      status: "active",
      authType: "token",
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      tag: sealed.tag,
      last4: "test",
      config,
      lastSyncedAt: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as WorkspaceConnectorRow
  }

  const grant = (
    id: string,
    connectorId: string,
    scopeConfig: Record<string, unknown>,
  ): AgentConnectorGrantRow =>
    ({
      id,
      orgId: ORG,
      agentId: AGENT,
      connectorId,
      scopeConfig,
      createdAt: new Date(),
    }) as AgentConnectorGrantRow

  function service() {
    return new ConnectorService({
      db: createFakeDb(records),
      kek: KEK,
      endpoints: {
        google_drive: stub.origin,
        slack: stub.origin,
        github: stub.origin,
        discord: stub.origin,
        telegram: stub.origin,
        whatsapp: `${stub.origin}/v21.0`,
        onepassword: `${stub.origin}/connect`,
        bitwarden: `${stub.origin}/bw`,
        huggingface: `${stub.origin}/hf`,
        composio: `${stub.origin}/composio`,
      },
    })
  }

  beforeAll(async () => {
    stub = await startStub()
    fakeBinDir = mkdtempSync(join(tmpdir(), "saaya-bin-"))
    const passCli = join(fakeBinDir, "pass-cli")
    writeFileSync(
      passCli,
      `#!/bin/sh
if [ "$1" = "item" ] && [ "$2" = "list" ]; then echo '[{"id":"p1","name":"Bank"}]'; exit 0; fi
if [ "$1" = "item" ] && [ "$2" = "view" ]; then echo '{"id":"p1","name":"Bank","note":"1234"}'; exit 0; fi
echo '{}'
`,
    )
    chmodSync(passCli, 0o755)
    originalPath = process.env.PATH ?? ""
    process.env.PATH = `${fakeBinDir}:${originalPath}`
  })

  afterAll(() => {
    process.env.PATH = originalPath
    stub?.server.close()
  })

  beforeEach(() => {
    setConnectorService(null)
    stub.state.requests.length = 0
    stub.state.telegramWebhook = false
    records = {
      connectors: [
        row("google_drive", "conn-gdrive"),
        row("slack", "conn-slack"),
        row("github", "conn-github", { defaultOrg: "acme" }),
        row("discord", "conn-discord", { guildId: "123456" }),
        row(
          "telegram",
          "conn-telegram",
          { inbound: { enabled: true, roomId: ROOM, agentId: AGENT } },
          "111:AAAAAAAAAAAAAAAAAAAAAAAA",
        ),
        row("whatsapp", "conn-whatsapp", { phoneNumberId: "106540352242922" }),
        row("onepassword", "conn-op", { authMode: "api", connectUrl: `${stub.origin}/connect` }),
        row("bitwarden", "conn-bw", { authMode: "api", apiBaseUrl: `${stub.origin}/bw` }),
        row("protonpass", "conn-pp", { authMode: "computer" }),
        row("supabase", "conn-supa", { projectUrl: `${stub.origin}/supa`, bucket: "docs" }),
        row("cloudflare_r2", "conn-r2", {
          endpoint: `${stub.origin}/s3`,
          accessKeyId: "key",
          bucket: "artifacts",
        }),
      ],
      grants: [
        grant("grant-gdrive", "conn-gdrive", { allowedFolders: ["folder-1"] }),
        grant("grant-slack", "conn-slack", { allowedChannels: ["general"] }),
        grant("grant-github", "conn-github", { allowedRepos: ["acme/app"] }),
        grant("grant-discord", "conn-discord", { allowedChannels: ["22222"] }),
        grant("grant-telegram", "conn-telegram", { allowedChannels: ["42"] }),
        grant("grant-whatsapp", "conn-whatsapp", { allowedRecipients: ["+14155550123"] }),
        grant("grant-op", "conn-op", {}),
        grant("grant-bw", "conn-bw", {}),
        grant("grant-pp", "conn-pp", {}),
        grant("grant-supa", "conn-supa", { allowedPrefixes: ["reports/"] }),
      ],
      inbound: [],
    }
    setConnectorService(service())
  })

  const tool = (name: string, sources: string[]) => {
    const specs = connectorTools({
      orgId: ORG,
      agentId: AGENT,
      roomId: ROOM,
      sources: sources as never,
    })
    const spec = specs.find((candidate) => candidate.name === name)
    if (!spec) throw new Error(`tool ${name} not registered`)
    return spec
  }

  // ── Google Drive ──
  it("google_drive: folder-scoped search reaches the vendor with an ancestors filter", async () => {
    setConnectorService(service())
    const search = tool("gdrive_search", ["google_drive"])
    const result = (await search.execute({ query: "roadmap", limit: 5 })) as {
      count: number
      files: { id: string; title: string }[]
    }
    expect(result.count).toBe(1)
    expect(result.files[0]?.title).toBe("Roadmap")

    const call = stub.state.requests.find((request) => request.path === "/drive/v3/files")
    const driveQuery = new URLSearchParams(call?.query ?? "").get("q") ?? ""
    expect(driveQuery).toContain("'folder-1' in ancestors")

    const read = tool("gdrive_read_file", ["google_drive"])
    const doc = (await read.execute({ file_id: "file-1" })) as { content: string }
    expect(doc.content).toContain("ship it")
  })

  // ── Slack ──
  it("slack: name-scoped grant reads a thread by channel id and posts", async () => {
    const client = service()
    setConnectorService(client)

    // The grant says "general"; the agent passes the id it got from search results.
    const search = tool("slack_search", ["slack"])
    const found = (await search.execute({ query: "deploy" })) as {
      count: number
      messages: { channel: string }[]
    }
    expect(found.count).toBe(1)
    expect(found.messages[0]?.channel).toBe("#general")

    const thread = tool("slack_read_thread", ["slack"])
    const discussion = (await thread.execute({
      channel_id: "C1",
      thread_ts: "1700000000.000100",
    })) as {
      discussion: string
    }
    expect(discussion.discussion).toContain("second reply")

    const send = tool("slack_send_message", ["slack"])
    expect(send.dangerous).toBe(true)
    const sent = (await send.execute({ channel: "general", text: "shipped" })) as {
      ok: boolean
      ts: string
    }
    expect(sent.ts).toBe("1700000000.000900")

    // A channel outside the grant is refused before any vendor call.
    await expect(thread.execute({ channel_id: "C2", thread_ts: "1.1" })).rejects.toThrow(
      /outside this agent's allowed list/i,
    )
  })

  it("slack: a read-only grant refuses to post", async () => {
    records.grants = records.grants.map((entry) =>
      entry.connectorId === "conn-slack" ? { ...entry, scopeConfig: { readOnly: true } } : entry,
    )
    setConnectorService(service())
    const send = tool("slack_send_message", ["slack"])
    await expect(send.execute({ channel: "general", text: "nope" })).rejects.toThrow(/read-only/i)
  })

  // ── GitHub ──
  it("github: repo allowlist gates reads and the connector's default org scopes search", async () => {
    setConnectorService(service())
    const file = tool("github_get_file", ["github"])
    const content = (await file.execute({ repo: "acme/app", path: "src/a.ts", ref: "main" })) as {
      content: string
    }
    expect(content.content).toBe("export const ok = true")

    const issue = tool("github_get_issue_or_pr", ["github"])
    const pr = (await issue.execute({ repo: "acme/app", issue_number: 7 })) as {
      content: string
      metadata: { labels: string[] }
    }
    expect(pr.content).toContain("Fix the thing")
    expect(pr.metadata.labels).toEqual(["bug"])

    await expect(file.execute({ repo: "other/repo", path: "a.ts" })).rejects.toThrow(
      /not granted access/i,
    )

    // defaultOrg applies to code search when the grant scopes no repos.
    records.grants = records.grants.map((entry) =>
      entry.connectorId === "conn-github" ? { ...entry, scopeConfig: {} } : entry,
    )
    setConnectorService(service())
    const search = tool("github_search_code", ["github"])
    await search.execute({ query: "verify", limit: 3 })
    const call = stub.state.requests.find((request) => request.path === "/search/code")
    expect(decodeURIComponent(call?.query ?? "")).toContain("org:acme")
  })

  // ── Discord ──
  it("discord: lists channels from the configured guild, reads, and posts through the scope", async () => {
    setConnectorService(service())
    const list = tool("discord_list_channels", ["discord"])
    const channels = (await list.execute({})) as { channels: { id: string; name: string }[] }
    expect(channels.channels).toEqual([{ id: "22222", name: "general" }])

    const read = tool("discord_read_messages", ["discord"])
    const readResult = (await read.execute({ channel_id: "22222", limit: 5 })) as {
      messages: { text: string }[]
    }
    expect(readResult.messages[0]?.text).toBe("hello from discord")

    const send = tool("discord_send_message", ["discord"])
    expect(send.dangerous).toBe(true)
    const sent = (await send.execute({ channel_id: "22222", content: "on it" })) as {
      ok: boolean
      id: string
    }
    expect(sent.id).toBe("901")

    await expect(read.execute({ channel_id: "33333", limit: 5 })).rejects.toThrow(
      /outside this agent's allowed list/i,
    )
  })

  // ── Telegram ──
  it("telegram: reads and sends, enforcing the chat allowlist", async () => {
    setConnectorService(service())
    const read = tool("telegram_read_messages", ["telegram"])
    const found = (await read.execute({ limit: 10 })) as {
      messages: { chatId: string; text: string }[]
    }
    expect(found.messages[0]?.chatId).toBe("42")
    expect(found.messages[0]?.text).toContain("check the deploy")

    const send = tool("telegram_send_message", ["telegram"])
    const sent = (await send.execute({ chat_id: "42", text: "looking" })) as {
      ok: boolean
      message_id: string
    }
    expect(sent.message_id).toBe("56")

    await expect(send.execute({ chat_id: "-100999", text: "x" })).rejects.toThrow(
      /outside this agent's allowed list/i,
    )
  })

  it("telegram: a bot with a webhook reads the messages already delivered to its room", async () => {
    stub.state.telegramWebhook = true
    records.inbound = [
      {
        connectorId: "conn-telegram",
        externalId: "77",
        content: "@sayabot alice says:\nplease review the PR",
        metadata: {
          inbound: {
            platform: "telegram",
            connectorId: "conn-telegram",
            chatId: "42",
            sender: "@alice",
          },
        },
        createdAt: new Date("2026-11-06T10:00:00Z"),
      },
    ]
    setConnectorService(service())

    const read = tool("telegram_read_messages", ["telegram"])
    const found = (await read.execute({ limit: 5 })) as {
      messages: { id: string; text: string; chatId: string; author: string }[]
    }
    expect(found.messages).toHaveLength(1)
    expect(found.messages[0]?.text).toBe("please review the PR")
    expect(found.messages[0]?.author).toBe("@alice")
    expect(found.messages[0]?.chatId).toBe("42")
    // The tool never falls back to a vendor call that Telegram would refuse.
    expect(stub.state.requests.some((request) => request.path.endsWith("/getUpdates"))).toBe(true)
  })

  // ── WhatsApp ──
  it("whatsapp: sends to an allowed number and rejects others", async () => {
    setConnectorService(service())
    const send = tool("whatsapp_send_message", ["whatsapp"])
    expect(send.dangerous).toBe(true)
    const sent = (await send.execute({ to: "+1 415 555 0123", text: "hi" })) as {
      ok: boolean
      message_id: string
    }
    expect(sent.message_id).toBe("wamid.1")

    const template = tool("whatsapp_send_template", ["whatsapp"])
    await expect(
      template.execute({ to: "+447700900123", template: "hello_world", language: "en_US" }),
    ).rejects.toThrow(/not one of the numbers/i)
  })

  // ── Password managers ──
  it("onepassword: searches and reveals through 1Password Connect", async () => {
    setConnectorService(service())
    const search = tool("onepassword_search", ["onepassword"])
    const found = (await search.execute({ query: "AWS" })) as {
      items: { id: string; title: string }[]
    }
    expect(found.items[0]).toEqual({ id: "i1", title: "AWS prod" })

    const read = tool("onepassword_read", ["onepassword"])
    expect(read.dangerous).toBe(true)
    const item = (await read.execute({ query: "i1", vault: "v1" })) as {
      fields: { value: string }[]
    }
    expect(item.fields[0]?.value).toBe("hunter2")
  })

  it("bitwarden: lists and reads secrets through the Secrets Manager API", async () => {
    setConnectorService(service())
    const search = tool("bitwarden_search", ["bitwarden"])
    const found = (await search.execute({ query: "AWS" })) as { items: { id: string }[] }
    expect(found.items[0]?.id).toBe("s1")

    const read = tool("bitwarden_read", ["bitwarden"])
    const item = (await read.execute({ query: "s1" })) as { value: string }
    expect(item.value).toBe("hunter3")
  })

  it("protonpass: runs the signed-in CLI on this computer", async () => {
    setConnectorService(service())
    const search = tool("protonpass_search", ["protonpass"])
    const found = (await search.execute({ query: "Bank" })) as {
      items: { id: string; title: string }[]
    }
    expect(found.items).toEqual([{ id: "p1", title: "Bank" }])

    const read = tool("protonpass_read", ["protonpass"])
    const item = (await read.execute({ query: "p1" })) as { note: string }
    expect(item.note).toBe("1234")
  })

  // ── Storage ──
  it("storage: the granted connector wins over another active provider, and its prefix is enforced", async () => {
    // R2 is active but not granted; the agent was granted Supabase, so supabase is the target.
    setConnectorService(service())
    const tools = await storageTools({ orgId: ORG, agentId: AGENT, roomId: ROOM })
    const list = tools.find((spec) => spec.name === "storage_list_files")!
    const listed = (await list.execute({ prefix: "reports/", limit: 5 })) as {
      provider: string
      files: { name: string }[]
    }
    expect(listed.provider).toBe("supabase")
    expect(listed.files[0]?.name).toBe("report.md")

    const read = tools.find((spec) => spec.name === "storage_read_file")!
    const file = (await read.execute({ path: "reports/report.md" })) as { content: string }
    expect(file.content).toBe("data")

    await expect(read.execute({ path: "private/secret.txt" })).rejects.toThrow(
      /outside this agent's allowed storage prefixes/i,
    )

    const upload = tools.find((spec) => spec.name === "storage_upload_file")!
    const uploaded = (await upload.execute({
      path: "reports/new.md",
      content: "x",
      contentType: "text/markdown",
    })) as {
      ok: boolean
    }
    expect(uploaded.ok).toBe(true)

    const remove = tools.find((spec) => spec.name === "storage_delete_file")!
    expect(remove.dangerous).toBe(true)
    await remove.execute({ path: "reports/new.md" })
  })

  it("storage: cloudflare_r2 runs list/read/upload/delete against the bucket endpoint", async () => {
    records.grants.push(grant("grant-r2", "conn-r2", { allowedPrefixes: ["logs/"] }))
    setConnectorService(service())
    const tools = await storageTools({
      orgId: ORG,
      agentId: AGENT,
      roomId: ROOM,
      preferredProvider: "cloudflare_r2",
    })
    const list = tools.find((spec) => spec.name === "storage_list_files")!
    const listed = (await list.execute({ prefix: "logs/", limit: 5 })) as {
      provider: string
      files: { path: string; size: number }[]
    }
    expect(listed.provider).toBe("cloudflare_r2")
    expect(listed.files[0]?.path).toBe("artifact.txt")

    const read = tools.find((spec) => spec.name === "storage_read_file")!
    expect(((await read.execute({ path: "logs/a.txt" })) as { content: string }).content).toBe("s3")

    const upload = tools.find((spec) => spec.name === "storage_upload_file")!
    await upload.execute({ path: "logs/b.txt", content: "y" })
    const remove = tools.find((spec) => spec.name === "storage_delete_file")!
    await remove.execute({ path: "logs/b.txt" })

    const s3Calls = stub.state.requests.filter((request) =>
      request.path.startsWith("/s3/artifacts"),
    )
    expect(s3Calls.map((call) => call.method).sort()).toEqual(["DELETE", "GET", "GET", "PUT"])
  })

  it("storage: backblaze_b2 and s3_storage use the same S3 path against their own endpoint", async () => {
    records.connectors.push(
      row("backblaze_b2", "conn-b2", {
        endpoint: `${stub.origin}/s3`,
        keyId: "key",
        bucket: "artifacts",
      }),
      row("s3_storage", "conn-s3", {
        endpoint: `${stub.origin}/s3`,
        accessKeyId: "key",
        bucket: "artifacts",
        region: "us-east-1",
      }),
    )
    records.grants.push(
      grant("grant-b2", "conn-b2", { allowedPrefixes: ["logs/"] }),
      grant("grant-s3", "conn-s3", { allowedPrefixes: ["logs/"] }),
    )
    setConnectorService(service())

    for (const provider of ["backblaze_b2", "s3_storage"] as const) {
      const tools = await storageTools({
        orgId: ORG,
        agentId: AGENT,
        roomId: ROOM,
        preferredProvider: provider,
      })
      const list = tools.find((spec) => spec.name === "storage_list_files")!
      const listed = (await list.execute({ prefix: "logs/", limit: 5 })) as {
        provider: string
        files: { path: string }[]
      }
      expect(listed.provider).toBe(provider)
      expect(listed.files[0]?.path).toBe("artifact.txt")
      const read = tools.find((spec) => spec.name === "storage_read_file")!
      expect(((await read.execute({ path: "logs/a.txt" })) as { content: string }).content).toBe(
        "s3",
      )
    }

    // Each grant is an allow-list per connector: a path outside it is refused before any request.
    for (const [provider, granted, denied] of [
      ["s3_storage", "logs/a.txt", "other/key.txt"],
      ["backblaze_b2", "logs/a.txt", "other/a.txt"],
    ] as const) {
      const tools = await storageTools({
        orgId: ORG,
        agentId: AGENT,
        roomId: ROOM,
        preferredProvider: provider,
      })
      const read = tools.find((spec) => spec.name === "storage_read_file")!
      const before = stub.state.requests.length
      await expect(read.execute({ path: denied })).rejects.toThrow(
        /outside this agent's allowed storage prefixes/,
      )
      expect(stub.state.requests.length).toBe(before)
      expect(((await read.execute({ path: granted })) as { content: string }).content).toBe("s3")
    }
  })

  it("huggingface: reads, lists and writes through the commit API", async () => {
    records.connectors.push(row("huggingface", "conn-hf", { repoId: "acme/data" }))
    records.grants.push(grant("grant-hf", "conn-hf", {}))
    setConnectorService(service())
    const tools = await storageTools({
      orgId: ORG,
      agentId: AGENT,
      roomId: ROOM,
      preferredProvider: "huggingface",
    })

    const list = tools.find((spec) => spec.name === "storage_list_files")!
    const listed = (await list.execute({ prefix: "reports/", limit: 5 })) as {
      provider: string
      files: { path: string }[]
    }
    expect(listed.provider).toBe("huggingface")
    expect(listed.files).toEqual([{ name: "a.md", path: "reports/a.md", size: 5 }])

    const read = tools.find((spec) => spec.name === "storage_read_file")!
    expect(((await read.execute({ path: "reports/a.md" })) as { content: string }).content).toBe(
      "# hi",
    )

    const upload = tools.find((spec) => spec.name === "storage_upload_file")!
    await upload.execute({ path: "reports/b.md", content: "# new" })
    const commit = stub.state.requests.find(
      (request) =>
        request.method === "POST" && request.path === "/hf/api/datasets/acme/data/commit/main",
    )
    expect(commit?.body).toContain('{"key":"file","value":{"path":"reports/b.md"')

    const remove = tools.find((spec) => spec.name === "storage_delete_file")!
    await remove.execute({ path: "reports/b.md" })
    expect(
      stub.state.requests.some((request) => request.body.includes('"key":"deletedEntry"')),
    ).toBe(true)
  })

  it("storage: no active storage connector means no storage tools", async () => {
    records.connectors = records.connectors.filter(
      (connector) => !["supabase", "cloudflare_r2"].includes(connector.source),
    )
    records.grants = records.grants.filter(
      (entry) => !["conn-supa", "conn-r2"].includes(entry.connectorId),
    )
    setConnectorService(service())
    expect(await storageTools({ orgId: ORG, agentId: AGENT, roomId: ROOM })).toEqual([])
  })

  // ── Jira (intentionally non-native) ──
  // ── Composio connected apps (the OpenMausBot catalog: Gmail, Notion, …) ──
  it("composio: lists apps, runs a read tool as the workspace user, and gates by app and read-only", async () => {
    records.connectors.push(row("composio", "conn-composio"))
    records.grants.push(grant("grant-composio", "conn-composio", {}))
    setConnectorService(service())

    const list = tool("composio_list_apps", ["composio"])
    const apps = (await list.execute({})) as {
      apps: { slug: string; connected: boolean; status: string | null }[]
    }
    expect(apps.apps).toEqual([
      { slug: "gmail", name: "Gmail", description: "Email", connected: true, status: "ACTIVE" },
      { slug: "notion", name: "Notion", description: "Docs", connected: false, status: null },
    ])

    const search = tool("composio_search_tools", ["composio"])
    const found = (await search.execute({ app: "gmail" })) as {
      tools: { slug: string; write: boolean }[]
    }
    expect(found.tools).toEqual([
      {
        slug: "GMAIL_FETCH_EMAILS",
        name: "Fetch emails",
        description: "Search Gmail",
        write: false,
      },
      { slug: "GMAIL_SEND_EMAIL", name: "Send email", description: "Send mail", write: true },
    ])

    const run = tool("composio_execute_tool", ["composio"])
    expect(run.dangerous).toBe(true)
    const result = (await run.execute({
      tool: "GMAIL_FETCH_EMAILS",
      arguments: { query: "is:unread" },
    })) as { ok: boolean; result: Record<string, unknown> }
    expect(result.result).toEqual({ ran: "GMAIL_FETCH_EMAILS" })

    // The execution carried this workspace's Composio user, not a caller-supplied id.
    const executed = stub.state.requests.find((request) =>
      request.path.startsWith("/composio/tools/execute/"),
    )
    expect(JSON.parse(executed?.body ?? "{}")).toMatchObject({
      user_id: `org:${ORG}`,
      arguments: { query: "is:unread" },
    })

    const connect = tool("composio_connect_app", ["composio"])
    expect(connect.dangerous).toBe(true)
    expect(await connect.execute({ app: "notion" })).toMatchObject({
      ok: true,
      toolkit: "notion",
      url: "https://connect.composio.dev/link/abc123",
    })

    // Grant limited to Gmail: another app is refused before any vendor request.
    records.grants = [grant("grant-composio", "conn-composio", { allowedApps: ["gmail"] })]
    setConnectorService(service())
    const before = stub.state.requests.length
    await expect(
      tool("composio_search_tools", ["composio"]).execute({ app: "notion" }),
    ).rejects.toThrow(/outside this agent's allowed apps/)
    await expect(
      tool("composio_execute_tool", ["composio"]).execute({ tool: "NOTION_CREATE_PAGE" }),
    ).rejects.toThrow(/outside this agent's allowed apps/)
    expect(stub.state.requests.length).toBe(before)

    // Read-only grant: reads run, writes are refused.
    records.grants = [
      grant("grant-composio", "conn-composio", { allowedApps: ["gmail"], readOnly: true }),
    ]
    setConnectorService(service())
    await expect(
      tool("composio_execute_tool", ["composio"]).execute({
        tool: "GMAIL_SEND_EMAIL",
        arguments: {},
      }),
    ).rejects.toThrow(/read-only access to Composio/)
    const read = (await tool("composio_execute_tool", ["composio"]).execute({
      tool: "GMAIL_FETCH_EMAILS",
      arguments: {},
    })) as { ok: boolean }
    expect(read.ok).toBe(true)
  })

  it("jira: has no native tools; the Atlassian marketplace app is the route", async () => {
    records.connectors.push(row("jira", "conn-jira"))
    records.grants.push(grant("grant-jira", "conn-jira", {}))
    setConnectorService(service())

    expect(
      connectorTools({ orgId: ORG, agentId: AGENT, roomId: ROOM, sources: ["jira"] as never }),
    ).toEqual([])
    // The connector still decrypts (so the settings test + grants work); nothing invents tools.
    const decrypted = await service().getDecryptedConnector(ORG, "jira" as never)
    expect(decrypted.connector.id).toBe("conn-jira")
  })
})
