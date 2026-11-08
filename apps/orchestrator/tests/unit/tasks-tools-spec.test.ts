import { describe, expect, it } from "vitest"
import { taskTools } from "../../src/tools/builtins/tasks"

describe("taskTools spec surface", () => {
  const tools = taskTools({ roomId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222", agentId: "33333333-3333-4333-8333-333333333333", handle: "ada" })

  it("exposes the collab tool set with unique names", () => {
    const names = tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(["list_tasks", "create_task", "claim_task", "update_task", "report_checkin"]))
    expect(new Set(names).size).toBe(names.length)
  })

  it("every tool has a description and a working zod schema", () => {
    for (const t of tools) {
      expect(t.description.length, t.name).toBeGreaterThan(20)
      expect(typeof t.execute).toBe("function")
    }
  })

  it("schemas reject obviously invalid input", () => {
    const create = tools.find((t) => t.name === "create_task")!
    expect(create.schema.safeParse({ title: "x" }).success).toBe(false) // title < 2 chars
    expect(create.schema.safeParse({ title: "Ship it" }).success).toBe(true)
    const claim = tools.find((t) => t.name === "claim_task")!
    expect(claim.schema.safeParse({ task_id: "not-a-uuid" }).success).toBe(false)
    expect(claim.schema.safeParse({ task_id: "11111111-1111-4111-8111-111111111111" }).success).toBe(true)
  })

  it("none of the board tools are marked dangerous (human gate lives elsewhere)", () => {
    for (const t of tools) expect(t.dangerous, t.name).toBe(false)
  })
})
