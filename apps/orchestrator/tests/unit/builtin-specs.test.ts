import { beforeAll, describe, expect, it } from "vitest"

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://u:p@h/db"
  process.env.MESH_KEK = "k"
  process.env.SUPABASE_URL = "https://x.supabase.co"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc"
  process.env.ORCHESTRATOR_INTERNAL_SECRET = "0123456789abcdef"
})
import { githubTool } from "../../src/tools/builtins/github"
import { postgresInspectorTool } from "../../src/tools/builtins/postgres"
import { sandboxTool } from "../../src/tools/builtins/sandbox"
import { webSearchTool } from "../../src/tools/builtins/web-search"
import { computerTools } from "../../src/tools/builtins/computer"

describe("builtin tool specs (no network, schema + danger surface)", () => {
  it("github_bridge: only commit_file is dangerous", () => {
    const t = githubTool("org")
    expect(t.name).toBe("github_bridge")
    expect(typeof t.dangerous).toBe("function")
    const dangerous = t.dangerous as (a: Record<string, unknown>) => boolean
    expect(dangerous({ action: "commit_file" })).toBe(true)
    expect(dangerous({ action: "get_file" })).toBe(false)
    expect(dangerous({ action: "list_issues" })).toBe(false)
    expect(t.schema.safeParse({ action: "get_file", owner: "o", repo: "r" }).success).toBe(true)
    expect(t.schema.safeParse({ action: "nuke", owner: "o", repo: "r" }).success).toBe(false)
  })

  it("postgres_inspector: schema bounds the query; not dangerous", () => {
    const t = postgresInspectorTool("org")
    expect(t.dangerous).toBe(false)
    expect(t.schema.safeParse({ query: "select 1" }).success).toBe(true)
    expect(t.schema.safeParse({ query: "" }).success).toBe(false)
    expect(t.schema.safeParse({ query: "x".repeat(10_001) }).success).toBe(false)
  })

  it("code_sandbox: language enum and code bounds", () => {
    const t = sandboxTool()
    expect(t.schema.safeParse({ language: "python", code: "print(1)" }).success).toBe(true)
    expect(t.schema.safeParse({ language: "ruby", code: "x" }).success).toBe(false)
    expect(t.schema.safeParse({ language: "bash", code: "x", timeoutSeconds: 61 }).success).toBe(false)
    expect(t.schema.safeParse({ language: "bash", code: "x", timeoutSeconds: 60 }).success).toBe(true)
  })

  it("web_search: query bounds", () => {
    const t = webSearchTool()
    expect(t.schema.safeParse({ query: "hello" }).success).toBe(true)
    expect(t.schema.safeParse({ query: "" }).success).toBe(false)
    expect(t.schema.safeParse({ query: "q", count: 11 }).success).toBe(false)
    expect(t.schema.safeParse({ query: "q", count: 10 }).success).toBe(true)
  })

  it("computerTools: standard profile has no browser tools, browser profile does", () => {
    const args = { agentId: "a", orgId: "o", roomId: "r" }
    const std = computerTools({ ...args, profile: "standard" }).map((t) => t.name)
    const br = computerTools({ ...args, profile: "browser" }).map((t) => t.name)
    expect(std).toContain("computer_shell")
    expect(std).toContain("fs_read")
    expect(std).not.toContain("browser_open")
    expect(br).toContain("browser_open")
    // git_commit / git_push are the dangerous ones
    const byName = Object.fromEntries(computerTools({ ...args, profile: "standard" }).map((t) => [t.name, t]))
    expect(byName.git_commit!.dangerous).toBe(true)
    expect(byName.git_push!.dangerous).toBe(true)
    expect(byName.fs_read!.dangerous).toBe(false)
  })
})
