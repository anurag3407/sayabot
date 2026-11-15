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

const { isNewerVersion, parseSemver, resolveApkUrl, shouldQuietCheck, QUIET_CHECK_INTERVAL_MS } =
  await import("../../src/core/app-version.ts")

test("parseSemver tolerates a v prefix and missing parts", () => {
  assert.deepEqual(parseSemver("v1.2.3"), [1, 2, 3])
  assert.deepEqual(parseSemver("1.2"), [1, 2, 0])
  assert.deepEqual(parseSemver("garbage"), [0, 0, 0])
})

test("isNewerVersion compares numerically, not as strings", () => {
  assert.equal(isNewerVersion("1.2.0", "1.10.0"), true)
  assert.equal(isNewerVersion("1.10.0", "1.2.0"), false)
  assert.equal(isNewerVersion("1.2.0", "1.2.0"), false)
  assert.equal(isNewerVersion("1.2.0", "2.0.0"), true)
  assert.equal(isNewerVersion("2.0.0", "1.9.9"), false)
  assert.equal(isNewerVersion("1.2.0", "1.2.1"), true)
})

test("resolveApkUrl keeps absolute links and joins relative ones", () => {
  assert.equal(resolveApkUrl("https://a.com", "https://dl.com/x.apk"), "https://dl.com/x.apk")
  assert.equal(resolveApkUrl("https://a.com/", "/x.apk"), "https://a.com/x.apk")
  assert.equal(resolveApkUrl("https://a.com", "x.apk"), "https://a.com/x.apk")
})

test("shouldQuietCheck throttles foreground checks", () => {
  assert.equal(shouldQuietCheck(null, 1000), true)
  assert.equal(shouldQuietCheck(1000, 1000 + QUIET_CHECK_INTERVAL_MS - 1), false)
  assert.equal(shouldQuietCheck(1000, 1000 + QUIET_CHECK_INTERVAL_MS), true)
})

if (failures) process.exit(1)
