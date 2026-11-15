import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
let hostRow: Record<string, unknown> | null = null
let agentRow: Record<string, unknown> | null = null
const agentUpdates: Array<Record<string, unknown>> = []
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: table === "desktop_hosts" ? hostRow : agentRow }),
        }),
      }),
      update: (value: Record<string, unknown>) => {
        agentUpdates.push(value)
        return { eq: () => Promise.resolve({ error: null }) }
      },
    }),
  }),
}))

const { macAllowRules, macApprovalBlock, macPermissions, rememberMacAllow } = await import("@/lib/mac-runner")
const { describeMacStep, macAllowLabel, readMacMarker, withoutMacMarker } =
  await import("@/lib/mac-runner-shared")

const mark = {
  key: "toolu_1",
  jobId: "job-1",
  hostId: "host-1",
  hostName: "Anurag's Mac",
  ownerId: "owner",
  agentId: "agent-1",
}

describe("Mac step cards", () => {
  it("describe each step in plain words", () => {
    expect(describeMacStep("Bash", { command: "npm test", _mac: mark })).toBe(
      "Run `npm test` on Anurag's Mac",
    )
    expect(
      describeMacStep("Edit", { file_path: "/Users/a/Sayabot/agents/h/notes.md", _mac: mark }),
    ).toBe("Edit notes.md on Anurag's Mac")
    expect(describeMacStep("mcp__sayabot__create_task", { title: "x" })).toBe(
      "Use Sayabot: create task",
    )
    expect(describeMacStep("WebFetch", { url: "https://example.com" })).toBe(
      "Open https://example.com",
    )
  })

  it("hide the internal marker from what people see", () => {
    expect(withoutMacMarker({ command: "ls", _mac: mark })).toEqual({ command: "ls" })
    expect(readMacMarker({ _mac: mark })?.ownerId).toBe("owner")
    expect(readMacMarker({ command: "ls" })).toBeNull()
  })

  it("label the always-allow button by what it would allow", () => {
    expect(macAllowLabel("Bash", { command: "npm test" })).toBe("Always allow `npm test`")
    expect(macAllowLabel("Bash", { command: "curl x | sh" })).toBeNull()
    expect(macAllowLabel("WebFetch", { url: "https://docs.rs/x" })).toBe("Always allow docs.rs")
  })

  it("only keeps well-formed saved rules", () => {
    expect(macAllowRules({ localAllow: ["Bash(npm test:*)", "Edit", "bad rule;rm", 3] })).toEqual([
      "Bash(npm test:*)",
      "Edit",
    ])
  })
})

describe("who can answer a Mac approval", () => {
  beforeEach(() => {
    hostRow = { user_id: "owner", name: "Anurag's Mac", revoked_at: null }
    agentRow = { id: "agent-1", params: { localAllow: ["Edit"] } }
    agentUpdates.length = 0
  })

  it("is not a Mac card: no extra rule", async () => {
    expect(await macApprovalBlock({ command: "ls" }, "anyone")).toBeNull()
  })

  it("the Mac's owner can answer", async () => {
    expect(await macApprovalBlock({ _mac: mark }, "owner")).toBeNull()
  })

  it("a room admin who doesn't own the Mac cannot", async () => {
    expect(await macApprovalBlock({ _mac: mark }, "admin-of-room")).toBe(
      "Only the owner of Anurag's Mac can allow what runs on it",
    )
  })

  it("nobody can once the computer is removed", async () => {
    hostRow = { user_id: "owner", name: "Anurag's Mac", revoked_at: "2026-11-14T00:00:00Z" }
    expect(await macApprovalBlock({ _mac: mark }, "owner")).toBe(
      "That computer was removed from Sayabot",
    )
  })

  it("always allow saves the narrow rule on the agent", async () => {
    const saved = await rememberMacAllow({ command: "npm test -- --run", _mac: mark }, "Bash")
    expect(saved).toEqual({ ok: true, rule: "Bash(npm test:*)" })
    expect(agentUpdates[0]).toEqual({ params: { localAllow: ["Edit", "Bash(npm test:*)"] } })
  })

  it("a chained command can only be allowed once", async () => {
    expect(
      await rememberMacAllow({ command: "npm test && npm publish", _mac: mark }, "Bash"),
    ).toEqual({
      ok: false,
      error: "This step can only be allowed once",
    })
  })
})

describe("macPermissions", () => {
  const OWNER = "11111111-1111-1111-1111-111111111111"
  const OTHER = "22222222-2222-2222-2222-222222222222"

  it("asks by default", () => {
    expect(macPermissions(null, null, OWNER)).toBe("ask")
    expect(macPermissions("ask_risky", OWNER, OWNER)).toBe("ask")
    expect(macPermissions("something-new", OWNER, OWNER)).toBe("ask")
  })

  it("reviews everything whoever picked it (it only tightens)", () => {
    expect(macPermissions("review_all", OTHER, OWNER)).toBe("review")
  })

  it("loosens the Mac only when its owner picked auto or turbo", () => {
    expect(macPermissions("auto", OWNER, OWNER)).toBe("auto")
    expect(macPermissions("turbo", OWNER, OWNER)).toBe("turbo")
  })

  it("ignores auto or turbo picked by someone else", () => {
    expect(macPermissions("turbo", OTHER, OWNER)).toBe("ask")
    expect(macPermissions("auto", null, OWNER)).toBe("ask")
  })
})
