import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mockRoutines = [
  {
    id: "routine-1",
    org_id: "org-1",
    name: "Morning Briefing",
    schedule_expr: "0 9 * * 1-5",
    timezone: "UTC",
    prompt: "Summarize issues",
    enabled: true,
    run_count: 5,
    last_status: "success",
  },
]

vi.mock("../../src/lib/auth", () => ({
  getOrgAccess: async (slug: string) => {
    if (slug === "forbidden-org") return null
    return {
      org: { id: "org-1", slug: "test-org", name: "Test Org", ssoEnabled: false },
      role: "owner",
      user: { id: "user-1", email: "user@test.com", displayName: "Tester" },
    }
  },
}))

vi.mock("../../src/lib/orchestrator", () => ({
  runRoutineInOrchestrator: async (routineId: string) => {
    if (routineId === "routine-1") return { ok: true, status: 200 }
    return { ok: false, status: 400, error: "Routine not found" }
  },
}))

vi.mock("../../src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => ({
      select: () => {
        const query: any = {
          eq: () => query,
          order: () => Promise.resolve({ data: mockRoutines, error: null }),
          maybeSingle: () => Promise.resolve({ data: mockRoutines[0], error: null }),
        }
        return query
      },
      insert: (val: any) => ({
        select: () => ({
          single: () => Promise.resolve({ data: { ...val, id: "new-routine-id" }, error: null }),
        }),
      }),
    }),
  }),
}))

describe("Routines API routes", () => {
  it("GET /api/workspaces/[org]/routines returns 404 for unauthenticated or non-member org", async () => {
    const { GET } = await import("../../src/app/api/workspaces/[org]/routines/route")
    const res = await GET(new Request("http://localhost/api/workspaces/forbidden-org/routines"), {
      params: Promise.resolve({ org: "forbidden-org" }),
    })
    expect(res.status).toBe(404)
  })

  it("GET /api/workspaces/[org]/routines returns routines with human readable schedule", async () => {
    const { GET } = await import("../../src/app/api/workspaces/[org]/routines/route")
    const res = await GET(new Request("http://localhost/api/workspaces/test-org/routines"), {
      params: Promise.resolve({ org: "test-org" }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.routines).toBeDefined()
    expect(body.routines.length).toBe(1)
    expect(body.routines[0].human_schedule).toBe("Every weekday at 09:00")
  })

  it("POST /api/workspaces/[org]/routines rejects invalid cron expressions with 400", async () => {
    const { POST } = await import("../../src/app/api/workspaces/[org]/routines/route")
    const res = await POST(
      new Request("http://localhost/api/workspaces/test-org/routines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Invalid Routine",
          schedule_expr: "not a cron",
          agent_id: "agent-1",
          prompt: "Do something",
        }),
      }),
      { params: Promise.resolve({ org: "test-org" }) },
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toContain("Invalid schedule")
  })

  it("POST /api/workspaces/[org]/routines creates routine from natural language shorthand", async () => {
    const { POST } = await import("../../src/app/api/workspaces/[org]/routines/route")
    const res = await POST(
      new Request("http://localhost/api/workspaces/test-org/routines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Standup",
          schedule_expr: "daily at 9am",
          agent_id: "agent-1",
          prompt: "Morning update",
        }),
      }),
      { params: Promise.resolve({ org: "test-org" }) },
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body.routine.schedule_expr).toBe("0 9 * * *")
    expect(body.routine.human_schedule).toBe("Daily at 09:00")
  })

  it("POST /api/workspaces/[org]/routines/[id]/run triggers immediate execution", async () => {
    const { POST } = await import("../../src/app/api/workspaces/[org]/routines/[id]/run/route")
    const res = await POST(
      new Request("http://localhost/api/workspaces/test-org/routines/routine-1/run", {
        method: "POST",
      }),
      { params: Promise.resolve({ org: "test-org", id: "routine-1" }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.ok).toBe(true)
    expect(body.message).toContain("Morning Briefing")
  })
})
