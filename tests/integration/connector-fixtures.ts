/**
 * Shared boundaries for the connector integration suites.
 *
 * Both `connector-dispatch.test.ts` (registry → audited dispatch) and
 * `connector-turn.test.ts` (a full engine turn with a scripted model) need the same three fakes:
 * a loopback vendor that speaks every connector's wire format, an in-memory database that runs the
 * real Drizzle-encoded SQL, and a workspace whose connectors are sealed with a real KEK. Keeping
 * them here means the two suites cannot drift into proving different things.
 */

import { createServer, type Server } from "node:http"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PgDialect } from "drizzle-orm/pg-core"
import {
  agentConnectorGrants,
  agents,
  mcpServers,
  rooms,
  toolCalls,
  workspaceConnectors,
  type AgentConnectorGrantRow,
  type WorkspaceConnectorRow,
} from "@sayabot/db"
import { encryptSecret } from "@sayabot/llm"

export const ORG = "11111111-1111-4111-8111-111111111111"
export const AGENT = "22222222-2222-4222-8222-222222222222"
export const ROOM = "33333333-3333-4333-8333-333333333333"
export const KEK = Buffer.alloc(32, 9).toString("base64")

// ── Stub vendor ──────────────────────────────────────────────────────────────

export interface Recorded {
  method: string
  path: string
  query: string
  body: string
}

export interface Vendor {
  origin: string
  requests: Recorded[]
  reset: () => void
  close: () => Promise<void>
}

