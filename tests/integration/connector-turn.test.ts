/**
 * Every connector source, through a full engine turn with a scripted model.
 *
 * `connector-dispatch.test.ts` proves the registry and the audited wrapper. This suite proves the
 * layer above it: `runEngineTurn` — the function `runTurn` calls for a chat turn (`engine/index.ts`,
 * default engine `v2`) — builds the tool set, hands it to the provider, receives a tool call emitted
 * by a stubbed model, gates it on approval, executes it and feeds the result back into the
 * conversation. A connector that is registered but never reaches the model, or whose result is
 * swallowed, fails here.
 *
 * Only the provider, the room broadcast and the context/memory helpers are stubbed; the tool
 * registry, the audited wrapper, `ConnectorService`, the KEK and the vendor HTTP are real.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { agents } from "@sayabot/db"
import { MockLanguageModelV4 } from "ai/test"
import { runEngineTurn } from "../../apps/orchestrator/src/engine/run"
import {
  ConnectorService,
  setConnectorService,
} from "../../apps/orchestrator/src/connectors/service"
import { resolveApprovalWaiter } from "../../apps/orchestrator/src/tools/approvals"
import type { RunLlmTurnArgs } from "../../apps/orchestrator/src/runner/llm"
import {
  AGENT,
  AGENT_ROW,
  KEK,
  ORG,
  ROOM,
  createDb,
  installFakePassCli,
  installStubFetch,
  seedConnectors,
  startStubVendor,
  stubEndpoints,
  type Records,
  type Vendor,
} from "./connector-fixtures"

interface Step {
  toolName: string
  input: Record<string, unknown>
}

const state = vi.hoisted(() => ({
  model: undefined as unknown,
  prompts: [] as unknown[],
  toolLists: [] as unknown[],
}))

const records: Records = { connectors: [], grants: [], calls: [] }

vi.mock("../../apps/orchestrator/src/db", () => ({
  getDb: () => stateDb,
  getPool: () => ({ connect: () => Promise.reject(new Error("no pool in this suite")) }),
  closeDb: async () => {},
  withRoomLock: async (_roomId: string, fn: () => unknown) => fn(),
}))

// The module-scoped fake DB instance, created in beforeAll (mocks are hoisted).
let stateDb: unknown

vi.mock("../../apps/orchestrator/src/runner/llm", () => ({
  resolveAgentModel: async () => ({
    model: state.model,
    provider: "openai-compatible",
    modelName: "connector-test-model",
  }),
  resolveEffortLevel: () => undefined,
  rememberLastModel: async () => {},
}))

vi.mock("../../apps/orchestrator/src/runner/context", () => ({
  loadConversation: async () => [],
  loadCanvasContext: async () => "",
  loadTaskContext: async () => "",
  loadTaskBriefContext: async () => "",
}))

vi.mock("../../apps/orchestrator/src/engine/skills", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAvailableSkills: async () => [],
}))

vi.mock("../../apps/orchestrator/src/memory/service", () => ({
  getMemoryService: () => ({
    getPinnedDigest: async () => [],
    recall: async () => [],
    extractMemoriesFromTranscript: async () => {},
    getActiveLoops: async () => [],
    reinforce: async () => {},
    generateMemoryMirror: async () => "unchanged",
  }),
}))

vi.mock("../../apps/orchestrator/src/realtime", () => ({
  broadcast: async () => {},
}))

let vendor: Vendor
let restoreFetch: () => void
let restorePath: () => void

beforeAll(async () => {
  vendor = await startStubVendor()
  seedConnectors(records, vendor.origin)
  stateDb = createDb(records)

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
  state.prompts = []
  state.toolLists = []
  state.model = undefined
})

// ── Scripted provider ───────────────────────────────────────────────────────

type ScriptStep = Step[] | "text"

const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}

/**
 * A provider that emits the connector calls it is scripted with, then plain text. Every request it
 * receives is recorded: `prompts[n]` is the conversation the model saw and `toolLists[n]` the tools
 * it was offered on step n.
 */
