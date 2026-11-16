import { beforeEach, describe, expect, it, vi } from "vitest"

const updates: unknown[] = []
vi.mock("../db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: (value: unknown) => ({ where: async () => updates.push(value) }) }),
  }),
}))
vi.mock("../env", () => ({ getEnv: () => ({ MESH_KEK: "k".repeat(64) }) }))

import {
  openE2bSandbox,
  openSelectedE2b,
  runE2bShell,
  type E2BSandboxHandle,
  type E2BSdk,
} from "./e2b"

function stubSdk(existing: string | null) {
  const calls: string[] = []
  const handle = (id: string): E2BSandboxHandle => ({
    sandboxId: id,
    commands: {
      run: async (cmd: string, opts?: { background?: boolean }) => {
        calls.push(`run:${opts?.background ? "bg:" : ""}${cmd.slice(0, 20)}`)
        if (cmd.startsWith("false")) {
          throw Object.assign(new Error("exit 1"), { exitCode: 1, stdout: "", stderr: "nope" })
        }
        return opts?.background ? { pid: 42 } : { exitCode: 0, stdout: "hello\n", stderr: "" }
      },
    },
    files: { read: async () => new Uint8Array([1, 2, 3]) },
    setTimeout: async () => {},
  })
  const sdk: E2BSdk = {
    Sandbox: {
      list: () => ({
        nextItems: async () => (existing ? [{ sandboxId: existing, state: "paused" }] : []),
      }),
      connect: async (id) => {
        calls.push(`connect:${id}`)
        return handle(id)
      },
      create: async (template, opts) => {
        calls.push(`create:${template}:${JSON.stringify((opts as { metadata: unknown }).metadata)}`)
        return handle("sbx-new")
      },
    },
  }
  return { sdk, calls }
}

beforeEach(() => {
  updates.length = 0
  vi.stubEnv("E2B_API_KEY", "e2b_test_key")
})

describe("openE2bSandbox", () => {
  it("resumes this bot's paused sandbox instead of making another", async () => {
    const { sdk, calls } = stubSdk("sbx-old")
    const sbx = await openE2bSandbox({ apiKey: "k", agentId: "a1", orgId: "o1" }, sdk)
    expect(sbx.sandboxId).toBe("sbx-old")
    expect(calls).toEqual(["connect:sbx-old"])
  })

  it("creates one tagged with the bot when none exists", async () => {
    const { sdk, calls } = stubSdk(null)
    const sbx = await openE2bSandbox({ apiKey: "k", agentId: "a1", orgId: "o1" }, sdk)
    expect(sbx.sandboxId).toBe("sbx-new")
    expect(calls[0]).toContain('"sayabotAgent":"a1"')
  })
})

describe("openSelectedE2b", () => {
  it("remembers the sandbox id on the bot", async () => {
    const { sdk } = stubSdk(null)
    const result = await openSelectedE2b({
      orgId: "o1",
      agentId: "a1",
      params: { worksOn: "e2b" },
      sdk,
    })
    expect(result).toMatchObject({ ok: true, e2bId: "sbx-new", billedTo: "included" })
    expect(updates[0]).toMatchObject({
      params: { worksOn: "e2b", computer: { e2bId: "sbx-new", e2bReady: true } },
    })
  })

  it("says where to add a key when there is none", async () => {
    vi.stubEnv("E2B_API_KEY", "")
    const { sdk } = stubSdk(null)
    const result = await openSelectedE2b({ orgId: "o1", agentId: "a1", params: {}, sdk })
    expect(result).toEqual({ ok: false, error: "No E2B key is set in Settings → AI providers." })
  })
})

describe("runE2bShell", () => {
  const params = { computer: { e2bId: "sbx-old" } }

  it("returns stdout and the exit code", async () => {
    const { sdk } = stubSdk("sbx-old")
    const ran = await runE2bShell({
      orgId: "o1",
      agentId: "a1",
      params,
      command: "echo hello",
      sdk,
    })
    expect(ran).toMatchObject({ ok: true, stdout: "hello\n", exitCode: 0 })
  })

  it("turns a failing command into ok: false with its stderr", async () => {
    const { sdk } = stubSdk("sbx-old")
    const ran = await runE2bShell({ orgId: "o1", agentId: "a1", params, command: "false", sdk })
    expect(ran).toMatchObject({ ok: false, exitCode: 1, output: "nope" })
  })

  it("starts a background command and returns at once", async () => {
    const { sdk, calls } = stubSdk("sbx-old")
    const ran = await runE2bShell({
      orgId: "o1",
      agentId: "a1",
      params,
      command: "sleep 600",
      background: true,
      sdk,
    })
    expect(ran).toMatchObject({ ok: true, background: true })
    expect(calls.some((c) => c.startsWith("run:bg:"))).toBe(true)
  })

  it("asks for select_computer before the sandbox exists", async () => {
    const ran = await runE2bShell({ orgId: "o1", agentId: "a1", params: {}, command: "ls" })
    expect(ran.ok).toBe(false)
    expect(ran.output).toContain("select_computer")
  })
})
