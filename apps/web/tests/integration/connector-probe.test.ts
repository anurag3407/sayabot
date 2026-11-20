/**
 * "Check connection" per connector source, against a local stub vendor.
 *
 * `probeConnector` is exactly what `testWorkspaceConnector` runs after decrypting a saved token.
 * Pointing its origins at a stub server exercises the real probe code (URLs, auth headers,
 * response parsing, error messages) for every source the settings page offers — no `fetch`
 * mocking, so a wrong URL or header shows up here.
 */

import { createServer, type Server } from "node:http"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { probeConnector, type ConnectorProbeBases } from "@/lib/connectors/probe"

let server: Server
let origin = ""
let requests: { method: string; path: string; auth: string | undefined; apiKey?: string }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    requests.push({
      method: req.method ?? "GET",
      path: url.pathname,
      auth: req.headers.authorization,
      apiKey: req.headers["x-api-key"] as string | undefined,
    })

    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(value))
    }

    const path = url.pathname
    if (path === "/drive/v3/about") return json({ user: { emailAddress: "ops@acme.test" } })
    if (path === "/api/auth.test") return json({ ok: true, team: "Acme", user: "sayabot" })
    if (path === "/user") return json({ login: "octocat" })
    if (path === "/users/@me") return json({ username: "sayabot" })
    if (path.endsWith("/getMe")) return json({ ok: true, result: { username: "sayabot_bot" } })
    if (path === "/v21.0/106540352242922")
      return json({ display_phone_number: "+1 415 555 0123", verified_name: "Acme" })
    if (path === "/connect/v1/vaults") return json([{ id: "v1" }])
    if (path === "/bw/public/secrets") return json({ data: [] })
    if (path === "/supa/storage/v1/bucket") return json([{ id: "docs" }])
    if (path.startsWith("/s3/artifacts")) {
      if (req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": "application/xml" })
        return res.end()
      }
      res.writeHead(200, { "Content-Type": "application/xml" })
      return res.end(
        `<?xml version="1.0"?><ListBucketResult><Name>artifacts</Name><KeyCount>0</KeyCount></ListBucketResult>`,
      )
    }
    if (path === "/hf/api/whoami-v2") return json({ name: "acme" })
    if (path === "/composio/toolkits")
      return json({ items: [{ slug: "gmail", name: "Gmail" }], total_items: 1136 })
    // A vendor that rejects the token.
    if (path === "/reject/api/auth.test") return json({ ok: false, error: "invalid_auth" })
    return json({ error: "not_found", path }, 404)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
  const address = server.address()
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
})

afterAll(() => server.close())

function bases(): ConnectorProbeBases {
  return {
    google_drive: origin,
    slack: origin,
    github: origin,
    discord: origin,
    telegram: origin,
    whatsapp: `${origin}/v21.0`,
    bitwarden: `${origin}/bw`,
    huggingface: `${origin}/hf`,
    composio: `${origin}/composio`,
  }
}