function scriptedModel(steps: ScriptStep[]): unknown {
  let call = 0
  return new MockLanguageModelV4({
    doStream: async (options: any) => {
      state.prompts.push(options.prompt)
      state.toolLists.push(options.tools ?? [])
      const step = steps[call++] ?? "text"
      const chunks: any[] = [{ type: "stream-start", warnings: [] }]
      if (step === "text") {
        chunks.push(
          { type: "text-start", id: "text" },
          { type: "text-delta", id: "text", delta: "Done." },
          { type: "text-end", id: "text" },
        )
        chunks.push({
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: USAGE,
        })
      } else {
        for (const [index, toolStep] of step.entries())
          chunks.push({
            type: "tool-call",
            toolCallId: `call-${index}`,
            toolName: toolStep.toolName,
            input: JSON.stringify(toolStep.input),
          })
        chunks.push({
          type: "finish",
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage: USAGE,
        })
      }
      return {
        stream: new ReadableStream({
          start(controller) {
            chunks.forEach((chunk) => controller.enqueue(chunk))
            controller.close()
          },
        }),
      }
    },
  } as never)
}

// ── Turn plumbing ───────────────────────────────────────────────────────────

function turnArgs(
  options: {
    storageProvider?: string
    caps?: Record<string, boolean>
  } = {},
): RunLlmTurnArgs {
  const agent = {
    ...AGENT_ROW,
    capabilities: { ...(AGENT_ROW.capabilities as object), ...(options.caps ?? {}) },
    params: {
      engine: "v2",
      maxSteps: 6,
      ...(options.storageProvider ? { storageProvider: options.storageProvider } : {}),
    },
  } as typeof agents.$inferSelect
  return {
    agent,
    room: { id: ROOM, orgId: ORG, name: "connectors", systemDirective: "" },
    trigger: {
      id: "trigger-1",
      content: "Use the connector and report what it returned.",
      senderType: "human",
      metadata: {},
    },
    sessionId: "session-1",
    step: 0,
    role: "responder",
    threadRootId: null,
  } as unknown as RunLlmTurnArgs
}

/** Rows the human gate actually held, so a missing gate cannot pass the dangerous cases. */
const gates = { approved: [] as string[], rejected: [] as string[] }

/** Approves (or rejects) every approval row the turn creates, including late registrations. */
function answerApprovals(decision: "approved" | "rejected"): () => void {
  const answered = new Set<string>()
  const timer = setInterval(() => {
    for (const row of records.calls) {
      if (row.status !== "pending_approval" || answered.has(row.id)) continue
      answered.add(row.id)
      gates[decision].push(row.id)
      resolveApprovalWaiter(row.id, decision)
    }
  }, 5)
  return () => clearInterval(timer)
}

async function runTurn(
  steps: ScriptStep[],
  options: {
    storageProvider?: string
    caps?: Record<string, boolean>
    /** Connector ids granted for this turn; omitted means every seeded connector is granted. */
    connectors?: string[]
  } = {},
): Promise<{ error: string | null; prompts: any[]; toolLists: any[] }> {
  const saved = records.grants
  state.prompts = []
  state.toolLists = []
  records.calls = []
  gates.approved = []
  gates.rejected = []
  if (options.connectors) {
    const allowed = new Set(options.connectors)
    records.grants = saved.filter((grant) => allowed.has(grant.connectorId))
  }
  state.model = scriptedModel(steps)
  const stop = answerApprovals("approved")
  try {
    const result = await runEngineTurn(turnArgs(options))
    return {
      error: result.error,
      prompts: state.prompts as any[],
      toolLists: state.toolLists as any[],
    }
  } finally {
    stop()
    records.grants = saved
  }
}

function listedTools(toolList: any[]): any[] {
  return Array.isArray(toolList) ? toolList : []
}

function toolResults(prompts: any[], toolName: string): any[] {
  return prompts.flatMap((prompt) =>
    (Array.isArray(prompt) ? prompt : [])
      .flatMap((message: any) => (Array.isArray(message?.content) ? message.content : []))
      .filter((part: any) => part?.type === "tool-result" && part.toolName === toolName),
  )
}

function auditRow(toolName: string) {
  return records.calls.find((row) => row.toolName === toolName)
}

