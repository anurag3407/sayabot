/**
 * Every connector source, through the handler an agent turn actually uses.
 *
 * `buildTools()` is the registry an agent gets (DB grants → `connectorTools`/`storageTools`), and
 * `toAuditedTools()` wraps every spec with the audit row, the human-approval gate, redaction and
 * output capping. This suite builds the real tool set and then calls the tools the way the model
 * does — `tools[name].execute(args, …)` on the audited set — so a tool that exists in code but is
 * never registered, is mis-flagged as safe, or lacks approval wiring fails here.
 *
 * `connector-turn.test.ts` takes the next step: the same tools through a full engine turn with a
 * scripted model. Both suites share the stub vendor, in-memory DB and workspace in
 * `connector-fixtures.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { agents } from "@sayabot/db"
import {
  ConnectorService,
  setConnectorService,
} from "../../apps/orchestrator/src/connectors/service"
import { resolveApprovalWaiter } from "../../apps/orchestrator/src/tools/approvals"
import { buildTools } from "../../apps/orchestrator/src/tools"
import type { ToolSpec } from "../../apps/orchestrator/src/tools/audited"
import {
  AGENT,
  AGENT_ROW,
  KEK,
  ORG,
  ROOM,
  connectorRow,
  createDb,
  grantRow,
  installFakePassCli,
  installStubFetch,
  seedConnectors,
  startStubVendor,
  stubEndpoints,
  type CallRow,
  type Records,
  type Vendor,
} from "./connector-fixtures"

const records: Records = { connectors: [], grants: [], calls: [] }
const dbState = vi.hoisted(() => ({ db: undefined as unknown }))

vi.mock("../../apps/orchestrator/src/db", () => ({
  getDb: () => dbState.db,
  getPool: () => ({
    connect: () => Promise.reject(new Error("no pool in this suite")),
  }),
  closeDb: async () => {},
  withRoomLock: async (_roomId: string, fn: () => unknown) => fn(),
}))

let vendor: Vendor
let restoreFetch: () => void
let restorePath: () => void

beforeAll(async () => {
  vendor = await startStubVendor()
  seedConnectors(records, vendor.origin)
  dbState.db = createDb(records)

  process.env.DATABASE_URL = "postgres://u:p@h/db"
  process.env.MESH_KEK = KEK
  process.env.SUPABASE_URL = "https://realtime.test"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc"
  process.env.ORCHESTRATOR_INTERNAL_SECRET = "0123456789abcdef"
  process.env.PORT = "4000"

  restoreFetch = installStubFetch(vendor.origin)
  restorePath = installFakePassCli()

  setConnectorService(
    new ConnectorService({
      db: createDb(records),
      kek: KEK,
      endpoints: stubEndpoints(vendor.origin),
    }),
  )
})

afterAll(async () => {
  setConnectorService(null)
  restoreFetch?.()
  restorePath?.()
  await vendor?.close()
})

beforeEach(() => {
  vendor.reset()
  records.calls = []
})

// ── Helpers ─────────────────────────────────────────────────────────────────

async function build(storageProvider?: string) {
  const agent = {
    ...AGENT_ROW,
    params: storageProvider ? { storageProvider } : null,
  } as typeof agents.$inferSelect
  return buildTools({
    roomId: ROOM,
    orgId: ORG,
    agent,
    runtime: { orgId: ORG, roomId: ROOM, agentId: AGENT, approvalTimeoutMs: 2_000 },
  })
}

type Built = Awaited<ReturnType<typeof build>>

function specOf(built: Built, name: string): ToolSpec {
  const spec = built.specs.find((candidate) => candidate.name === name)
  if (!spec) throw new Error(`${name} is not registered in the built tool set`)
  return spec
}

function isDangerous(spec: ToolSpec, args: Record<string, unknown>): boolean {
  return typeof spec.dangerous === "function" ? spec.dangerous(args) : spec.dangerous
}

async function pendingCall(name: string, timeoutMs = 1_000): Promise<CallRow> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const row = records.calls.find(
      (call) => call.toolName === name && call.status === "pending_approval",
    )
    if (row) return row
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`${name} never reached pending_approval`)
}

/**
 * Approves a pending call. The audited wrapper inserts the row before it starts waiting, so the
 * decision can land a tick before the waiter is registered — keep answering until it settles.
 */
async function approve(
  name: string,
  promise: Promise<unknown>,
): Promise<{ result: unknown; call: CallRow }> {
  const call = await pendingCall(name)
  expect(call.status).toBe("pending_approval")
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  const timer = setInterval(() => {
    if (!settled) resolveApprovalWaiter(call.id, "approved")
  }, 5)
  try {
    const result = await promise
    return { result, call }
  } finally {
    clearInterval(timer)
  }
}

