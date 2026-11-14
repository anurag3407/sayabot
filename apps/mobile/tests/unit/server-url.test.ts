import { strict as assert } from "node:assert"

let failures = 0
function test(name, fn) {
  try {
    fn()
    console.log("ok -", name)
  } catch (e) {
    failures++
    console.error("FAIL -", name, e)
  }
}

const { normalizeServerUrl } = await import("../../src/core/server-url.ts")

test("a bare domain gets https://", () => {
  assert.equal(normalizeServerUrl("sayabot.acme.com"), "https://sayabot.acme.com")
  assert.equal(normalizeServerUrl(" sayabot.acme.com/ "), "https://sayabot.acme.com")
})

test("local and private-network addresses get http://", () => {
  assert.equal(normalizeServerUrl("192.168.1.20:3000"), "http://192.168.1.20:3000")
  assert.equal(normalizeServerUrl("localhost:3000"), "http://localhost:3000")
})

test("non-web addresses and plain text are refused", () => {
  assert.equal(normalizeServerUrl("ftp://acme.com"), null)
  assert.equal(normalizeServerUrl("my server"), null)
  assert.equal(normalizeServerUrl(""), null)
})

if (failures) process.exit(1)
