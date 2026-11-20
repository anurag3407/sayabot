import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { connectMcpServers, mcpToolName, type McpServerConfig } from "./mcp"

const mocks = vi.hoisted(() => ({ create: vi.fn(), egress: vi.fn() }))
vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: mocks.create }))
vi.mock("@sayabot/core/server", () => ({ assertSafeEgressHost: mocks.egress }))

type Definition = {
  name: string
  inputSchema: { type: "object" }
  annotations?: Record<string, unknown>
}
const definition = (name: string, annotations?: Record<string, unknown>): Definition => ({
  name,
  inputSchema: { type: "object" },
  annotations,
})
const server = (
  id = "one",
  name = "Example Server",
  extra: Partial<McpServerConfig> = {},
): McpServerConfig => ({
  id,
  name,
  transport: "http",
  url: `https://${id}.example.com/mcp`,
  dangerousTools: [],
  ...extra,
})
function client(names = ["read"]) {
  return {
    listTools: vi.fn().mockResolvedValue({ tools: names.map((name) => definition(name)) }),
    toolsFromDefinitions: vi.fn(({ tools }: { tools: Definition[] }) =>
      Object.fromEntries(
        tools.map((item) => [
          item.name,
          {
            description: `Tool ${item.name}`,
            inputSchema: item.inputSchema,
            metadata: { annotations: item.annotations },
            execute: vi.fn(),
          },
        ]),
      ),
    ),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] }),
    close: vi.fn().mockResolvedValue(undefined),
  }
}
const never = () => new Promise<never>(() => {})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.egress.mockResolvedValue(["93.184.216.34"])
  vi.stubEnv("ALLOW_LOCAL_MCP", "false")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe("MCP tool discovery and naming", () => {
  it("preserves common names and makes unusual names provider-safe", () => {
    expect(mcpToolName("GitHub", "list_issues")).toBe("github__list_issues")
    expect(mcpToolName("My Server", "Get-Item")).toBe("my_server__Get-Item")
    for (const [name, tool] of [
      ["!!!", ""],
      ["東京", "a.b/c?!"],
      ["x".repeat(100), "y".repeat(100)],
    ]) {
      expect(mcpToolName(name!, tool!)).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
    }
  })

  it("connects servers and exposes tools in deterministic sorted order", async () => {
    const a = client(["z", "a"])
    const b = client(["second", "first"])
    mocks.create.mockImplementation(({ transport }) => (transport.url.includes("one.") ? a : b))
    const configs = [server("two", "Z server"), server("one", "A server")]
    const first = await connectMcpServers(configs)
    expect(mocks.create.mock.calls.map(([config]) => config.transport.url)).toEqual([
      configs[1]!.url,
      configs[0]!.url,
    ])
    expect(Object.keys(first.tools)).toEqual([
      "a_server__a",
      "a_server__z",
      "z_server__first",
      "z_server__second",
    ])
    a.listTools.mockResolvedValue({ tools: [definition("a"), definition("z")] })
    const second = await connectMcpServers([...configs].reverse())
    expect(Object.keys(second.tools)).toEqual(Object.keys(first.tools))
    expect(second.meta).toEqual(first.meta)
    await first.close()
    await second.close()
  })

  it("retains every colliding, sanitized and truncated name with stable unique routing", async () => {
    const names = [
      "a b",
      "a_b",
      "a/b",
      "t".repeat(100),
      `${"t".repeat(99)}z`,
      "__proto__",
      "constructor",
    ]
    const a = client(names)
    const b = client(names)
    mocks.create.mockImplementation(({ transport }) => (transport.url.includes("one.") ? a : b))
    const configs = [server("one", "Same Server"), server("two", "Same-Server")]
    const first = await connectMcpServers(configs)
    expect(Object.keys(first.tools)).toHaveLength(names.length * 2)
    expect(first.meta.same_server__a_b?.originalName).toBe("a_b")
    for (const name of Object.keys(first.tools)) expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
    a.listTools.mockResolvedValue({ tools: [...names].reverse().map((name) => definition(name)) })
    const second = await connectMcpServers([...configs].reverse())
    expect(second.meta).toEqual(first.meta)
    for (const info of Object.values(first.meta))
      await first.call(info.serverId, info.originalName, { input: "test" })
    expect(a.callTool.mock.calls.map(([args]) => args.name).sort()).toEqual([...names].sort())
    expect(b.callTool).toHaveBeenCalledTimes(names.length)
    await first.close()
    await second.close()
  })

  it("does not let generated suffix names steal reserved common names", async () => {
    const a = client(["a b", "a_b"])
    mocks.create.mockResolvedValue(a)
    const first = await connectMcpServers([server()])
    const suffixName = Object.keys(first.tools).find((name) => name !== "example_server__a_b")!
    await first.close()
    const originalSuffix = suffixName.slice("example_server__".length)
    const b = client(["a b", "a_b", originalSuffix])
    mocks.create.mockResolvedValue(b)
    const second = await connectMcpServers([server()])
    expect(second.meta[suffixName]?.originalName).toBe(originalSuffix)
    expect(Object.keys(second.tools)).toHaveLength(3)
    await second.close()
  })

  it("propagates only recognized annotations without changing configured dangerousTools", async () => {
    const c = client()
    c.listTools.mockResolvedValue({
      tools: [
        definition("delete", {
          readOnlyHint: true,
          destructiveHint: false,
          title: "x".repeat(300),
          approval: false,
          openWorldHint: "false",
        }),
        definition("read", { destructiveHint: true, idempotentHint: false, openWorldHint: true }),
      ],
    })
    mocks.create.mockResolvedValue(c)
    const result = await connectMcpServers([
      server("one", "Example", { dangerousTools: ["delete"] }),
    ])
    expect(result.meta.example__delete).toMatchObject({
      dangerous: true,
      annotations: { readOnlyHint: true, destructiveHint: false, title: "x".repeat(200) },
    })
    expect(result.meta.example__delete?.annotations).not.toHaveProperty("approval")
    expect(result.meta.example__delete?.annotations).not.toHaveProperty("openWorldHint")
    expect(result.meta.example__read?.dangerous).toBe(false)
    expect(result.meta.example__read?.annotations).toEqual({
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    await result.close()
  })

  it("paginates with bounded SDK request options and sorts across pages", async () => {
    const c = client()
    c.listTools
      .mockResolvedValueOnce({ tools: [definition("z")], nextCursor: "page-2" })
      .mockResolvedValueOnce({ tools: [definition("a")] })
    mocks.create.mockResolvedValue(c)
    const result = await connectMcpServers([server()], { timeoutMs: 500 })
    expect(Object.keys(result.tools)).toEqual(["example_server__a", "example_server__z"])
    expect(c.listTools.mock.calls[1]![0]).toMatchObject({
      params: { cursor: "page-2" },
      options: { timeout: 500, maxTotalTimeout: 500 },
    })
    expect(mocks.create.mock.calls[0]![0].initializationOptions.signal).toBeInstanceOf(AbortSignal)
    expect(mocks.create.mock.calls[0]![0].maxRetries).toBe(0)
    await result.close()
  })

  it.each(["duplicate", "repeated-cursor", "oversized"])(
    "fails closed for a %s tool catalog and closes the client",
    async (kind) => {
      const c = client()
      if (kind === "duplicate")
        c.listTools.mockResolvedValue({ tools: [definition("same"), definition("same")] })
      if (kind === "repeated-cursor")
        c.listTools.mockResolvedValue({ tools: [], nextCursor: "same-page" })
      if (kind === "oversized")
        c.listTools.mockResolvedValue({
          tools: Array.from({ length: 1001 }, (_, n) => definition(`t${n}`)),
        })
      mocks.create.mockResolvedValue(c)
      const result = await connectMcpServers([server()])
      expect(result.tools).toEqual({})
      expect(result.meta).toEqual({})
      expect(result.errors).toHaveLength(1)
      expect(c.close).toHaveBeenCalledOnce()
      await expect(result.call("one", "same", {})).rejects.toThrow("not connected")
      await result.close()
      expect(c.close).toHaveBeenCalledOnce()
    },
  )
})

describe("MCP network validation", () => {
  it.each([
    "http://example.com/mcp",
    "ftp://example.com/mcp",
    "file:///etc/passwd",
    "https://user:secret@example.com/mcp",
    "https://example.com/mcp#fragment",
    "not-a-url",
  ])("rejects %s before creating a client", async (url) => {
    const result = await connectMcpServers([server("one", "Example", { url })])
    expect(result.errors).toHaveLength(1)
    expect(mocks.create).not.toHaveBeenCalled()
    await result.close()
  })

  it("checks SSRF even under NODE_ENV=test, forbids redirects, and fails before connecting on blocked hosts", async () => {
    mocks.egress.mockRejectedValue(new Error("SSRF blocked"))
    const blocked = await connectMcpServers([
      server("one", "Blocked", { url: "https://127.0.0.1/mcp" }),
    ])
    expect(blocked.errors[0]?.message).toBe("SSRF blocked")
    expect(mocks.create).not.toHaveBeenCalled()
    mocks.egress.mockResolvedValue(["93.184.216.34"])
    mocks.create.mockResolvedValue(client())
    const good = await connectMcpServers([server()])
    expect(mocks.egress).toHaveBeenCalledWith("one.example.com")
    expect(mocks.create.mock.calls[0]![0].transport.redirect).toBe("error")
    await blocked.close()
    await good.close()
  })

  it("retains the explicit local development opt-in but never permits non-HTTP protocols", async () => {
    vi.stubEnv("ALLOW_LOCAL_MCP", "true")
    mocks.create.mockResolvedValue(client())
    const local = await connectMcpServers([
      server("one", "Local", { url: "http://localhost:8080/mcp", transport: "sse" }),
    ])
    expect(local.errors).toEqual([])
    expect(mocks.egress).not.toHaveBeenCalled()
    const invalid = await connectMcpServers([server("two", "Bad", { url: "file:///tmp/socket" })])
    expect(invalid.errors).toHaveLength(1)
    expect(mocks.create).toHaveBeenCalledOnce()
    await local.close()
    await invalid.close()
  })

  it("rejects unsupported transports and duplicate IDs instead of misrouting calls", async () => {
    const result = await connectMcpServers([
      server("same", "A"),
      server("same", "B"),
      server("other", "C", { transport: "stdio" as "http" }),
    ])
    expect(result.errors).toHaveLength(3)
    expect(mocks.create).not.toHaveBeenCalled()
    await result.close()
  })
})

describe("MCP lifecycle and fail-closed execution", () => {
  it("closes discovery failures immediately and preserves healthy servers", async () => {
    const bad = client()
    bad.listTools.mockRejectedValue(new Error("discovery failed"))
    const good = client()
    mocks.create.mockImplementation(({ transport }) =>
      transport.url.includes("bad.") ? bad : good,
    )
    const result = await connectMcpServers([server("bad", "Bad"), server("good", "Good")])
    expect(Object.keys(result.tools)).toEqual(["good__read"])
    expect(bad.close).toHaveBeenCalledOnce()
    expect(good.close).not.toHaveBeenCalled()
    await expect(result.call("bad", "read", {})).rejects.toThrow("not connected")
    await result.close()
    await result.close()
    expect(good.close).toHaveBeenCalledOnce()
    await expect(result.call("good", "read", {})).rejects.toThrow("not connected")
  })

  it("forwards raw arguments and text/resource results, not undiscovered tool names", async () => {
    const c = client()
    c.callTool.mockResolvedValue({
      content: [
        { type: "text", text: "one" },
        { type: "resource", resource: { uri: "doc://two", text: "two" } },
        { type: "image", data: "not-forwarded" },
      ],
    })
    mocks.create.mockResolvedValue(c)
    const result = await connectMcpServers([server()])
    await expect(result.call("one", "hidden", {})).rejects.toThrow("not connected")
    expect(c.callTool).not.toHaveBeenCalled()
    expect(await result.call("one", "read", { value: 3 })).toBe("one\ntwo\n[image]")
    expect(c.callTool.mock.calls[0]![0]).toMatchObject({
      name: "read",
      arguments: { value: 3 },
      options: { timeout: 30_000 },
    })
    await result.close()
  })

  it("keeps the server connected after a tool-level isError result", async () => {
    const c = client()
    c.callTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "issue not found" }],
    })
    mocks.create.mockResolvedValue(c)
    const result = await connectMcpServers([server()])
    await expect(result.call("one", "read", {})).rejects.toThrow("issue not found")
    expect(c.close).not.toHaveBeenCalled()
    expect(Object.keys(result.tools)).toEqual(["example_server__read"])
    expect(await result.call("one", "read", {})).toBe("ok")
    await result.close()
  })

  it("connects servers concurrently", async () => {
    let inFlight = 0
    let peak = 0
    mocks.create.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 20))
      inFlight--
      return client()
    })
    const result = await connectMcpServers([server("a", "A"), server("b", "B"), server("c", "C")])
    expect(peak).toBe(3)
    expect(Object.keys(result.tools)).toEqual(["a__read", "b__read", "c__read"])
    await result.close()
  })

  it.each(["rejection", "malformed"])(
    "closes a client after %s and prevents subsequent calls",
    async (kind) => {
      const c = client()
      if (kind === "rejection") c.callTool.mockRejectedValue(new Error("network lost"))
      if (kind === "malformed")
        c.callTool.mockResolvedValue({ content: [{ type: "text", text: {} }] })
      mocks.create.mockResolvedValue(c)
      const result = await connectMcpServers([server()])
      await expect(result.call("one", "read", {})).rejects.toThrow()
      expect(result.tools).toEqual({})
      expect(result.meta).toEqual({})
      expect(c.close).toHaveBeenCalledOnce()
      await expect(result.call("one", "read", {})).rejects.toThrow("not connected")
      expect(c.callTool).toHaveBeenCalledOnce()
      await result.close()
    },
  )

  it("also guards direct SDK tool execution and propagates cancellation without dropping the server", async () => {
    const c = client()
    mocks.create.mockResolvedValue(c)
    const result = await connectMcpServers([server()])
    const execute = result.tools.example_server__read!.execute!
    const controller = new AbortController()
    c.callTool.mockImplementation(
      ({ options }) =>
        new Promise((_, reject) =>
          options.signal.addEventListener("abort", () => reject(new Error("cancelled")), {
            once: true,
          }),
        ),
    )
    const call = Promise.resolve(
      execute(
        {},
        { toolCallId: "call", messages: [], context: {}, abortSignal: controller.signal },
      ),
    )
    const rejected = expect(call).rejects.toThrow()
    await vi.waitFor(() => expect(c.callTool).toHaveBeenCalledOnce())
    controller.abort(new Error("caller stopped"))
    await rejected
    expect(c.callTool.mock.calls[0]![0].options.signal.aborted).toBe(true)
    expect(c.close).not.toHaveBeenCalled()
    await result.close()
    expect(c.close).toHaveBeenCalledOnce()
  })

  it("closes clients on uncaught transport errors and lifetime cancellation", async () => {
    const c = client()
    mocks.create.mockResolvedValue(c)
    const controller = new AbortController()
    const result = await connectMcpServers([server()], { signal: controller.signal })
    mocks.create.mock.calls[0]![0].onUncaughtError(new Error("transport failed"))
    await expect(result.call("one", "read", {})).rejects.toThrow("not connected")
    expect(result.tools).toEqual({})
    controller.abort()
    await result.close()
    expect(c.close).toHaveBeenCalledOnce()
  })

  it("bounds startup and closes a client that resolves after cancellation", async () => {
    vi.useFakeTimers()
    const c = client()
    let resolveClient!: (value: ReturnType<typeof client>) => void
    mocks.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveClient = resolve
        }),
    )
    const pending = connectMcpServers([server()], { timeoutMs: 10 })
    await vi.advanceTimersByTimeAsync(11)
    const result = await pending
    expect(result.errors[0]?.message).toContain("timed out")
    expect(mocks.create.mock.calls[0]![0].initializationOptions.signal.aborted).toBe(true)
    resolveClient(c)
    await vi.advanceTimersByTimeAsync(0)
    expect(c.close).toHaveBeenCalledOnce()
    expect(c.listTools).not.toHaveBeenCalled()
    await result.close()
  })

  it("bounds a stalled tool listing and prevents late catalog publication", async () => {
    vi.useFakeTimers()
    const c = client()
    c.listTools.mockImplementation(never)
    mocks.create.mockResolvedValue(c)
    const pending = connectMcpServers([server()], { timeoutMs: 10 })
    await vi.advanceTimersByTimeAsync(11)
    const result = await pending
    expect(result.errors).toHaveLength(1)
    expect(result.tools).toEqual({})
    expect(c.close).toHaveBeenCalledOnce()
    expect(c.listTools.mock.calls[0]![0].options.signal.aborted).toBe(true)
    await result.close()
  })

  it("bounds calls and cleanup even when neither settles after abort", async () => {
    vi.useFakeTimers()
    const c = client()
    c.callTool.mockImplementation(never)
    c.close.mockImplementation(never)
    mocks.create.mockResolvedValue(c)
    const result = await connectMcpServers([server()], { callTimeoutMs: 10, closeTimeoutMs: 5 })
    const rejected = expect(result.call("one", "read", {})).rejects.toThrow("timed out")
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    expect(c.callTool.mock.calls[0]![0].options.signal.aborted).toBe(true)
    expect(c.close).toHaveBeenCalledOnce()
    await result.close()
  })

  it("aborts active calls when the result is closed", async () => {
    const c = client()
    c.callTool.mockImplementation(never)
    mocks.create.mockResolvedValue(c)
    const result = await connectMcpServers([server()])
    const rejected = expect(result.call("one", "read", {})).rejects.toThrow("closed")
    await vi.waitFor(() => expect(c.callTool).toHaveBeenCalledOnce())
    await result.close()
    await rejected
    expect(c.callTool.mock.calls[0]![0].options.signal.aborted).toBe(true)
    expect(c.close).toHaveBeenCalledOnce()
  })

  it("does not start SDK work when already cancelled", async () => {
    const controller = new AbortController()
    controller.abort(new Error("stopped"))
    const result = await connectMcpServers([server()], { signal: controller.signal })
    expect(result.tools).toEqual({})
    expect(result.errors).toHaveLength(1)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.egress).not.toHaveBeenCalled()
    await result.close()
  })
})
