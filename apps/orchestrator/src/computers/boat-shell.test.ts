import { createServer, type Server } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { BoatClient } from "./boat"
import { boatActivity, boatCatCommand, boatClickCommand, boatCommandOk, boatListCommand, boatReadCommand, boatWriteCommand, numberBoatLines, panelShotCommand, planBoatEdit, rememberBoatUse } from "./boat-shell"

let server: Server | null = null
afterEach(async () => {
  if (!server) return
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  server = null
})

describe("boat file read", () => {
  it("quotes the path and keeps the file's lines", () => {
    expect(boatReadCommand("/home/bot/it's.txt", 2, 4)).toBe("sed -n 2,4p '/home/bot/it'\\''s.txt'")
    expect(boatReadCommand("relative")).toBeNull()
    expect(numberBoatLines("a\nb\n", 2)).toBe("2 | a\n3 | b")
    const write = boatWriteCommand("/home/bot/note.txt", "it's a file")
    expect(write).toContain("base64 -d > '/home/bot/note.txt'")
    expect(write).not.toContain("it's")
    expect(boatWriteCommand("note.txt", "x")).toBeNull()
    expect(boatCatCommand("/home/bot/it' s.txt")).toBe("cat '/home/bot/it'\\'' s.txt'")
    const edited = planBoatEdit("/home/bot/note.txt", "alpha beta alpha", {
      oldString: "beta",
      newString: "gamma",
    })
    expect("command" in edited && edited.replacements).toBe(1)
    expect("command" in edited && edited.command.includes("beta")).toBe(false)
    expect(planBoatEdit("/home/bot/note.txt", "alpha alpha", { oldString: "alpha", newString: "b" })).toEqual({
      error: "That text appears more than once.",
    })
    const shot = panelShotCommand()
    expect(shot).toContain("x11grab -draw_mouse 1")
    expect(shot).toContain("/tmp/sayabot-screen.jpg")
    expect(boatClickCommand(12, 40)).toBe(
      "export DISPLAY=${DISPLAY:-:0}; xdotool mousemove --sync 12 40 click --repeat 1 --delay 100 1",
    )
    expect(boatClickCommand(1.5, 2)).toBeNull()
    expect(boatCommandOk({})).toBe(true)
    expect(boatCommandOk({ exitCode: 0 })).toBe(true)
    expect(boatCommandOk({ exitCode: 1 })).toBe(false)
    const params: Record<string, unknown> = { computer: { boatId: "box-1" } }
    rememberBoatUse(params, true, "t1")
    rememberBoatUse(params, false, "t2")
    expect(params.computer).toMatchObject({ boatId: "box-1", lastUsedAt: "t2", backgroundStartedAt: "t1" })
    expect(boatListCommand("/home/bot", 2)).toBe("find '/home/bot' -mindepth 1 -maxdepth 2")
    expect(boatListCommand("home")).toBeNull()
  })
})

describe("boat shell", () => {
  it("marks a background command and sends it detached", async () => {
    let body = ""
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on("data", (chunk) => chunks.push(chunk))
      req.on("end", () => {
        body = Buffer.concat(chunks).toString("utf8")
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ pid: "42" }))
      })
    })
    const url = await new Promise<string>((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address()
        if (!address || typeof address === "string") throw new Error("no port")
        resolve(`http://127.0.0.1:${address.port}`)
      })
    })
    const client = new BoatClient({ token: "boat_test_token", api: url })
    const result = await client.command("box-1", "sleep 30", true)
    expect(result).toEqual({ pid: "42" })
    expect(JSON.parse(body)).toEqual({ command: "sleep 30", detached: true })
    expect(boatActivity({ boatId: "box-1" }, { detached: true, now: "2026-11-15T00:00:00.000Z" })).toEqual({
      boatId: "box-1",
      lastUsedAt: "2026-11-15T00:00:00.000Z",
      backgroundStartedAt: "2026-11-15T00:00:00.000Z",
    })
  })
})