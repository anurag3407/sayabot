import { beforeEach, describe, expect, it, vi } from "vitest"
import { canvasCreateTool, canvasReadTool, canvasWriteTool } from "./tools"

const stored = new Map<string, { id: string; roomId: string; title: string; kind: string }>()

vi.mock("../db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (val: Record<string, unknown>) => {
        const row = {
          id: (val.id as string | undefined) ?? "generated-canvas",
          roomId: val.roomId as string,
          title: (val.title as string | undefined) ?? "Canvas",
          kind: (val.kind as string | undefined) ?? "markdown",
          snapshotText: (val.snapshotText as string | undefined) ?? "",
          language: null,
        }
        if (val.roomId) stored.set(row.id, row)
        const done = Promise.resolve()
        return Object.assign(done, {
          returning: async () => [row],
        })
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [...stored.values()],
        }),
      }),
    }),
  }),
}))

vi.mock("./server", () => ({
  loadCanvas: async (id: string) => stored.get(id) ?? null,
  persistCanvasState: vi.fn(async () => "stored"),
  getHocuspocus: () => ({
    openDirectConnection: async () => ({
      document: {},
      transact: async (fn: (doc: { getText: (name: string) => unknown }) => void) => {
        let value = ""
        fn({
          getText: () => ({
            get length() {
              return value.length
            },
            delete(from: number, count: number) {
              value = value.slice(0, from) + value.slice(from + count)
            },
            insert(at: number, text: string) {
              value = value.slice(0, at) + text + value.slice(at)
            },
            toString() {
              return value
            },
          }),
        })
      },
      disconnect: async () => {},
    }),
  }),
}))

const args = { roomId: "room-1", agentId: "agent-1" }

describe("canvas tools", () => {
  beforeEach(() => {
    stored.clear()
  })

  it("creates a canvas when canvas_write is given a new id", async () => {
    const tool = canvasWriteTool(args)
    const id = "90f680b6-b088-46d7-8064-429d03133753"
    const result = await tool.execute({ canvasId: id, content: "# probe" })
    expect(result).toMatchObject({ ok: true, created: true, canvasId: id, characters: 7 })
    expect(stored.get(id)?.roomId).toBe("room-1")
    expect(stored.get(id)?.title).toBe("probe")
  })

  it("refuses to adopt a canvas that belongs to another room", async () => {
    stored.set("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      roomId: "other-room",
      title: "Theirs",
      kind: "markdown",
    })
    const tool = canvasWriteTool(args)
    await expect(
      tool.execute({
        canvasId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        content: "nope",
      }),
    ).rejects.toThrow("Canvas not found in this room")
  })

  it("tells canvas_read how to create a canvas when the room has none", async () => {
    const tool = canvasReadTool(args)
    const result = await tool.execute({ canvasId: "90f680b6-b088-46d7-8064-429d03133753" })
    expect(result).toMatchObject({
      ok: false,
      error: "Canvas not found in this room",
      canvases: [],
    })
    expect(String((result as { hint?: string }).hint)).toContain("canvas_create")
  })

  it("creates a canvas from canvas_create", async () => {
    const tool = canvasCreateTool(args)
    const result = await tool.execute({
      title: "Landing",
      kind: "html",
      content: "<main>Hi</main>",
    })
    expect(result).toMatchObject({
      ok: true,
      created: true,
      canvasId: "generated-canvas",
      title: "Landing",
      kind: "html",
    })
  })
})
