import { strict as assert } from "node:assert"

let failures = 0
function test(name, fn) {
  try { fn(); console.log("ok -", name) } catch (e) { failures++; console.error("FAIL -", name, e) }
}

process.env.EXPO_PUBLIC_SUPABASE_URL = "https://proj.supabase.co"
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "anon-key"
process.env.EXPO_PUBLIC_WEB_API_URL = "https://api.example.com"
const { ENV } = await import("../../src/config/env.ts")

test("ENV picks up EXPO_PUBLIC_* overrides", () => {
  assert.equal(ENV.SUPABASE_URL, "https://proj.supabase.co")
  assert.equal(ENV.SUPABASE_ANON_KEY, "anon-key")
  assert.equal(ENV.WEB_API_URL, "https://api.example.com")
})

test("ENV metadata is stable", () => {
  assert.equal(ENV.APP_NAME, "Sayabot")
  assert.equal(ENV.DEFAULT_ORG_SLUG, "default")
})

if (failures > 0) { console.error(failures + " failing"); process.exit(1) }
console.log("mobile unit: all passed")
