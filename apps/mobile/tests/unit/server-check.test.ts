import { strict as assert } from "node:assert"

let failures = 0
async function test(name, fn) {
  try {
    await fn()
    console.log("ok -", name)
  } catch (e) {
    failures++
    console.error("FAIL -", name, e)
  }
}

const { checkServer } = await import("../../src/core/server-url.ts")
const respond =
  (body, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

await test("a self-hosted server: its name and its own Supabase", async () => {
  let asked = ""
  globalThis.fetch = async (url) => {
    asked = String(url)
    return respond({
      sayabot: true,
      name: "Acme's Sayabot",
      supabase: { url: "https://sayabot.acme.com", anonKey: "anon" },
    })()
  }
  const result = await checkServer("sayabot.acme.com")
  assert.equal(asked, "https://sayabot.acme.com/api/instance")
  assert.deepEqual(result, {
    ok: true,
    server: {
      webApiUrl: "https://sayabot.acme.com",
      name: "Acme's Sayabot",
      supabaseUrl: "https://sayabot.acme.com",
      supabaseAnonKey: "anon",
    },
  })
})

await test("a website that isn't Sayabot is refused", async () => {
  globalThis.fetch = async () => new Response("<html>login</html>", { status: 200 })
  const result = await checkServer("example.com")
  assert.equal(result.ok, false)
  assert.match(result.error, /isn't running Sayabot/)
})

await test("an older server without phone support says so", async () => {
  globalThis.fetch = respond({ sayabot: true, name: "Old" })
  const result = await checkServer("old.example.com")
  assert.equal(result.ok, false)
  assert.match(result.error, /isn't set up for the phone app yet/)
})

await test("an unreachable server gets a plain-language error", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Network request failed")
  }
  const result = await checkServer("down.example.com")
  assert.equal(result.ok, false)
  assert.match(result.error, /Couldn't reach that server/)
})

await test("nonsense never hits the network", async () => {
  let called = false
  globalThis.fetch = async () => {
    called = true
    return new Response("{}")
  }
  const result = await checkServer("not a server")
  assert.equal(result.ok, false)
  assert.equal(called, false)
})

if (failures) process.exit(1)
