import { strict as assert } from "node:assert"
import { roomNameSlug, taskInsertRow, taskPriority } from "../../src/core/workspace-draft.ts"

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
  assert.equal(roomNameSlug("---"), "")
})

test("task priority is read from metadata", () => {
  assert.equal(taskPriority({ priority: "urgent" }), "urgent")
  assert.equal(taskPriority({}), "medium")
  assert.equal(taskPriority(null), "medium")
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

if (failures > 0) {
  console.error(failures + " failing")
  process.exit(1)
}
console.log("workspace draft: all passed")
