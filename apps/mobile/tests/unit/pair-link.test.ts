import { strict as assert } from "node:assert"

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

const { codeFromScan, parsePairLink } = await import("../../src/core/pair-link.ts")

test("a pair QR carries the code and the server", () => {
  const link = parsePairLink("sayabot://pair?code=ABCD2345&server=https%3A%2F%2Fsayabot.example")
  assert.deepEqual(link, { code: "ABCD2345", server: "https://sayabot.example" })
  assert.deepEqual(codeFromScan("sayabot://pair?code=ABCD2345&server=http://192.168.1.8:3000"), {
    code: "ABCD2345",
    server: "http://192.168.1.8:3000",
  })
})

test("a bare code still connects, and other QR contents are ignored", () => {
  assert.deepEqual(codeFromScan("ab-cd 2345"), { code: "ABCD2345", server: null })
  assert.equal(codeFromScan("https://example.com"), null)
  assert.equal(codeFromScan(""), null)
})

if (failures) process.exit(1)