describe("connector connection probe", () => {
  it("google_drive", async () => {
    await expect(
      probeConnector({ source: "google_drive", token: "g-token", config: {}, bases: bases() }),
    ).resolves.toBe("Connected as ops@acme.test")
  })

  it("slack", async () => {
    await expect(
      probeConnector({ source: "slack", token: "xoxb-1", config: {}, bases: bases() }),
    ).resolves.toContain("Acme")
    expect(requests.at(-1)?.auth).toBe("Bearer xoxb-1")
  })

  it("github", async () => {
    await expect(
      probeConnector({ source: "github", token: "ghp_1", config: {}, bases: bases() }),
    ).resolves.toContain("@octocat")
  })

  it("discord", async () => {
    await expect(
      probeConnector({ source: "discord", token: "bot-1", config: {}, bases: bases() }),
    ).resolves.toContain("sayabot")
    expect(requests.at(-1)?.auth).toBe("Bot bot-1")
  })

  it("telegram", async () => {
    await expect(
      probeConnector({
        source: "telegram",
        token: "111:AAAAAAAAAAAAAAAAAAAAAAAA",
        config: {},
        bases: bases(),
      }),
    ).resolves.toContain("@sayabot_bot")
  })

  it("whatsapp", async () => {
    await expect(
      probeConnector({
        source: "whatsapp",
        token: "wa-1",
        config: { phoneNumberId: "106540352242922" },
        bases: bases(),
      }),
    ).resolves.toContain("Acme")
    await expect(
      probeConnector({ source: "whatsapp", token: "wa-1", config: {}, bases: bases() }),
    ).rejects.toThrow(/phone number ID is missing/i)
  })

  it("onepassword (Connect)", async () => {
    await expect(
      probeConnector({
        source: "onepassword",
        token: "ops-1",
        config: { authMode: "api", connectUrl: `${origin}/connect` },
        bases: bases(),
      }),
    ).resolves.toBe("1Password Connect answered")
  })

  it("onepassword (signed-in app)", async () => {
    await expect(
      probeConnector({
        source: "onepassword",
        token: "desktop",
        config: { authMode: "computer" },
        bases: bases(),
      }),
    ).resolves.toMatch(/signed in on a computer/i)
  })

  it("bitwarden", async () => {
    await expect(
      probeConnector({
        source: "bitwarden",
        token: "bw-1",
        config: { authMode: "api" },
        bases: bases(),
      }),
    ).resolves.toContain("Bitwarden Secrets Manager")
  })

  it("protonpass", async () => {
    await expect(
      probeConnector({
        source: "protonpass",
        token: "desktop",
        config: { authMode: "computer" },
        bases: bases(),
      }),
    ).resolves.toMatch(/signed in on a computer/i)
  })

  it("supabase", async () => {
    await expect(
      probeConnector({
        source: "supabase",
        token: "service-role",
        config: { projectUrl: `${origin}/supa`, bucket: "docs" },
        bases: bases(),
      }),
    ).resolves.toContain('bucket "docs"')
    expect(requests.at(-1)?.auth).toBe("Bearer service-role")
  })

  it("cloudflare_r2", async () => {
    await expect(
      probeConnector({
        source: "cloudflare_r2",
        token: "secret",
        config: { endpoint: `${origin}/s3`, accessKeyId: "key", bucket: "artifacts" },
        bases: bases(),
      }),
    ).resolves.toContain('bucket "artifacts"')
  })

  it("backblaze_b2", async () => {
    await expect(
      probeConnector({
        source: "backblaze_b2",
        token: "secret",
        config: { endpoint: `${origin}/s3`, keyId: "key", bucket: "artifacts" },
        bases: bases(),
      }),
    ).resolves.toContain("Backblaze B2")
  })

  it("s3_storage", async () => {
    await expect(
      probeConnector({
        source: "s3_storage",
        token: "secret",
        config: {
          endpoint: `${origin}/s3`,
          accessKeyId: "key",
          bucket: "artifacts",
          region: "us-east-1",
        },
        bases: bases(),
      }),
    ).resolves.toContain("S3 Storage")
  })

  it("composio", async () => {
    await expect(
      probeConnector({ source: "composio", token: "comp-key", config: {}, bases: bases() }),
    ).resolves.toBe("Connected to Composio (1136+ apps available)")
    expect(requests.at(-1)?.apiKey).toBe("comp-key")
  })

  it("huggingface", async () => {
    await expect(
      probeConnector({
        source: "huggingface",
        token: "hf_1",
        config: { repoId: "acme/data" },
        bases: bases(),
      }),
    ).resolves.toBe("Connected to Hugging Face as @acme (acme/data)")
  })

  it("surfaces a vendor rejection instead of reporting success", async () => {
    await expect(
      probeConnector({
        source: "slack",
        token: "bad",
        config: {},
        bases: { slack: `${origin}/reject` },
      }),
    ).rejects.toThrow(/invalid_auth/)
  })
})