export async function startStubVendor(): Promise<Vendor> {
  let requests: Recorded[] = []

  const server: Server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk.toString()))
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      requests.push({ method: req.method ?? "GET", path: url.pathname, query: url.search, body })

      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" })
        res.end(JSON.stringify(value))
      }
      const text = (value: string) => {
        res.writeHead(200, { "Content-Type": "text/plain" })
        res.end(value)
      }
      const xml = (value: string) => {
        res.writeHead(200, { "Content-Type": "application/xml" })
        res.end(value)
      }
      const path = url.pathname

      // Google Drive
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
      if (path === "/drive/v3/files/file-1")
        return json({
          id: "file-1",
          name: "Roadmap",
          mimeType: "application/vnd.google-apps.document",
          webViewLink: "https://docs.test/file-1",
        })
      if (path.endsWith("/export")) return text("# Roadmap\n- ship it")

      // Slack
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
            { user: "U1", text: "Starting thread", ts: "1700000000.000100" },
            { user: "U2", text: "Looks good", ts: "1700000000.000200" },
          ],
        })
      if (path === "/api/chat.postMessage") return json({ ok: true, ts: "1700000000.000900" })
      if (path === "/api/users.info")
        return json({ ok: true, user: { real_name: "Ops", name: "ops" } })

      // GitHub
      if (path === "/search/code")
        return json({
          items: [
            {
              name: "a.ts",
              path: "src/a.ts",
              html_url: "https://github.test/acme/app/blob/main/src/a.ts",
              repository: { full_name: "acme/app" },
            },
          ],
        })
      if (path === "/repos/acme/app/contents/src/a.ts")
        return json({
          name: "a.ts",
          path: "src/a.ts",
          encoding: "base64",
          content: Buffer.from("export const a = 1").toString("base64"),
          html_url: "https://github.test/acme/app/blob/main/src/a.ts",
          size: 18,
        })

      // Discord
      if (path === "/users/@me/guilds") return json([{ id: "90000", name: "Acme" }])
      if (path === "/guilds/90000/channels")
        return json([
          { id: "11111", name: "general", type: 0 },
          { id: "22222", name: "secret", type: 0 },
        ])
      if (path === "/channels/11111/messages" && req.method === "GET")
        return json([
          {
            id: "1",
            content: "hello",
            timestamp: "2026-11-01T00:00:00Z",
            author: { username: "a" },
          },
        ])
      if (path === "/channels/11111/messages" && req.method === "POST")
        return json({ id: "2", channel_id: "11111" })

      // Telegram
      if (path.endsWith("/getUpdates"))
        return json({
          ok: true,
          result: [
            {
              update_id: 1,
              message: {
                message_id: 5,
                date: 1761955200,
                chat: { id: 7, first_name: "Ada" },
                text: "hi bot",
              },
            },
          ],
        })
      if (path.endsWith("/sendMessage")) return json({ ok: true, result: { message_id: 6 } })

      // WhatsApp
      if (path === "/wa/106540352242922/messages") return json({ messages: [{ id: "wamid.1" }] })

      // 1Password Connect
      if (path === "/connect/v1/vaults") return json([{ id: "v1", name: "Shared" }])
      if (path === "/connect/v1/vaults/v1/items") return json([{ id: "i1", title: "Bank" }])
      if (path === "/connect/v1/vaults/v1/items/i1")
        return json({
          id: "i1",
          title: "Bank",
          vault: { id: "v1" },
          fields: [{ id: "password", label: "password", type: "CONCEALED", value: "1234" }],
        })

      // Bitwarden Secrets Manager
      if (path === "/bw/public/secrets")
        return json({ data: [{ id: "s1", key: "API_KEY", value: "secret" }] })
      if (path === "/bw/public/secrets/API_KEY")
        return json({ id: "s1", key: "API_KEY", value: "secret" })

      // Supabase Storage
      if (path === "/supa/storage/v1/object/list/docs")
        return json([{ name: "report.md", metadata: { size: 4, mimetype: "text/plain" } }])
      if (path === "/supa/storage/v1/object/docs/reports/report.md" && req.method === "GET")
        return text("data")
      if (path.startsWith("/supa/storage/v1/object/docs/") && req.method === "POST")
        return json({ Key: "docs/reports/report.md" })
      if (path === "/supa/storage/v1/object/docs" && req.method === "DELETE") return json([])

      // S3-compatible (R2, B2, S3/MinIO)
      const s3 = path.match(/^\/s3\/([^/]+)(\/.*)?$/)
      if (s3) {
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

      // Hugging Face
      if (path === "/hf/api/datasets/acme/data/tree/main/")
        return json([{ path: "reports/a.md", size: 5, type: "file" }])
      if (path === "/hf/api/datasets/acme/data/tree/main/reports/")
        return json([{ path: "reports/a.md", size: 5, type: "file" }])
      if (path === "/hf/datasets/acme/data/resolve/main/reports/a.md") return text("# hi")
      if (path === "/hf/api/datasets/acme/data/commit/main") return json({ commitOid: "abc" })

      // Composio
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
          items: [
            { slug: "GMAIL_FETCH_EMAILS", name: "Fetch emails", description: "Search Gmail" },
            { slug: "GMAIL_SEND_EMAIL", name: "Send email", description: "Send mail" },
          ],
        })
      if (path === "/composio/connected_accounts")
        return json({ items: [{ id: "ca_1", status: "ACTIVE", toolkit: { slug: "gmail" } }] })
      if (path === "/composio/connected_accounts/link")
        return json({ redirect_url: "https://connect.composio.dev/link/abc" })
      const composioRun = path.match(/^\/composio\/tools\/execute\/([A-Z0-9_]+)$/)
      if (composioRun) return json({ successful: true, data: { ran: composioRun[1] } })

      return json({ error: "not_found", path }, 404)
    })
  })

  const origin = await new Promise<string>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolve(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`)
    }),
  )

  return {
    origin,
    get requests() {
      return requests
    },
    reset: () => {
      requests = []
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

/** Endpoint overrides: every connector points at the stub through the service seam. */
export function stubEndpoints(origin: string): Record<string, string> {
  return {
    google_drive: origin,
    slack: origin,
    github: origin,
    discord: origin,
    telegram: origin,
    whatsapp: `${origin}/wa`,
    onepassword: `${origin}/connect`,
    bitwarden: `${origin}/bw`,
    huggingface: `${origin}/hf`,
    supabase: `${origin}/supa`,
    composio: `${origin}/composio`,
  }
}

/** Points global fetch at the stub and answers everything else (Supabase broadcast) with 200. */
export function installStubFetch(origin: string): () => void {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(origin)) return realFetch(input, init)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
  return () => {
    globalThis.fetch = realFetch
  }
}

/** Proton Pass goes through the local CLI; this puts a scripted `pass-cli` on PATH. */
export function installFakePassCli(): () => void {
  const bin = mkdtempSync(join(tmpdir(), "saaya-connector-bin-"))
  const passCli = join(bin, "pass-cli")
  writeFileSync(
    passCli,
    `#!/bin/sh
if [ "$1" = "item" ] && [ "$2" = "list" ]; then echo '[{"id":"p1","name":"Bank"}]'; exit 0; fi
if [ "$1" = "item" ] && [ "$2" = "view" ]; then echo '{"id":"p1","name":"Bank","note":"1234"}'; exit 0; fi
echo '{}'
`,
  )
  chmodSync(passCli, 0o755)
  const previous = process.env.PATH ?? ""
  process.env.PATH = `${bin}:${previous}`
  return () => {
    process.env.PATH = previous
  }
}

// ── In-memory database (Drizzle-encoded SQL, real column matching) ───────────

export interface CallRow {
  id: string
  toolName: string
  args: Record<string, unknown>
  status: string
  result?: unknown
  error?: string
}

export interface Records {
  connectors: WorkspaceConnectorRow[]
  grants: AgentConnectorGrantRow[]
  calls: CallRow[]
}

const dialect = new PgDialect()

/** A promise-like that also exposes `.catch`/`.finally`, like a Drizzle query builder. */
function thenable<T>(value: T) {
  const promise = Promise.resolve(value)
  return {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
}

function columnChecks(cond: unknown): { column: string; value: unknown }[] {
  const { sql, params } = dialect.sqlToQuery(cond as never)
  const checks: { column: string; value: unknown }[] = []
  const pattern = /"([a-z_]+)"\s*=\s*\$(\d+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)))
    checks.push({ column: match[1]!, value: params[Number(match[2]) - 1] })
  return checks
}

/**
 * Serves the queries the connector service, the tool registry, the audited tool wrapper and an
 * engine turn actually issue. Unknown tables read as empty and every insert returns a row, so a
 * turn can persist runs/messages without a Postgres instance.
 */
export function createDb(records: Records) {
  let seq = 0

  const connectorView = (row: WorkspaceConnectorRow) => ({
    id: row.id,
    org_id: row.orgId,
    source: row.source,
    status: row.status,
  })
  const grantView = (row: AgentConnectorGrantRow) => ({
    id: row.id,
    org_id: row.orgId,
    agent_id: row.agentId,
    connector_id: row.connectorId,
  })

  function execute(state: {
    table: unknown
    joined?: unknown
    cond?: unknown
    limit?: number
    shape?: Record<string, unknown>
  }): unknown[] {
    const checks = state.cond ? columnChecks(state.cond) : []
    const matches = (view: Record<string, unknown>) =>
      checks.every((check) => view[check.column] === check.value)

    if (state.table === agentConnectorGrants && state.joined === workspaceConnectors) {
      return records.grants.flatMap((grant) => {
        const connector = records.connectors.find((row) => row.id === grant.connectorId)
        if (!connector) return []
        const view = { ...connectorView(connector), ...grantView(grant) }
        if (!matches(view)) return []
        // `select({ source })` (buildTools) vs `select({ connector })` (getStorageTarget).
        if (state.shape && "source" in state.shape) return [{ source: connector.source }]
        if (state.shape && "connector" in state.shape) return [{ connector }]
        return [{ ...view, ...connector }]
      })
    }
    if (state.table === workspaceConnectors)
      return records.connectors.filter((row) => matches(connectorView(row)))
    if (state.table === agentConnectorGrants)
      return records.grants.filter((row) => matches(grantView(row)))
    if (state.table === toolCalls) {
      const rows = records.calls
        .filter((row) => matches({ id: row.id, status: row.status, tool_name: row.toolName }))
        .map((row) => ({
          id: row.id,
          status: row.status,
          toolName: row.toolName,
          args: row.args,
          result: row.result,
          error: row.error,
        }))
      return state.limit ? rows.slice(0, state.limit) : rows
    }
    if (state.table === rooms) return [{ id: ROOM, executionMode: "auto", orgId: ORG }]
    if (state.table === mcpServers) return []
    return []
  }

  function selectBuilder(state: {
    table: unknown
    joined?: unknown
    cond?: unknown
    limit?: number
    shape?: Record<string, unknown>
  }) {
    const chain: Record<string, unknown> = {
      where: (cond: unknown) => selectBuilder({ ...state, cond }),
      innerJoin: (table: unknown) => selectBuilder({ ...state, joined: table }),
      leftJoin: (table: unknown) => selectBuilder({ ...state, joined: table }),
      orderBy: () => chain,
      offset: () => chain,
      limit: (limit: number) => selectBuilder({ ...state, limit }),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(execute(state)).then(resolve, reject),
    }
    return chain
  }

  function updateBuilder(state: {
    table: unknown
    cond?: unknown
    values?: Record<string, unknown>
  }) {
    const chain: Record<string, unknown> = {
      set: (values: Record<string, unknown>) => updateBuilder({ ...state, values }),
      where: (cond: unknown) => {
        const next = { ...state, cond }
        if (state.table === toolCalls) {
          const checks = cond ? columnChecks(cond) : []
          for (const row of records.calls) {
            const view = { id: row.id, status: row.status, tool_name: row.toolName }
            if (!checks.every((check) => view[check.column as "id"] === check.value)) continue
            Object.assign(row, next.values)
          }
        }
        return { ...thenable([]), returning: () => thenable([]) }
      },
      returning: () => thenable([]),
      ...thenable([]),
    }
    return chain
  }

  return {
    select: (shape?: Record<string, unknown>) => ({
      from: (table: unknown) => selectBuilder({ table, shape }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const id = `row-${++seq}`
        if (table === toolCalls) {
          records.calls.push({
            id,
            toolName: String(values.toolName),
            args: (values.args ?? {}) as Record<string, unknown>,
            status: String(values.status),
          })
        }
        // Every insert returns a row so callers can destructure ids/metadata.
        const row = { id, metadata: {}, runId: id, messageId: id, ...values }
        return {
          returning: () => thenable([row]),
          onConflictDoNothing: () => ({ ...thenable([row]), returning: () => thenable([row]) }),
          ...thenable([row]),
        }
      },
    }),
    update: (table: unknown) => updateBuilder({ table }),
    delete: () => ({
      where: () => thenable([]),
      ...thenable([]),
    }),
    execute: () => Promise.resolve({ rows: [] }),
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

export function connectorRow(
  source: string,
  id: string,
  config: Record<string, unknown> = {},
  token = `token-${source}`,
): WorkspaceConnectorRow {
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

export function grantRow(
  id: string,
  connectorId: string,
  scopeConfig: Record<string, unknown> = {},
): AgentConnectorGrantRow {
  return {
    id,
    orgId: ORG,
    agentId: AGENT,
    connectorId,
    scopeConfig,
    createdAt: new Date(),
  } as AgentConnectorGrantRow
}

export const AGENT_ROW = {
  id: AGENT,
  orgId: ORG,
  name: "Connector Bot",
  handle: "bot",
  displayName: "Connector Bot",
  systemPrompt: "",
  capabilities: {
    connectors: true,
    storage: true,
    canvas: false,
    tasks: false,
    sandbox: false,
    webSearch: false,
    document: false,
    github: false,
    postgres: false,
    mcp: false,
    computer: false,
    secrets: false,
    memory: false,
    subagents: false,
    cron: false,
    voice: false,
  },
  params: null,
  toolIds: [],
} as unknown as typeof agents.$inferSelect

/** Every connector source the platform claims to support, sealed and granted. */
export function seedConnectors(records: Records, origin: string): void {
  records.connectors = [
    connectorRow("google_drive", "conn-gdrive", { domain: "acme.test" }),
    connectorRow("slack", "conn-slack", { defaultChannel: "C1" }),
    connectorRow("github", "conn-github", { defaultOrg: "acme" }),
    connectorRow("discord", "conn-discord", { guildId: "90000" }),
    connectorRow("telegram", "conn-telegram", {}, "111:AAAAAAAAAAAAAAAAAAAAAAAA"),
    connectorRow("whatsapp", "conn-wa", { phoneNumberId: "106540352242922" }, "wa-token"),
    connectorRow(
      "onepassword",
      "conn-op",
      { authMode: "api", connectUrl: `${origin}/connect` },
      "ops",
    ),
    connectorRow("bitwarden", "conn-bw", { authMode: "api", apiBaseUrl: `${origin}/bw` }, "bw"),
    connectorRow("protonpass", "conn-pp", { authMode: "computer" }, "desktop"),
    connectorRow("supabase", "conn-supa", { projectUrl: `${origin}/supa`, bucket: "docs" }, "svc"),
    connectorRow(
      "cloudflare_r2",
      "conn-r2",
      { endpoint: `${origin}/s3`, accessKeyId: "k", bucket: "artifacts" },
      "s",
    ),
    connectorRow(
      "backblaze_b2",
      "conn-b2",
      { endpoint: `${origin}/s3`, keyId: "k", bucket: "artifacts" },
      "s",
    ),
    connectorRow(
      "s3_storage",
      "conn-s3",
      { endpoint: `${origin}/s3`, accessKeyId: "k", bucket: "artifacts", region: "auto" },
      "s",
    ),
    connectorRow("huggingface", "conn-hf", { repoId: "acme/data" }, "hf"),
    connectorRow("composio", "conn-composio", {}, "comp-key"),
  ]
  records.grants = [
    grantRow("g-gdrive", "conn-gdrive", { allowedFolders: ["folder-1"] }),
    grantRow("g-slack", "conn-slack", { allowedChannels: ["C1"] }),
    grantRow("g-github", "conn-github", { allowedRepos: ["acme/app"] }),
    grantRow("g-discord", "conn-discord", { allowedChannels: ["11111"] }),
    grantRow("g-telegram", "conn-telegram", { allowedChannels: ["7"] }),
    grantRow("g-wa", "conn-wa", { allowedRecipients: ["14155550123"] }),
    grantRow("g-op", "conn-op", {}),
    grantRow("g-bw", "conn-bw", {}),
    grantRow("g-pp", "conn-pp", {}),
    grantRow("g-supa", "conn-supa", { allowedPrefixes: ["reports/"] }),
    grantRow("g-r2", "conn-r2", {}),
    grantRow("g-b2", "conn-b2", {}),
    grantRow("g-s3", "conn-s3", {}),
    grantRow("g-hf", "conn-hf", {}),
    grantRow("g-composio", "conn-composio", { allowedApps: ["gmail"] }),
  ]
}
