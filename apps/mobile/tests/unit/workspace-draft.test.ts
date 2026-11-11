import { strict as assert } from "node:assert"
import { isDemoMode, setDemoMode, subscribeDemoMode } from "../../src/core/session-mode.ts"
import { delegationMessage, roomNameSlug, taskInsertRow, taskPriority } from "../../src/core/workspace-draft.ts"

let failures = 0
function test(name: string, fn: () => void) {
  try {
    fn()
    console.log("ok -", name)
  } catch (error) {
    failures++
    console.error("FAIL -", name, error)
  }
}

test("room names become stable slugs", () => {
  assert.equal(roomNameSlug("  Release Triage!! "), "release-triage")
  assert.equal(roomNameSlug("Ops - Deploy"), "ops-deploy")
  assert.equal(roomNameSlug("---"), "")
  assert.equal(roomNameSlug(""), "")
  assert.equal(roomNameSlug("special_ops_room"), "special_ops_room")
})

test("task priority is read from metadata", () => {
  assert.equal(taskPriority({ priority: "urgent" }), "urgent")
  assert.equal(taskPriority({ priority: "high" }), "high")
  assert.equal(taskPriority({ priority: "low" }), "low")
  assert.equal(taskPriority({ priority: "invalid" }), "medium")
  assert.equal(taskPriority({}), "medium")
  assert.equal(taskPriority(null), "medium")
  assert.equal(taskPriority(undefined), "medium")
  assert.equal(taskPriority([1, 2, 3]), "medium")
  assert.equal(taskPriority("not an object"), "medium")
})

test("task insert does not invent a priority column or a number", () => {
  const row = taskInsertRow({
    orgId: "org",
    roomId: "room",
    userId: "user",
    title: " Audit deps ",
    description: "  ",
    priority: "high",
    budgetTurns: 8,
  })
  assert.equal(row.org_id, "org")
  assert.equal(row.room_id, "room")
  assert.equal(row.title, "Audit deps")
  assert.equal(row.description, "")
  assert.equal(row.budget_turns, 8)
  assert.deepEqual(row.metadata, { priority: "high" })
  assert.equal("priority" in row, false)
  assert.equal("number" in row, false)
})

test("task insert sanitizes budget turns and defaults priority", () => {
  const defaultRow = taskInsertRow({
    orgId: "org",
    roomId: "room",
    userId: "user",
    title: "Basic task",
  })
  assert.equal(defaultRow.budget_turns, 12)
  assert.deepEqual(defaultRow.metadata, { priority: "medium" })

  const clampedRow = taskInsertRow({
    orgId: "org",
    roomId: "room",
    userId: "user",
    title: "Large budget",
    budgetTurns: 100,
  })
  assert.equal(clampedRow.budget_turns, 60)

  const invalidRow = taskInsertRow({
    orgId: "org",
    roomId: "room",
    userId: "user",
    title: "Invalid budget",
    budgetTurns: -5,
  })
  assert.equal(invalidRow.budget_turns, 12)
})

test("session mode reactive subscribe and setDemoMode", () => {
  setDemoMode(false)
  assert.equal(isDemoMode(), false)

  const events: boolean[] = []
  const unsubscribe = subscribeDemoMode((active) => {
    events.push(active)
  })

  setDemoMode(true)
  assert.equal(isDemoMode(), true)
  assert.deepEqual(events, [true])

  // Setting same state does not trigger listeners again
  setDemoMode(true)
  assert.deepEqual(events, [true])

  setDemoMode(false)
  assert.equal(isDemoMode(), false)
  assert.deepEqual(events, [true, false])

  unsubscribe()
  setDemoMode(true)
  assert.deepEqual(events, [true, false])

  // Reset to false for subsequent tests
  setDemoMode(false)
})

if (failures > 0) {
  console.error(failures + " failing")
  process.exit(1)
}
console.log("workspace draft: all passed")

test("task insert delegates to an agent only when one is chosen", () => {
  const delegated = taskInsertRow({ orgId: "o", roomId: "r", userId: "u", title: "Draft", assigneeAgentId: "agent-1" })
  assert.equal(delegated.assignee_agent_id, "agent-1")
  const open = taskInsertRow({ orgId: "o", roomId: "r", userId: "u", title: "Draft", assigneeAgentId: null })
  assert.equal("assignee_agent_id" in open, false)
})

test("delegation message mentions the agent once and carries the task", () => {
  const msg = delegationMessage("@@hermes", " Apply to Fermi ", " use the draft ")
  assert.ok(msg.startsWith("@hermes New task for you: Apply to Fermi\nuse the draft"))
  assert.equal((msg.match(/@hermes/g) ?? []).length, 1)
  assert.ok(!delegationMessage("hermes", "X").includes("undefined"))
})
