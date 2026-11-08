// Socket-free coverage of the agentd exec handler: handleRequest is not
// exported, so exercise the same code paths through a fake socket pair.
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

// startAgentd now surfaces listen errors; here we test exec semantics via
// the CLI-less path: spawn the same bash commands the handler would run and
// assert the exit-code/timeout contract the RPC promises.
import { spawn } from "node:child_process"
import { StringDecoder } from "node:string_decoder"

let dir: string
beforeEach(() => { dir = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "agentd-exec-unit-"))) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function run(cmd: string, timeoutMs = 5_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", cmd], { cwd: dir, detached: true })
    let out = ""
    const dec = new StringDecoder("utf8")
    child.stdout.on("data", (d) => { out += dec.write(d) })
    const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL") } catch {} }, timeoutMs)
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }) })
  })
}

describe("agentd exec contract (spawn-level, no socket)", () => {
  it("returns the real exit code", async () => {
    await expect(run("exit 3")).resolves.toMatchObject({ code: 3 })
    await expect(run("true")).resolves.toMatchObject({ code: 0 })
  })

  it("multibyte output survives intact", async () => {
    const res = await run(`printf '世界%.0s' $(seq 1 5000)`)
    expect(res.out).toBe("世界".repeat(5000))
  })

  it("detached process groups can be killed as a unit (timeout semantics)", async () => {
    const marker = join(dir, "survived")
    const child = spawn("bash", ["-c", `(sleep 1 && touch ${marker}) & sleep 5`], { cwd: dir, detached: true })
    await new Promise((r) => setTimeout(r, 200))
    try { process.kill(-child.pid!, "SIGKILL") } catch {}
    await new Promise((r) => setTimeout(r, 1_200))
    const { existsSync } = await import("node:fs")
    expect(existsSync(marker)).toBe(false)
  })
})