function expectListed(toolList: any[], toolName: string, source: string) {
  const tools = listedTools(toolList)
  const tool = tools.find((candidate) => candidate.name === toolName)
  expect(tool, `${source}: ${toolName} missing from the tool list given to the model`).toBeDefined()
  expect(tool.description, `${source}: ${toolName} needs a description`).toBeTruthy()
  expect(tool.inputSchema, `${source}: ${toolName} needs a schema`).toBeTruthy()
}

// ── Cases ───────────────────────────────────────────────────────────────────

interface Case {
  source: string
  toolName: string
  input: Record<string, unknown>
  contains: string
  storageProvider?: string
}

/** Which seeded connector each source's tools come from. */
const CONNECTOR_BY_SOURCE: Record<string, string> = {
  google_drive: "conn-gdrive",
  slack: "conn-slack",
  github: "conn-github",
  discord: "conn-discord",
  telegram: "conn-telegram",
  whatsapp: "conn-wa",
  onepassword: "conn-op",
  bitwarden: "conn-bw",
  protonpass: "conn-pp",
  supabase: "conn-supa",
  cloudflare_r2: "conn-r2",
  backblaze_b2: "conn-b2",
  s3_storage: "conn-s3",
  huggingface: "conn-hf",
  composio: "conn-composio",
}

const READS: Case[] = [
  {
    source: "google_drive",
    toolName: "gdrive_search",
    input: { query: "roadmap" },
    contains: "Roadmap",
  },
  {
    source: "slack",
    toolName: "slack_read_thread",
    input: { channel_id: "C1", thread_ts: "1700000000.000100" },
    contains: "Looks good",
  },
  {
    source: "github",
    toolName: "github_get_file",
    input: { repo: "acme/app", path: "src/a.ts" },
    contains: "export const a = 1",
  },
  {
    source: "discord",
    toolName: "discord_read_messages",
    input: { channel_id: "11111", limit: 5 },
    contains: "hello",
  },
  {
    source: "telegram",
    toolName: "telegram_read_messages",
    input: { limit: 5 },
    contains: "hi bot",
  },
  {
    source: "onepassword",
    toolName: "onepassword_search",
    input: { query: "Bank" },
    contains: "Bank",
  },
  {
    source: "bitwarden",
    toolName: "bitwarden_search",
    input: { query: "API_KEY" },
    contains: "API_KEY",
  },
  {
    source: "protonpass",
    toolName: "protonpass_search",
    input: { query: "Bank" },
    contains: "Bank",
  },
  {
    source: "supabase",
    toolName: "storage_list_files",
    input: { prefix: "reports/", limit: 5 },
    contains: "report.md",
    storageProvider: "supabase",
  },
  {
    source: "cloudflare_r2",
    toolName: "storage_list_files",
    input: { prefix: "", limit: 5 },
    contains: "artifact.txt",
    storageProvider: "cloudflare_r2",
  },
  {
    source: "backblaze_b2",
    toolName: "storage_list_files",
    input: { prefix: "", limit: 5 },
    contains: "artifact.txt",
    storageProvider: "backblaze_b2",
  },
  {
    source: "s3_storage",
    toolName: "storage_list_files",
    input: { prefix: "", limit: 5 },
    contains: "artifact.txt",
    storageProvider: "s3_storage",
  },
  {
    source: "huggingface",
    toolName: "storage_list_files",
    input: { prefix: "reports/", limit: 5 },
    contains: "reports/a.md",
    storageProvider: "huggingface",
  },
  {
    source: "composio",
    toolName: "composio_list_apps",
    input: {},
    contains: "gmail",
  },
]

