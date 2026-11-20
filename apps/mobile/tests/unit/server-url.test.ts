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

const { normalizeServerUrl, isPlaceholderSupabaseUrl } =
  await import("../../src/core/server-url.ts")

test("a bare domain gets https://", () => {
  assert.equal(normalizeServerUrl("sayabot.acme.com"), "https://sayabot.acme.com")
  assert.equal(normalizeServerUrl(" sayabot.acme.com/ "), "https://sayabot.acme.com")
})

test("local and private-network addresses get http://", () => {
  assert.equal(normalizeServerUrl("192.168.1.20:7431"), "http://192.168.1.20:7431")
  assert.equal(normalizeServerUrl("localhost:7431"), "http://localhost:7431")
})

test("non-web addresses and plain text are refused", () => {
  assert.equal(normalizeServerUrl("ftp://acme.com"), null)
  assert.equal(normalizeServerUrl("my server"), null)
  assert.equal(normalizeServerUrl(""), null)
})

test("an unconfigured build's Supabase URL counts as missing", () => {
  assert.equal(isPlaceholderSupabaseUrl("https://your-project.supabase.co"), true)
  assert.equal(isPlaceholderSupabaseUrl(""), true)
  assert.equal(isPlaceholderSupabaseUrl(undefined), true)
  assert.equal(isPlaceholderSupabaseUrl("https://my-real-project.supabase.co"), false)
})

if (failures) process.exit(1)
