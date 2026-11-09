import { describe, expect, it, vi } from "vitest"
import { buildTools } from "./index"
import type { ToolRuntime } from "./audited"
import type { agents } from "@sayabot/db"
import { DEFAULT_CAPABILITIES } from "@sayabot/core"

vi.mock("../env", () => ({
  getEnv: () => ({
    PORT: 4000,
    DATABASE_URL: "postgres://mock",
    MESH_KEK: "01234567890123456789012345678901",
    SAYABOT_KEK: "01234567890123456789012345678901",
    SUPABASE_URL: "https://mock.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "mock-key",
    ORCHESTRATOR_INTERNAL_SECRET: "mock-secret",
    COMPUTERD_URL: "http://computerd:4100",
    EGRESS_URL: "http://egress:8081",
    EGRESS_PROXY_URL: "http://egress:8080",
    COMPUTE_ENABLED: true,
  }),
}))

vi.mock("../db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  }),
}))

vi.mock("@sayabot/llm", () => ({
  connectMcpServers: vi.fn().mockResolvedValue({
    tools: {},
    meta: {},
    errors: [],
    close: vi.fn(),
  }),
  openSecret: vi.fn(),
}))

describe("buildTools capability filtering", () => {
  const dummyRuntime: ToolRuntime = {
    agentId: "agent-1",
    orgId: "org-1",
    roomId: "room-1",
    runId: "run-1",
    messageId: "msg-1",
  }

  const baseAgent = {
    id: "agent-1",
    orgId: "org-1",
    handle: "testbot",
    displayName: "Test Bot",
    kind: "internal" as const,
    providerKeyId: "pk-1",
    model: "claude-3-5-sonnet",
    temperature: "0.7",
    systemPrompt: "You are a test bot.",
    params: {},
    toolIds: [],
    capabilities: DEFAULT_CAPABILITIES,
    templateId: null,
    ownerUserId: null,
    visibility: "org" as const,
    avatar: null,
    bio: null,
    roomIds: null,
    oauthClientId: null,
    webhookUrl: null,
    webhookSecretEnc: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as typeof agents.$inferSelect

  it("builds default tools when capabilities are default (backwards compatible)", async () => {
    const result = await buildTools({
      roomId: "room-1",
      orgId: "org-1",
      agent: baseAgent,
      runtime: dummyRuntime,
    })

    const toolNames = Object.keys(result.tools)
    // Default capabilities has canvas, tasks, sandbox, webSearch, github, postgres
    expect(toolNames).toContain("canvas_write")
    expect(toolNames).toContain("canvas_patch")
    expect(toolNames).toContain("code_sandbox")
    expect(toolNames).toContain("web_search")
    expect(toolNames).toContain("github_bridge")
    expect(toolNames).toContain("postgres_inspector")
    expect(toolNames).toContain("list_tasks")
    expect(toolNames).toContain("cronjob")

    // Computer tools and use_secret should not be in default capabilities
    expect(toolNames).not.toContain("computer_shell")
    expect(toolNames).not.toContain("use_secret")

    await result.close()
  })

  it("filters tools based on explicit capabilities", async () => {
    const result = await buildTools({
      roomId: "room-1",
      orgId: "org-1",
      agent: {
        ...baseAgent,
        capabilities: {
          canvas: false,
          tasks: false,
          sandbox: false,
          webSearch: true,
          github: false,
          postgres: false,
          mcp: false,
          computer: false,
          secrets: false,
          memory: false,
        },
      } as unknown as typeof agents.$inferSelect,
      runtime: dummyRuntime,
    })

    const toolNames = Object.keys(result.tools)
    expect(toolNames).toContain("web_search")
    expect(toolNames).toContain("update_plan")
    expect(toolNames).toContain("load_skill")
    expect(toolNames).not.toContain("fs_read")

    await result.close()
  })

  it("replaces code_sandbox with computer tools when computer capability is enabled", async () => {
    const result = await buildTools({
      roomId: "room-1",
      orgId: "org-1",
      agent: {
        ...baseAgent,
        capabilities: {
          canvas: false,
          tasks: false,
          sandbox: true, // requested, but should be dropped because computer is enabled
          webSearch: false,
          github: false,
          postgres: false,
          mcp: false,
          computer: { profile: "standard" },
          secrets: true,
        },
      } as unknown as typeof agents.$inferSelect,
      runtime: dummyRuntime,
    })

    const toolNames = Object.keys(result.tools)
    expect(toolNames).not.toContain("code_sandbox")
    expect(toolNames).toContain("computer_shell")
    expect(toolNames).toContain("fs_read")
    expect(toolNames).toContain("fs_edit")
    expect(toolNames).toContain("fs_write")
    expect(toolNames).toContain("fs_glob")
    expect(toolNames).toContain("fs_grep")
    expect(toolNames).toContain("git_status")
    expect(toolNames).toContain("git_diff")
    expect(toolNames).toContain("git_commit")
    expect(toolNames).toContain("git_push")
    expect(toolNames).toContain("computer_read_file")
    expect(toolNames).toContain("computer_write_file")
    expect(toolNames).toContain("computer_list")
    expect(toolNames).toContain("computer_publish")
    expect(toolNames).toContain("use_secret")

    await result.close()
  })

  it("includes browser tools when computer profile is browser", async () => {
    const result = await buildTools({
      roomId: "room-1",
      orgId: "org-1",
      agent: {
        ...baseAgent,
        capabilities: {
          canvas: false,
          tasks: false,
          sandbox: false,
          webSearch: false,
          github: false,
          postgres: false,
          mcp: false,
          computer: { profile: "browser" },
          secrets: false,
        },
      } as unknown as typeof agents.$inferSelect,
      runtime: dummyRuntime,
    })

    const toolNames = Object.keys(result.tools)
    expect(toolNames).toContain("computer_shell")
    expect(toolNames).toContain("browser_open")
    expect(toolNames).toContain("browser_snapshot")
    expect(toolNames).toContain("browser_click")
    expect(toolNames).toContain("browser_type")
    expect(toolNames).toContain("browser_extract")
    expect(toolNames).toContain("browser_screenshot")

    await result.close()
  })
})