const DANGEROUS: Case[] = [
  {
    source: "slack",
    toolName: "slack_send_message",
    input: { channel: "C1", text: "shipping" },
    contains: "1700000000.000900",
  },
  {
    source: "discord",
    toolName: "discord_send_message",
    input: { channel_id: "11111", content: "shipping" },
    contains: '"ok":true',
  },
  {
    source: "telegram",
    toolName: "telegram_send_message",
    input: { chat_id: "7", text: "shipping" },
    contains: "message_id",
  },
  {
    source: "whatsapp",
    toolName: "whatsapp_send_message",
    input: { to: "+14155550123", text: "shipping" },
    contains: "wamid.1",
  },
  {
    source: "onepassword",
    toolName: "onepassword_read",
    input: { query: "i1", vault: "v1" },
    contains: "1234",
  },
  {
    source: "bitwarden",
    toolName: "bitwarden_read",
    input: { query: "API_KEY" },
    contains: "secret",
  },
  {
    source: "protonpass",
    toolName: "protonpass_read",
    input: { query: "p1" },
    contains: "1234",
  },
  {
    source: "supabase",
    toolName: "storage_upload_file",
    input: { path: "reports/new.md", content: "x" },
    contains: '"ok":true',
    storageProvider: "supabase",
  },
  {
    source: "cloudflare_r2",
    toolName: "storage_upload_file",
    input: { path: "reports/new.md", content: "x" },
    contains: '"ok":true',
    storageProvider: "cloudflare_r2",
  },
  {
    source: "backblaze_b2",
    toolName: "storage_upload_file",
    input: { path: "reports/new.md", content: "x" },
    contains: '"ok":true',
    storageProvider: "backblaze_b2",
  },
  {
    source: "s3_storage",
    toolName: "storage_upload_file",
    input: { path: "reports/new.md", content: "x" },
    contains: '"ok":true',
    storageProvider: "s3_storage",
  },
  {
    source: "huggingface",
    toolName: "storage_upload_file",
    input: { path: "reports/new.md", content: "x" },
    contains: '"ok":true',
    storageProvider: "huggingface",
  },
  {
    source: "composio",
    toolName: "composio_execute_tool",
    input: { tool: "GMAIL_FETCH_EMAILS", arguments: { query: "is:unread" } },
    contains: "GMAIL_FETCH_EMAILS",
  },
  {
    source: "composio",
    toolName: "composio_connect_app",
    input: { app: "gmail" },
    contains: "connect.composio.dev",
  },
]

