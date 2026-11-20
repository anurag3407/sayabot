/**
 * The marketplace/MCP connector path, end to end against a local MCP server.
 *
 * Settings and the agent use two different clients, so both are driven here against the same
 * stub server: `lib/mcp-client.ts` (save → "list tools" connection test → "try a tool") and
 * `@sayabot/llm`'s `connectMcpServers` (what an agent loads, including approval gating).
 * The only thing stubbed is the vendor; URL rules, header decryption and JSON-RPC are real.
 */

import { createServer, type Server } from "node:http"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { connectMcpServers, isDangerousMcpTool, sealSecret } from "@sayabot/llm"
import { findMarketplaceApp, appForHost } from "../../src/lib/marketplace"
import {
  STDIO_TOOLS_MESSAGE,
  assertMcpTestable,
  assertMcpUrl,
  callMcpServerTool,
  listMcpServerTools,
  type McpServerRow,
} from "../../src/lib/mcp-client"

// 32 bytes, base64 — the shape sealSecret/openSecret require.
const KEK = Buffer.alloc(32, 7).toString("base64")
const TOKEN = "stub-token-abc"

interface Call {
  method: string
  path: string
  auth: string | undefined
  tool: string | undefined
}

let server: Server
let origin = ""
const calls: Call[] = []

function mcpResult(id: unknown, name: string, args: Record<string, unknown>) {
  if (name === "search_issues") {
    return {
      content: [{ type: "text", text: `issue PROJ-1 matches ${String(args.query ?? "")}` }],
      isError: false,
    }
  }
  if (name === "create_issue") {
    return { content: [{ type: "text", text: "created PROJ-2" }], isError: false }
  }
  return { content: [{ type: "text", text: `unknown tool ${name}` }], isError: true, _id: id }
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      let body: {
        id?: unknown
        method?: string
        params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string }
      } = {}
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        body = {}
      }
      calls.push({
        method: req.method ?? "GET",
        path: url.pathname,
        auth: req.headers.authorization,
        tool: body.params?.name,
      })

      if (url.pathname === "/broken") {
        res.writeHead(500, { "Content-Type": "application/json" })
        return res.end(JSON.stringify({ error: "boom" }))
      }

      if (req.method === "DELETE") {
        res.writeHead(200).end()
        return
      }
      if (req.method !== "POST") {
        res.writeHead(405).end()
        return
      }

      const id = body.id ?? null
      const send = (result: unknown) => {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "stub-session",
        })
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result }))
      }

      switch (body.method) {
        case "initialize":
          return send({
            protocolVersion: body.params?.protocolVersion ?? "2025-06-18",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "stub-atlassian", version: "1.0.0" },
          })
        case "notifications/initialized":
          res.writeHead(202).end()
          return
        case "tools/list":
          return send({
            tools: [
              {
                name: "search_issues",
                description: "Search Jira issues",
                inputSchema: { type: "object", properties: { query: { type: "string" } } },
                annotations: { readOnlyHint: true },
              },
              {
                name: "create_issue",
                description: "Create a Jira issue",
                inputSchema: { type: "object", properties: { summary: { type: "string" } } },
              },
            ],
          })
        case "tools/call":
          return send(mcpResult(id, body.params?.name ?? "", body.params?.arguments ?? {}))
        default:
          res.writeHead(400, { "Content-Type": "application/json" })
          return res.end(
            JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "no method" } }),
          )
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
})

afterAll(() => server.close())

function row(path = "/mcp", name = "Atlassian"): McpServerRow {
  return {
    id: "mcp-1",
    name,
    transport: "http",
    url: `${origin}${path}`,
    headers_enc: sealSecret(JSON.stringify({ headers: { Authorization: `Bearer ${TOKEN}` } }), KEK),
  }
}

