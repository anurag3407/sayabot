import { afterEach, describe, expect, it, vi } from "vitest"

const generateMemoryMirror = vi.fn(async () => ({
  memoryMd: "# Agent Memory",
  openLoopsMd: "# Active Open Loops",
  topics: { deploy: "# Topic: deploy\n", "a/b": "# Topic: a/b\n" } as Record<string, string>,
}))

vi.mock("./service", () => ({ getMemoryService: () => ({ generateMemoryMirror }) }))

import { hashFiles, mirrorFiles, resetMirrorCache, syncMemoryMirror } from "./mirror"

afterEach(() => {
  resetMirrorCache()
  vi.clearAllMocks()
})

describe("memory mirror", () => {
  it("maps topics to safe file names", () => {
    const files = mirrorFiles({
      memoryMd: "m",
      openLoopsMd: "o",
      topics: { "a/b": "x", deploy: "y" },
    })
    expect(Object.keys(files).sort()).toEqual([
      "/home/bot/.saaya/memory/MEMORY.md",
      "/home/bot/.saaya/memory/OPEN_LOOPS.md",
      "/home/bot/.saaya/memory/topics/a_b.md",
      "/home/bot/.saaya/memory/topics/deploy.md",
    ])
  })

  it("hashes independently of key order", () => {
    expect(hashFiles({ a: "1", b: "2" })).toBe(hashFiles({ b: "2", a: "1" }))
    expect(hashFiles({ a: "1" })).not.toBe(hashFiles({ a: "2" }))
  })

  it("clears stale topics, writes once, then skips while unchanged", async () => {
    const client = { exec: vi.fn(async () => ({})), writeFile: vi.fn(async () => ({})) }
    const typed = client as unknown as Parameters<typeof syncMemoryMirror>[0]["client"]

    expect(await syncMemoryMirror({ orgId: "o", agentId: "a", client: typed })).toBe("written")
    expect(client.exec).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({
        cmd: expect.stringContaining("rm -rf /home/bot/.saaya/memory/topics"),
      }),
    )
    expect(client.writeFile).toHaveBeenCalledTimes(4)
    expect(generateMemoryMirror).toHaveBeenCalledWith({ orgId: "o", agentId: "a" })

    expect(await syncMemoryMirror({ orgId: "o", agentId: "a", client: typed })).toBe("unchanged")
    expect(client.writeFile).toHaveBeenCalledTimes(4)
  })
})
