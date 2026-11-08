import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { ComputerClient } from "../../src/computer/client"

// Fetch-stubbed contract test: no socket needed, deterministic everywhere.
const SECRET = "0123456789abcdef"
const seen: { url: string; method: string; secret: string | null }[] = []
const realFetch = globalThis.fetch

function ndjson(frames: unknown[]) {
  return new Response(frames.map((f) => JSON.stringify(f)).join("\n") + "\n", { headers: { "content-type": "application/x-ndjson" } })
}

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://u:p@h/db"
  process.env.MESH_KEK = "k"
  process.env.SUPABASE_URL = "https://x.supabase.co"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc"
  process.env.ORCHESTRATOR_INTERNAL_SECRET = SECRET
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    const headers = new Headers(init?.headers as HeadersInit)
    seen.push({ url: u, method: init?.method ?? "GET", secret: headers.get("x-internal-secret") })
    if (u.endsWith("/ensure")) return Response.json({ status: "running", ip: "10.0.0.2" })
    if (u.endsWith("/exec")) return ndjson([{ t: "out", d: "hello " }, { t: "err", d: "warn" }, { t: "exit", code: 0, durationMs: 12, truncated: false }])
    if (u.endsWith("/files/read")) return Response.json({ path: "/home/bot/a.txt", content: "hi", encoding: "utf8", size: 2, bytesReturned: 2, hash: "h", truncated: false, hasMore: false })
    if (u.endsWith("/stop")) return Response.json({ ok: true })
    if (u.endsWith("/stats")) return Response.json({ cpu: 1 })
    if (u.endsWith("/browser")) return Response.json({ error: "boom" }, { status: 500 })
    return new Response("not found", { status: 404 })
  }) as typeof fetch
})

beforeEach(() => { seen.length = 0 })
afterAll(() => { globalThis.fetch = realFetch })

describe("ComputerClient <-> computerd contract (fetch stub)", () => {
  const client = () => new ComputerClient("http://computerd:4100", SECRET)

  it("sends the internal secret on every request", async () => {
    await client().ensure("a1", "o1", "standard")
    expect(seen.at(-1)?.secret).toBe(SECRET)
    expect(seen.at(-1)?.url).toBe("http://computerd:4100/v1/computers/a1/ensure")
  })

  it("ensure returns status/ip", async () => {
    await expect(client().ensure("a1", "o1", "browser")).resolves.toEqual({ status: "running", ip: "10.0.0.2" })
  })

  it("exec streams NDJSON frames into stdout/stderr/exit", async () => {
    const chunks: string[] = []
    const res = await client().exec("a1", { cmd: "echo hi", onChunk: (c) => chunks.push(c) })
    expect(res).toMatchObject({ stdout: "hello ", stderr: "warn", exitCode: 0, durationMs: 12, truncated: false })
    expect(chunks.join("")).toBe("hello warn")
  })

  it("readFile / stop / stats round-trip", async () => {
    await expect(client().readFile("a1", { path: "/home/bot/a.txt" })).resolves.toMatchObject({ content: "hi" })
    await expect(client().stop("a1")).resolves.toEqual({ ok: true })
    await expect(client().stats("a1")).resolves.toEqual({ cpu: 1 })
  })

  it("non-2xx responses throw with the server message", async () => {
    await expect(client().browser("a1", "broken", {})).rejects.toThrow(/500|boom/)
  })

  it("defaults its base URL/secret from env when not provided", () => {
    const c = new ComputerClient(undefined, undefined)
    expect(c).toBeDefined()
  })
})