describe("connector tools through a real engine turn", () => {
  it("offers each source's tool to the model and returns its vendor result into the conversation", async () => {
    for (const testCase of READS) {
      const { error, prompts, toolLists } = await runTurn([[testCase]], {
        storageProvider: testCase.storageProvider,
        connectors: [CONNECTOR_BY_SOURCE[testCase.source]!],
      })
      expect(error, `${testCase.source}: ${testCase.toolName} turn`).toBeNull()
      expectListed(toolLists[0], testCase.toolName, testCase.source)

      const results = toolResults(prompts, testCase.toolName)
      expect(results.length, `${testCase.source}: result never reached the model`).toBeGreaterThan(
        0,
      )
      expect(JSON.stringify(results), `${testCase.source}: result content`).toContain(
        testCase.contains,
      )
      expect(auditRow(testCase.toolName)?.status, `${testCase.source}: audit row`).toBe("done")
      expect(gates.approved, `${testCase.source}: ${testCase.toolName} is a read`).toHaveLength(0)
    }
  })

  it("gates each dangerous connector tool on approval and resumes the turn with the result", async () => {
    for (const testCase of DANGEROUS) {
      const { error, prompts, toolLists } = await runTurn([[testCase]], {
        storageProvider: testCase.storageProvider,
        connectors: [CONNECTOR_BY_SOURCE[testCase.source]!],
      })
      expect(error, `${testCase.source}: ${testCase.toolName} turn`).toBeNull()
      expectListed(toolLists[0], testCase.toolName, testCase.source)

      const row = auditRow(testCase.toolName)
      expect(row?.status, `${testCase.source}: approval row`).toBe("done")
      expect(
        gates.approved,
        `${testCase.source}: ${testCase.toolName} must wait for a human decision`,
      ).toContain(row!.id)

      const results = toolResults(prompts, testCase.toolName)
      expect(JSON.stringify(results), `${testCase.source}: approved result`).toContain(
        testCase.contains,
      )
    }
  })

  it("hands a rejection back to the model without calling the vendor", async () => {
    const saved = records.grants
    records.grants = saved.filter((grant) => grant.connectorId === "conn-slack")
    gates.approved = []
    gates.rejected = []
    state.model = scriptedModel([[DANGEROUS[0]!]])
    const stop = answerApprovals("rejected")
    try {
      const result = await runEngineTurn(turnArgs())
      expect(result.error).toBeNull()
      const results = toolResults(state.prompts as any[], "slack_send_message")
      expect(JSON.stringify(results)).toMatch(/rejected/i)
      expect(auditRow("slack_send_message")?.status).toBe("rejected")
      expect(gates.rejected).toContain(auditRow("slack_send_message")!.id)
      expect(vendor.requests.some((request) => request.path === "/api/chat.postMessage")).toBe(
        false,
      )
    } finally {
      stop()
      records.grants = saved
    }
  })

  it("returns grant violations as tool results the model can read", async () => {
    const refusals: { name: string; input: Record<string, unknown>; pattern: RegExp }[] = [
      {
        name: "composio_search_tools",
        input: { app: "notion" },
        pattern: /outside this agent's allowed apps/,
      },
      {
        name: "slack_read_thread",
        input: { channel_id: "C2", thread_ts: "1700000000.000100" },
        pattern: /outside this agent's allowed list/,
      },
      {
        name: "storage_read_file",
        input: { path: "other/secret.md" },
        pattern: /allowed storage prefixes/,
      },
    ]

    for (const refusal of refusals) {
      const before = vendor.requests.length
      const { error, prompts } = await runTurn(
        [[{ toolName: refusal.name, input: refusal.input }]],
        {
          connectors: [
            refusal.name.startsWith("composio")
              ? "conn-composio"
              : refusal.name.startsWith("storage")
                ? "conn-supa"
                : "conn-slack",
          ],
        },
      )
      expect(error).toBeNull()
      const results = toolResults(prompts, refusal.name)
      expect(JSON.stringify(results), `${refusal.name} refusal`).toMatch(refusal.pattern)
      const sent = vendor.requests
        .slice(before)
        .map((request) => request.path)
        // Slack resolves grant names through conversations.list before refusing.
        .filter(
          (path) =>
            !path.startsWith("/api/conversations.list") && !path.startsWith("/api/users.info"),
        )
      expect(sent, `${refusal.name} issued no data request`).toEqual([])
      // A refusal may be a returned value ("done") or a thrown scope error ("error"); either way
      // the model reads it as the tool's result and the turn continues.
      expect(["done", "error"]).toContain(auditRow(refusal.name)?.status)
    }
  })

  it("omits every ungranted source from the model's tool list", async () => {
    const { toolLists } = await runTurn(["text"], {
      caps: { storage: false },
      connectors: ["conn-slack"],
    })
    {
      const names = listedTools(toolLists[0]).map((tool) => tool.name)
      expect(names).toContain("slack_read_thread")
      expect(names).toContain("slack_send_message")
      for (const absent of [
        "gdrive_search",
        "github_search_code",
        "discord_read_messages",
        "telegram_read_messages",
        "whatsapp_send_message",
        "onepassword_search",
        "bitwarden_search",
        "protonpass_search",
        "composio_list_apps",
        "storage_list_files",
      ])
        expect(names, `${absent} must not be offered`).not.toContain(absent)
    }
  })

  it("keeps connectors reachable when the tool list exceeds the search threshold", async () => {
    // Every source granted plus the optional families: more than 40 tools, so the engine exposes a
    // catalog and `find_tools` instead of the whole set.
    const { error, toolLists } = await runTurn(
      [
        [{ toolName: "find_tools", input: { query: "slack send message" } }],
        [{ toolName: "slack_send_message", input: { channel: "C1", text: "found" } }],
        "text",
      ],
      { caps: { document: true, tasks: true, memory: true, secrets: true, github: true } },
    )
    expect(error).toBeNull()

    const first = listedTools(toolLists[0]).map((tool) => tool.name)
    expect(first).toContain("find_tools")
    expect(first, "the catalog must start hidden").not.toContain("slack_send_message")
    const second = listedTools(toolLists[1]).map((tool) => tool.name)
    expect(second, "find_tools must activate the connector tool for the next step").toContain(
      "slack_send_message",
    )
    expect(auditRow("slack_send_message")?.status).toBe("done")
    expect(gates.approved).toContain(auditRow("slack_send_message")!.id)
  })
})