/** Runs a tool the way the model does, approving the gate when the spec asks for one. */
async function run(
  built: Built,
  name: string,
  args: Record<string, unknown>,
  options: { approve?: boolean } = {},
): Promise<{ result: unknown; call: CallRow; dangerous: boolean }> {
  const spec = specOf(built, name)
  const dangerous = isDangerous(spec, args)
  const execute = built.tools[name]?.execute as
    ((input: unknown, options: unknown) => Promise<unknown>) | undefined
  if (!execute) throw new Error(`${name} has no executable registered tool`)

  const promise = execute(args, { toolCallId: `t-${name}`, messages: [] })
  if (dangerous && options.approve !== false) {
    const { result, call } = await approve(name, promise)
    return { result, call, dangerous }
  }
  const result = await promise
  const call = records.calls.filter((row) => row.toolName === name).at(-1)!
  return { result, call, dangerous }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("connector tools through the real registry and dispatch", () => {
  it("registers every connector tool for its source, with the right danger flags", async () => {
    const built = await build("supabase")
    const names = built.specs.map((spec) => spec.name)

    const expected: Record<string, string[]> = {
      google_drive: ["gdrive_read_file", "gdrive_search"],
      slack: ["slack_read_thread", "slack_search", "slack_send_message"],
      github: ["github_get_file", "github_get_issue_or_pr", "github_search_code"],
      discord: ["discord_list_channels", "discord_read_messages", "discord_send_message"],
      telegram: ["telegram_read_messages", "telegram_send_message"],
      whatsapp: ["whatsapp_send_message", "whatsapp_send_template"],
      onepassword: ["onepassword_read", "onepassword_search"],
      bitwarden: ["bitwarden_read", "bitwarden_search"],
      protonpass: ["protonpass_read", "protonpass_search"],
      composio: [
        "composio_connect_app",
        "composio_execute_tool",
        "composio_list_apps",
        "composio_search_tools",
      ],
      storage: [
        "storage_delete_file",
        "storage_list_files",
        "storage_read_file",
        "storage_upload_file",
      ],
    }
    for (const [source, tools] of Object.entries(expected))
      for (const name of tools) expect(names, `${source} · ${name}`).toContain(name)

    const writes = [
      "slack_send_message",
      "discord_send_message",
      "telegram_send_message",
      "whatsapp_send_message",
      "whatsapp_send_template",
      "onepassword_read",
      "bitwarden_read",
      "protonpass_read",
      "storage_upload_file",
      "storage_delete_file",
      "composio_execute_tool",
      "composio_connect_app",
    ]
    for (const name of writes) {
      const spec = specOf(built, name)
      expect(isDangerous(spec, {}), `${name} must require approval`).toBe(true)
    }
    const reads = [
      "gdrive_search",
      "gdrive_read_file",
      "slack_search",
      "slack_read_thread",
      "github_search_code",
      "github_get_file",
      "github_get_issue_or_pr",
      "discord_list_channels",
      "discord_read_messages",
      "telegram_read_messages",
      "onepassword_search",
      "bitwarden_search",
      "protonpass_search",
      "storage_list_files",
      "storage_read_file",
      "composio_list_apps",
      "composio_search_tools",
    ]
    for (const name of reads) {
      const spec = specOf(built, name)
      expect(isDangerous(spec, {}), `${name} must not require approval`).toBe(false)
    }
  })

  it("runs every read tool through the audited dispatcher", async () => {
    const built = await build()

    const cases: { name: string; args: Record<string, unknown>; contains: string }[] = [
      { name: "gdrive_search", args: { query: "roadmap" }, contains: "Roadmap" },
      { name: "gdrive_read_file", args: { file_id: "file-1" }, contains: "ship it" },
      { name: "slack_search", args: { query: "deploy" }, contains: "deploy is green" },
      {
        name: "slack_read_thread",
        args: { channel_id: "C1", thread_ts: "1700000000.000100" },
        contains: "Looks good",
      },
      { name: "github_search_code", args: { query: "a" }, contains: "src/a.ts" },
      {
        name: "github_get_file",
        args: { repo: "acme/app", path: "src/a.ts" },
        contains: "export const a = 1",
      },
      { name: "discord_list_channels", args: {}, contains: "general" },
      { name: "discord_read_messages", args: { channel_id: "11111", limit: 5 }, contains: "hello" },
      { name: "telegram_read_messages", args: { limit: 5 }, contains: "hi bot" },
      { name: "onepassword_search", args: { query: "Bank" }, contains: "Bank" },
      { name: "bitwarden_search", args: { query: "API_KEY" }, contains: "API_KEY" },
      { name: "protonpass_search", args: { query: "Bank" }, contains: "Bank" },
      { name: "composio_list_apps", args: {}, contains: "gmail" },
      { name: "composio_search_tools", args: { app: "gmail" }, contains: "GMAIL_FETCH_EMAILS" },
    ]

    for (const testCase of cases) {
      const { result, call } = await run(built, testCase.name, testCase.args)
      expect(JSON.stringify(result), `${testCase.name} result`).toContain(testCase.contains)
      expect(call.status, `${testCase.name} audit row`).toBe("done")
    }
  })

  it("gates every dangerous connector tool on approval, then runs it", async () => {
    const built = await build()

    const cases: { name: string; args: Record<string, unknown>; contains: string }[] = [
      {
        name: "slack_send_message",
        args: { channel: "C1", text: "shipping" },
        contains: "1700000000.000900",
      },
      {
        name: "discord_send_message",
        args: { channel_id: "11111", content: "shipping" },
        contains: '"ok":true',
      },
      {
        name: "telegram_send_message",
        args: { chat_id: "7", text: "shipping" },
        contains: "message_id",
      },
      {
        name: "whatsapp_send_message",
        args: { to: "+14155550123", text: "shipping" },
        contains: "wamid.1",
      },
      { name: "onepassword_read", args: { query: "i1", vault: "v1" }, contains: "1234" },
      { name: "bitwarden_read", args: { query: "API_KEY" }, contains: "secret" },
      { name: "protonpass_read", args: { query: "p1" }, contains: "1234" },
      {
        name: "composio_execute_tool",
        args: { tool: "GMAIL_FETCH_EMAILS", arguments: { query: "is:unread" } },
        contains: "GMAIL_FETCH_EMAILS",
      },
      { name: "composio_connect_app", args: { app: "gmail" }, contains: "connect.composio.dev" },
    ]

    for (const testCase of cases) {
      const spec = specOf(built, testCase.name)
      const execute = built.tools[testCase.name]?.execute as (
        input: unknown,
        options: unknown,
      ) => Promise<unknown>
      const promise = execute(testCase.args, { toolCallId: `t-${testCase.name}`, messages: [] })
      expect(isDangerous(spec, testCase.args)).toBe(true)

      const { result, call } = await approve(testCase.name, promise)
      expect(JSON.stringify(result), `${testCase.name} result`).toContain(testCase.contains)
      expect(call.status, `${testCase.name} audit row`).toBe("done")
    }
  })

  it("runs storage tools for every storage source through the dispatch path", async () => {
    for (const source of [
      "supabase",
      "cloudflare_r2",
      "backblaze_b2",
      "s3_storage",
      "huggingface",
    ]) {
      const built = await build(source)
      const names = built.specs.map((spec) => spec.name)
      for (const name of [
        "storage_list_files",
        "storage_read_file",
        "storage_upload_file",
        "storage_delete_file",
      ])
        expect(names, `${source} · ${name}`).toContain(name)

      const list = await run(built, "storage_list_files", { prefix: "reports/", limit: 5 })
      expect((list.result as { provider: string }).provider).toBe(source)
      expect(list.call.status).toBe("done")

      const upload = await run(built, "storage_upload_file", {
        path: "reports/new.md",
        content: "x",
      })
      expect(upload.call.status).toBe("done")
      expect(upload.dangerous).toBe(true)
    }
  })

  it("returns a rejection instead of executing when nobody approves", async () => {
    const agent = { ...AGENT_ROW, params: null } as typeof agents.$inferSelect
    const built = await buildTools({
      roomId: ROOM,
      orgId: ORG,
      agent,
      runtime: { orgId: ORG, roomId: ROOM, agentId: AGENT, approvalTimeoutMs: 120 },
    })
    const execute = built.tools.slack_send_message?.execute as (
      input: unknown,
      options: unknown,
    ) => Promise<unknown>
    const result = (await execute(
      { channel: "C1", text: "never approved" },
      { toolCallId: "t-reject", messages: [] },
    )) as { ok: boolean; rejected?: boolean; error?: string }

    expect(result.ok).toBe(false)
    expect(result.rejected).toBe(true)
    expect(result.error).toMatch(/rejected/i)
    const row = records.calls.find((call) => call.toolName === "slack_send_message")
    expect(row?.status).toBe("rejected")
    expect(vendor.requests.some((request) => request.path === "/api/chat.postMessage")).toBe(false)
  })

  it("refuses out-of-scope calls with a well-formed tool result and no vendor request", async () => {
    const built = await build()

    const refusals: {
      name: string
      args: Record<string, unknown>
      pattern: RegExp
      /** Slack resolves grant names through `conversations.list` before refusing; that one is fine. */
      allowedPath?: RegExp
    }[] = [
      {
        name: "slack_read_thread",
        args: { channel_id: "C2", thread_ts: "1700000000.000100" },
        pattern: /outside this agent's allowed list/,
        allowedPath: /^\/api\/(conversations\.list|users\.info)$/,
      },
      {
        name: "discord_read_messages",
        args: { channel_id: "22222" },
        pattern: /outside this agent's allowed list/,
      },
      {
        name: "composio_search_tools",
        args: { app: "notion" },
        pattern: /outside this agent's allowed apps/,
      },
      {
        name: "github_get_file",
        args: { repo: "other/repo", path: "a.ts" },
        pattern: /Access Denied/,
      },
      {
        name: "storage_read_file",
        args: { path: "other/secret.md" },
        pattern: /allowed storage prefixes/,
      },
    ]

    for (const refusal of refusals) {
      const before = vendor.requests.length
      const { result } = await run(built, refusal.name, refusal.args)
      const shaped = result as { ok: boolean; error: string }
      // A refusal is a tool result the model can read, not a thrown error.
      expect(shaped.ok).toBe(false)
      expect(shaped.error).toMatch(refusal.pattern)
      const sent = vendor.requests.slice(before).map((request) => request.path)
      expect(
        sent.filter((path) => !refusal.allowedPath?.test(path)),
        `${refusal.name} made no data request`,
      ).toEqual([])
    }
  })

  it("keeps composio execution workspace-scoped and read-only-aware", async () => {
    const built = await build()
    const { call } = await run(
      built,
      "composio_execute_tool",
      { tool: "GMAIL_FETCH_EMAILS", arguments: { query: "is:unread" } },
      {},
    )
    expect(call.status).toBe("done")
    const executed = vendor.requests.find((request) =>
      request.path.startsWith("/composio/tools/execute/"),
    )
    expect(JSON.parse(executed?.body ?? "{}")).toMatchObject({
      user_id: `org:${ORG}`,
      arguments: { query: "is:unread" },
    })

    // Read-only grant: a read still runs, a write is refused by the service.
    records.grants = records.grants.map((entry) =>
      entry.connectorId === "conn-composio"
        ? ({
            ...entry,
            scopeConfig: { allowedApps: ["gmail"], readOnly: true },
          } as AgentConnectorGrantRow)
        : entry,
    )
    const readOnlyBuilt = await build()
    const before = vendor.requests.length
    const write = await run(readOnlyBuilt, "composio_execute_tool", {
      tool: "GMAIL_SEND_EMAIL",
      arguments: {},
    })
    expect((write.result as { ok: boolean; error: string }).ok).toBe(false)
    expect((write.result as { error: string }).error).toMatch(/read-only access to Composio/)
    expect(vendor.requests.length).toBe(before)
  })

  it("drops an inactive grant from the registry and reports missing config as a refusal", async () => {
    const whatsapp = records.connectors.find((row) => row.id === "conn-wa")!
    const status = whatsapp.status
    const config = whatsapp.config
    try {
      // A connector that needs attention must not expose tools that can only fail.
      whatsapp.status = "needs_attention"
      const inactive = await build()
      expect(inactive.specs.map((spec) => spec.name)).not.toContain("whatsapp_send_message")

      whatsapp.status = status
      whatsapp.config = {}
      const incomplete = await build()
      expect(incomplete.specs.map((spec) => spec.name)).toContain("whatsapp_send_message")
      const { result, call } = await run(incomplete, "whatsapp_send_message", {
        to: "+14155550123",
        text: "hi",
      })
      expect((result as { ok: boolean }).ok).toBe(false)
      expect((result as { error: string }).error).toMatch(/phone number ID/)
      // A thrown config error is vendor.requests as an error row, and still comes back as a tool result.
      expect(call.status).toBe("error")
    } finally {
      whatsapp.status = status
      whatsapp.config = config
    }
  })

  it("has no native jira tools, matching the Atlassian marketplace route", async () => {
    records.connectors.push(connectorRow("jira", "conn-jira", {}, "jira-token"))
    records.grants.push(grantRow("g-jira", "conn-jira", {}))
    try {
      const built = await build()
      expect(built.specs.filter((spec) => spec.name.includes("jira"))).toEqual([])
    } finally {
      records.connectors = records.connectors.filter((row) => row.id !== "conn-jira")
      records.grants = records.grants.filter((row) => row.id !== "g-jira")
    }
  })
})
