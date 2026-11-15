import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { computersFromRecord, fetchWorkspaceSnapshot, importWorkspaceSnapshot, leaveCloudHome, snapshotHasRecords, syncCloudHandoff } from "./cloud-handoff"

let server: Server | null = null
afterEach(async () => {
  if (!server) return
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  server = null
})

const snapshot = {
  bots: [{ id: "11111111-1111-4111-8111-111111111111", handle: "ada", displayName: "Ada" }],
  chats: [{ id: "22222222-2222-4222-8222-222222222222", name: "Room" }],
  routines: [{ id: "33333333-3333-4333-8333-333333333333", prompt: "Check" }],
  keys: [{ id: "44444444-4444-4444-8444-444444444444", ciphertext: "sealed" }],
}

function listen(copied: boolean, planActive: boolean): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ cloudReady: true, planActive, copied }))
        return
      }
      if (req.method === "POST") {
        copied = true
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ snapshot }))
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

describe("syncCloudHandoff", () => {
  it("copies up once while the plan is active, then copies back when it ends", async () => {
    const url = await listen(false, true)
    const posts: string[] = []
    const realFetch = globalThis.fetch
    const tracking: typeof fetch = async (input, init) => {
      if (init?.method === "POST") posts.push(String(init.body))
      return realFetch(input, init)
    }
    const first = await syncCloudHandoff({
      serverUrl: url,
      hostId: "host",
      hostToken: "token",
      snapshot,
      writeSnapshot: () => {},
      fetch: tracking,
    })
    expect(first).toBe("copy_to_cloud")
    expect(posts).toHaveLength(1)
    const second = await syncCloudHandoff({
      serverUrl: url,
      hostId: "host",
      hostToken: "token",
      snapshot,
      writeSnapshot: () => {},
      fetch: tracking,
    })
    expect(second).toBe("none")
    expect(posts).toHaveLength(1)

    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = null
    const ended = await listen(true, false)
    let restored: unknown = null
    const back = await syncCloudHandoff({
      serverUrl: ended,
      hostId: "host",
      hostToken: "token",
      snapshot,
      writeSnapshot: (next) => {
        restored = next
      },
    })
    expect(back).toBe("copy_back")
    expect(restored).toEqual(snapshot)
  })

  it("reads the Mac snapshot from the signed-in server and refuses an empty copy", async () => {
    const url = await listen(false, true)
    const live = await fetchWorkspaceSnapshot(url, "host", "token", async (input) => {
      if (String(input).endsWith("/api/desktop/workspace-snapshot")) {
        return new Response(JSON.stringify({ snapshot }), { status: 200 })
      }
      return new Response("missing", { status: 404 })
    })
    expect(live?.bots[0]).toMatchObject({ handle: "ada" })
    await expect(
      syncCloudHandoff({
        serverUrl: url,
        hostId: "host",
        hostToken: "token",
        snapshot: { bots: [], chats: [], routines: [], keys: [] },
        writeSnapshot: () => {},
      }),
    ).rejects.toThrow(/Nothing on this Mac/)
    const computersOnly = {
      bots: [],
      chats: [],
      routines: [],
      keys: [],
      computers: { boatCiphertext: "sealed", boatIv: "iv", boatTag: "tag", boatLast4: "wxyz", vpsSshAlias: "lab.example" },
    }
    expect(snapshotHasRecords(computersOnly)).toBe(true)
    let posted = ""
    await syncCloudHandoff({
      serverUrl: url,
      hostId: "host",
      hostToken: "token",
      snapshot: computersOnly,
      writeSnapshot: () => {},
      fetch: async (input, init) => {
        if (init?.method === "POST") posted = String(init.body)
        return new Response(JSON.stringify({ cloudReady: true, planActive: true, copied: false, ok: true }), { status: 200 })
      },
    })
    expect(posted).toContain("sealed")
    expect(posted).toContain("\"boatIv\":\"iv\"")
    expect(posted).not.toContain("boat_")
    expect(
      computersFromRecord({
        boatCiphertext: "sealed",
        boatIv: "iv",
        boatTag: "tag",
        boatLast4: "wxyz",
        vpsSshAlias: "lab.example",
        vpsStartAutomatically: true,
      }),
    ).toEqual({
      boatCiphertext: "sealed",
      boatIv: "iv",
      boatTag: "tag",
      boatLast4: "wxyz",
      vpsSshAlias: "lab.example",
      vpsStartAutomatically: true,
    })
    expect(computersFromRecord({ boatCiphertext: "sealed", boatToken: "boat_secret_value" })).toBeNull()
    expect(computersFromRecord({ boatCiphertext: "sealed" })).toBeNull()
  })

  it("brings the copy back only after the plan ends", async () => {
    const active = await listen(true, true)
    let wrote = false
    const stayed = await leaveCloudHome({
      nextEdition: "self-hosted",
      serverUrl: active,
      hostId: "host",
      hostToken: "token",
      snapshot,
      writeSnapshot: () => {
        wrote = true
      },
    })
    expect(stayed).toBe(false)
    expect(wrote).toBe(false)

    await new Promise<void>((resolve) => server?.close(() => resolve()))
    server = null
    const ended = await listen(true, false)
    let restored: unknown = null
    const back = await leaveCloudHome({
      nextEdition: "self-hosted",
      serverUrl: ended,
      hostId: "host",
      hostToken: "token",
      snapshot,
      writeSnapshot: (next) => {
        restored = next
      },
    })
    expect(back).toBe(true)
    expect(restored).toEqual(snapshot)
    expect(await leaveCloudHome({ ...{ nextEdition: "cloud", serverUrl: ended, hostId: "host", hostToken: "token", snapshot, writeSnapshot: () => {} } })).toBe(false)
  })

  it("posts the returned copy to the server the Mac is using now", async () => {
    let url = ""
    let posted = ""
    const ok = await importWorkspaceSnapshot({
      serverUrl: "http://127.0.0.1",
      hostId: "host",
      hostToken: "token",
      snapshot,
      fetch: async (input, init) => {
        url = String(input)
        posted = String(init?.body)
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    })
    expect(ok).toBe(true)
    expect(url).toContain("/api/desktop/workspace-import")
    expect(posted).toContain("ada")
  })
})
