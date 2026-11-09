import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mockAdmin = {
  from: vi.fn(),
}

const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve(mockSupabase),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockAdmin,
}))

vi.mock("@/lib/auth", () => ({
  getRoomAccess: vi.fn(),
}))

import { getRoomAccess } from "@/lib/auth"
import { getRunTraceAction } from "../../src/lib/actions/trace"

describe("getRunTraceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fails if user session is expired", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: null } })
    const result = await getRunTraceAction({ orgSlug: "test-org", runId: "run-1" })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("expired")
  })

  it("fails if run trace is not found", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: "u-1" } } })
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "agent_runs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null }),
            }),
          }),
        }
      }
      return {}
    })

    const result = await getRunTraceAction({ orgSlug: "test-org", runId: "non-existent" })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("not found")
  })

  it("fails if user lacks room access", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: "u-1" } } })
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "agent_runs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "run-1",
                    room_id: "room-1",
                  },
                }),
            }),
          }),
        }
      }
      return {}
    })
    vi.mocked(getRoomAccess).mockResolvedValueOnce(null as any)

    const result = await getRunTraceAction({ orgSlug: "test-org", runId: "run-1" })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Access denied")
  })

  it("returns full trace with steps, tokens, and duration when authorized", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: "u-1" } } })
    vi.mocked(getRoomAccess).mockResolvedValueOnce({
      canAdmin: true,
      room: { id: "room-1" },
    } as any)

    const now = new Date()
    const later = new Date(now.getTime() + 450)

    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "agent_runs") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "run-1",
                    room_id: "room-1",
                    status: "complete",
                    cost_usd: 0.042,
                    latency_ms: 450,
                    input_tokens: 1200,
                    output_tokens: 300,
                    agents: { display_name: "Writer Bot", handle: "writer" },
                    created_at: now.toISOString(),
                  },
                }),
              order: () => Promise.resolve({ data: [] }),
            }),
          }),
        }
      }
      if (table === "run_steps") {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      id: "step-1",
                      run_id: "run-1",
                      idx: 1,
                      kind: "model",
                      input_ref: null,
                      output: { text: "Thinking about the task..." },
                      usage: { inputTokens: 500, outputTokens: 50 },
                      started_at: now.toISOString(),
                      finished_at: later.toISOString(),
                    },
                    {
                      id: "step-2",
                      run_id: "run-1",
                      idx: 2,
                      kind: "tool",
                      input_ref: "computer_shell",
                      output: { toolResults: ["git log output"] },
                      usage: null,
                      started_at: now.toISOString(),
                      finished_at: later.toISOString(),
                    },
                  ],
                }),
            }),
          }),
        }
      }
      if (table === "run_transcripts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { plan: { steps: ["git", "write"] } } }),
            }),
          }),
        }
      }
      return {}
    })

    const result = await getRunTraceAction({ orgSlug: "test-org", runId: "run-1" })
    expect(result.ok).toBe(true)
    expect(result.trace).toBeDefined()
    expect(result.trace?.agentName).toBe("Writer Bot")
    expect(result.trace?.steps.length).toBe(2)
    expect(result.trace?.steps[0]?.kind).toBe("model")
    expect(result.trace?.steps[1]?.kind).toBe("tool")
    expect(result.trace?.steps[1]?.inputRef).toBe("computer_shell")
    expect(result.trace?.steps[0]?.durationMs).toBe(450)
  })
})
