import { describe, expect, it, afterAll } from "vitest"
import { HostBackend } from "../src/backends/host"
import { join } from "node:path"
import os from "node:os"
import fs from "node:fs"

describe("HostBackend (Zero-Config Host Sandbox)", () => {
  const testAgentId = "test-agent-host-1"
  const host = new HostBackend()

  afterAll(async () => {
    await host.remove(testAgentId, true)
  })

  it("reports host backend kind and local isolation", () => {
    expect(host.kind).toBe("host")
    expect(host.ipIdentity).toBe(false)
    const desc = host.describe()
    expect(desc.backend).toBe("host")
    expect(desc.isolation).toBe("user_directory")
  })

  it("starts agent sandbox and binds agentd socket", async () => {
    const ready = await host.start(testAgentId, "org-test", "standard")
    expect(ready.id).toBe(`host-${testAgentId}`)
    expect(ready.ctlSocket).toBeDefined()
    expect(fs.existsSync(ready.ctlSocket!)).toBe(true)

    const status = await host.status(testAgentId)
    expect(status).toBe("running")
  })

  it("executes command via transport and returns output frame", async () => {
    const ready = await host.attach(testAgentId)
    const frames: any[] = []

    for await (const frame of host.transport(testAgentId, ready, {
      op: "exec",
      cmd: "echo 'zero-config-test'",
    })) {
      frames.push(frame)
    }

    expect(frames.length).toBeGreaterThan(0)
    const last = frames[frames.length - 1]
    expect(last.t).toBe("exit")
    expect(last.code).toBe(0)
    const stdout = frames.map((f) => f.d || f.stdout || "").join("")
    expect(stdout).toContain("zero-config-test")
  })

  it("stops and cleans up sandbox", async () => {
    await host.sleep(testAgentId)
    const status = await host.status(testAgentId)
    expect(status).toBe("stopped")

    await host.remove(testAgentId, true)
    const statusAfterRemove = await host.status(testAgentId)
    expect(statusAfterRemove).toBe("missing")
  })
})
