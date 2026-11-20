import { createServer, type Server } from "node:http"
import { describe, expect, it, afterEach } from "vitest"
import { BoatClient } from "./boat"

let server: Server | null = null

afterEach(async () => {
  if (!server) return
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  server = null
})

function listen(
  handler: (
    body: string,
    url: string,
    method: string,
    auth: string,
  ) => { status: number; json: unknown },
): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      const result = handler(
        Buffer.concat(chunks).toString("utf8"),
        req.url ?? "",
        req.method ?? "GET",
        req.headers.authorization ?? "",
      )
      res.writeHead(result.status, { "content-type": "application/json" })
      res.end(JSON.stringify(result.json))
    })
  })
  return new Promise((resolve) => {
    server?.listen(0, "127.0.0.1", () => {
      const address = server?.address()
      if (!address || typeof address === "string") throw new Error("no port")
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

describe("BoatClient", () => {
  it("creates, wakes, and runs a command against a local Boat", async () => {
    const seen: string[] = []
    const api = await listen((body, url, method, auth) => {
      seen.push(`${method} ${url} ${auth} ${body}`)
      if (url === "/sandboxes" && method === "POST") {
        return { status: 202, json: { id: "bx_testbox1", name: "sayabot", state: "running" } }
      }
      if (url === "/sandboxes/bx_testbox1/resume") {
        return { status: 200, json: { id: "bx_testbox1", name: "sayabot", state: "running" } }
      }
      if (url === "/sandboxes/bx_testbox1/commands") {
        const parsed = JSON.parse(body) as { detached?: boolean }
        return {
          status: 200,
          json: parsed.detached ? { pid: "p1" } : { exitCode: 0, output: "ok" },
        }
      }
      return { status: 404, json: { error: "missing" } }
    })
    const boat = new BoatClient({ token: "boat_test", api })
    const created = await boat.create("sayabot")
    expect(created.id).toBe("bx_testbox1")
    const woke = await boat.resume(created.id)
    expect(woke.state).toBe("running")
    const background = await boat.command(created.id, "sleep 5", true)
    expect(background.pid).toBe("p1")
    expect(seen[0]).toContain("Bearer boat_test")
    expect(seen.some((line) => line.includes('"detached":true'))).toBe(true)
    expect(seen[0]).toContain('"noEnv":true')
  })

  it("reads the sandbox id when Boat nests it", async () => {
    const api = await listen((_body, url, method) => {
      if (url === "/sandboxes" && method === "POST") {
        return {
          status: 202,
          json: { sandbox: { id: "bx_nested", name: "sayabot", state: "ready" } },
        }
      }
      if (url === "/sandboxes/bx_nested/resume") {
        return { status: 200, json: { sandbox: { id: "bx_nested", state: "running" } } }
      }
      return { status: 404, json: {} }
    })
    const boat = new BoatClient({ token: "boat_test", api })
    expect((await boat.create("sayabot")).id).toBe("bx_nested")
    expect((await boat.resume("bx_nested")).state).toBe("running")
  })

  it("reads a desktop frame without putting the bytes in a shell command", async () => {
    const jpeg = Buffer.from("frame-bytes")
    const boat = new BoatClient({
      token: "boat_test",
      api: "http://boat.test/api/v1",
      fetch: async (url, init) => {
        expect(String(url)).toBe(
          "http://boat.test/api/v1/sandboxes/box-1/artifacts?path=%2Ftmp%2Fsayabot-screen.jpg",
        )
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer boat_test")
        return new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } })
      },
    })
    const frame = await boat.artifact("box-1", "/tmp/sayabot-screen.jpg")
    expect(frame).toEqual({ contentType: "image/jpeg", base64: jpeg.toString("base64") })
  })

  it("waits through provisioning and resumes an archived desktop", async () => {
    let polls = 0
    const boat = new BoatClient({
      token: "boat_test",
      api: "http://boat.test/api/v1",
      fetch: async (url, init) => {
        const path = String(url)
        if (path.endsWith("/resume")) {
          return Response.json({ sandbox: { id: "box-1", state: "running" } })
        }
        polls += 1
        const state = polls === 1 ? "provisioning" : polls === 2 ? "archived" : "running"
        expect(init?.method ?? "GET").toBe("GET")
        return Response.json({ sandbox: { id: "box-1", name: "sayabot", state } })
      },
    })
    const ready = await boat.waitUntilReady("box-1", { budgetMs: 5_000, pauseMs: 0 })
    expect(ready.state).toBe("running")
    expect(polls).toBe(3)
  })
})
