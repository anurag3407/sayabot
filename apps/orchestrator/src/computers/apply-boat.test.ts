import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { applyBoatDecision } from "./apply-boat"
import { BoatClient } from "./boat"

let server: Server | null = null
afterEach(async () => {
  if (!server) return
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  server = null
})

function listen(): Promise<{ url: string; calls: string[] }> {
  const calls: string[] = []
  server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`)
    const created = req.method === "POST" && req.url === "/sandboxes"
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ id: created ? "box-new" : "box-1", name: "bot", state: "running" }))
  })
  return new Promise((resolve) => {
    server?.listen(0, "127.0.0.1", () => {
      const address = server?.address()
      if (!address || typeof address === "string") throw new Error("no port")
      resolve({ url: `http://127.0.0.1:${address.port}`, calls })
    })
  })
}

describe("applyBoatDecision", () => {
  it("resumes a sleeping Boat and creates one that does not exist yet", async () => {
    const { url, calls } = await listen()
    const client = new BoatClient({ token: "boat_test_token", api: url })
    const woke = await applyBoatDecision(
      client,
      { surface: "boat", action: "wake", reason: "" },
      "box-1",
      "bot",
    )
    expect(woke).toEqual({ ok: true, boatId: "box-1", state: "running" })
    const made = await applyBoatDecision(
      client,
      { surface: "boat", action: "provision", reason: "" },
      null,
      "bot",
    )
    expect(made).toEqual({ ok: true, boatId: "box-new", state: "running" })
    expect(calls).toEqual(["POST /sandboxes/box-1/resume", "POST /sandboxes"])
  })
})
