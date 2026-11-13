import { execFile } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import type { Server } from "node:net"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startAgentd } from "../../agentd/agentd"
import { argvChunks } from "../../src/backends/types"

const run = promisify(execFile)
const TSX = resolve(__dirname, "../../node_modules/.bin/tsx")
const CLI = resolve(__dirname, "../../agentd/agentd-cli.ts")

describe("agentd-cli request input", () => {
  let dir: string
  let sock: string
  let server: Server

  beforeAll(async () => {
    dir = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "cli-")))
    sock = join(dir, "a.sock")
    server = startAgentd(sock)
    await new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r())))
  })
  afterAll(() => {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it("joins a large request split across argv chunks (beyond the 128 KiB argv limit)", async () => {
    const target = join(dir, "big.txt")
    const content = "y".repeat(400_000)
    const { stdout } = await run(
      TSX,
      [CLI, ...argvChunks({ op: "write", path: target, content })],
      {
        env: { ...process.env, AGENTD_SOCK: sock },
        maxBuffer: 4 * 1024 * 1024,
      },
    )
    expect(JSON.parse(stdout.trim())).toMatchObject({ bytes: 400_000 })
    expect(readFileSync(target, "utf8")).toBe(content)
  }, 30_000)

  it("reads an @file request and deletes it afterwards", async () => {
    const req = join(dir, "req.json")
    writeFileSync(req, JSON.stringify({ op: "exec", cmd: "echo via-file", cwd: dir }))
    const { stdout } = await run(TSX, [CLI, `@${req}`], {
      env: { ...process.env, AGENTD_SOCK: sock },
    })
    expect(stdout).toContain("via-file")
    expect(existsSync(req)).toBe(false)
  }, 30_000)
})