describe("marketplace app connection (settings)", () => {
  // The stub is plain HTTP on loopback; the same opt-in the orchestrator needs for local MCP.
  const previousAllowLocal = process.env.ALLOW_LOCAL_MCP
  beforeEach(() => {
    process.env.ALLOW_LOCAL_MCP = "true"
  })
  afterAll(() => {
    if (previousAllowLocal === undefined) delete process.env.ALLOW_LOCAL_MCP
    else process.env.ALLOW_LOCAL_MCP = previousAllowLocal
  })

  it("lists tools with the saved header, then calls one", async () => {
    const before = calls.length
    const tools = await listMcpServerTools(row(), { kek: KEK })
    expect(tools.map((tool) => tool.name)).toEqual(["search_issues", "create_issue"])
    expect(tools[0]?.description).toBe("Search Jira issues")

    const result = await callMcpServerTool(row(), { kek: KEK }, "search_issues", {
      query: "PROJ-1",
    })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).toContain("issue PROJ-1 matches PROJ-1")

    // Every request carried the decrypted header: the connection test and the tool call alike.
    const sent = calls.slice(before)
    expect(sent.length).toBeGreaterThan(3)
    expect(sent.every((call) => call.auth === `Bearer ${TOKEN}`)).toBe(true)
    expect(sent.some((call) => call.method === "tools/call" || call.tool === "search_issues")).toBe(
      true,
    )
  })

  it("reports a tool that fails as isError instead of claiming success", async () => {
    const result = await callMcpServerTool(row(), { kek: KEK }, "no_such_tool", {})
    expect(result.isError).toBe(true)
  })

  it("refuses an unreachable server", async () => {
    await expect(listMcpServerTools(row("/broken"), { kek: KEK })).rejects.toThrow()
  })

  it("refuses stdio programs in the web app, and explains why", () => {
    expect(() => assertMcpTestable({ ...row(), transport: "stdio", url: "stdio://x" })).toThrow(
      STDIO_TOOLS_MESSAGE,
    )
  })

  it("applies the same URL rules the agent enforces", () => {
    expect(() => assertMcpUrl("https://example.com/mcp")).not.toThrow()
    const previous = process.env.ALLOW_LOCAL_MCP
    delete process.env.ALLOW_LOCAL_MCP
    try {
      expect(() => assertMcpUrl("http://127.0.0.1:1234/mcp")).toThrow(/HTTPS/)
    } finally {
      if (previous === undefined) delete process.env.ALLOW_LOCAL_MCP
      else process.env.ALLOW_LOCAL_MCP = previous
    }
    expect(() => assertMcpUrl("https://user:pw@example.com/mcp")).toThrow(/credentials/)
  })
})

describe("marketplace app use (agent)", () => {
  it("connects, namespaces tools, gates writes and executes a call", async () => {
    process.env.ALLOW_LOCAL_MCP = "true"
    try {
      const connection = await connectMcpServers([
        {
          id: "mcp-1",
          name: "Atlassian",
          transport: "http",
          url: `${origin}/mcp`,
          headers: { Authorization: `Bearer ${TOKEN}` },
          dangerousTools: ["@writes"],
        },
        {
          id: "mcp-broken",
          name: "Broken",
          transport: "http",
          url: `${origin}/broken`,
          dangerousTools: [],
        },
      ])
      try {
        expect(connection.errors.map((error) => error.serverName)).toEqual(["Broken"])
        expect(Object.keys(connection.tools).sort()).toEqual([
          "atlassian__create_issue",
          "atlassian__search_issues",
        ])
        expect(connection.meta.atlassian__search_issues?.dangerous).toBe(false)
        expect(connection.meta.atlassian__create_issue?.dangerous).toBe(true)
        expect(connection.meta.atlassian__search_issues?.annotations?.readOnlyHint).toBe(true)

        const tool = connection.tools.atlassian__search_issues
        const output = await (tool as any)?.execute?.(
          { query: "PROJ-1" },
          { toolCallId: "t1", messages: [], context: undefined },
        )
        expect(JSON.stringify(output)).toContain("issue PROJ-1 matches PROJ-1")

        // Callers can also call by server id, and the read call is what reached the vendor.
        expect(await connection.call("mcp-1", "search_issues", { query: "PROJ-9" })).toContain(
          "PROJ-9",
        )
      } finally {
        await connection.close()
      }
    } finally {
      delete process.env.ALLOW_LOCAL_MCP
    }
  })

  it("treats every non-read tool as needing approval for @writes apps", () => {
    expect(isDangerousMcpTool(["@writes"], "create_issue")).toBe(true)
    expect(isDangerousMcpTool(["@writes"], "search_issues")).toBe(false)
    expect(isDangerousMcpTool(["*"], "search_issues")).toBe(true)
    expect(isDangerousMcpTool(["merge_pull_request"], "merge_pull_request")).toBe(true)
    expect(isDangerousMcpTool([], "delete_file")).toBe(false)
  })
})

describe("marketplace catalog (Jira / Atlassian route)", () => {
  it("routes Jira through the Atlassian app with sign-in, not a native connector", () => {
    const atlassian = findMarketplaceApp("atlassian")
    expect(atlassian).not.toBeNull()
    expect(atlassian?.transport).toBe("http")
    expect(atlassian?.auth.kind).toBe("oauth")
    const host = new URL(atlassian!.url).host
    expect(appForHost(host)?.id).toBe("atlassian")
  })

  it("keeps the token apps token-based and the write-heavy apps gated", () => {
    const github = findMarketplaceApp("github")
    expect(github?.auth.kind).toBe("token")
    expect(findMarketplaceApp("github")?.url).toBe("https://api.githubcopilot.com/mcp/")
    expect(findMarketplaceApp("stripe")?.dangerousTools).toContain("@writes")
    expect(findMarketplaceApp("notion")?.auth.kind).toBe("oauth")
    expect(findMarketplaceApp("atlassian")?.tagline).toMatch(/Confluence/)
  })
})
