import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
import { insertHumanMessage } from "../../src/lib/message-send"

const ROOM = "11111111-1111-4111-8111-111111111111"
const USER = "22222222-2222-4222-8222-222222222222"

function fakeSupabase(opts: { existing?: unknown; insertError?: string; root?: unknown } = {}) {
  const inserted: unknown[] = []
  const chain: any = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return undefined
      return (..._a: unknown[]) => chain
    },
    apply() { return chain },
  })
  const client: any = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ filter: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }) }), maybeSingle: async () => ({ data: opts.root ?? null }) }) }),
      insert: (row: unknown) => { inserted.push(row); return { select: () => ({ single: async () => opts.insertError ? { data: null, error: { message: opts.insertError } } : { data: { id: "msg-1" }, error: null } }) } },
    }),
    inserted,
  }
  return client
}

describe("insertHumanMessage validation (no DB needed for these paths)", () => {
  it("rejects empty/oversized content", async () => {
    await expect(insertHumanMessage({ supabase: fakeSupabase(), userId: USER, roomId: ROOM, content: "   " })).resolves.toMatchObject({ ok: false })
    await expect(insertHumanMessage({ supabase: fakeSupabase(), userId: USER, roomId: ROOM, content: "x".repeat(100_001) })).resolves.toMatchObject({ ok: false })
  })

  it("rejects non-uuid room/thread ids", async () => {
    await expect(insertHumanMessage({ supabase: fakeSupabase(), userId: USER, roomId: "nope", content: "hi" })).resolves.toEqual({ ok: false, error: "Invalid room" })
    await expect(insertHumanMessage({ supabase: fakeSupabase(), userId: USER, roomId: ROOM, content: "hi", threadRootId: "nope" })).resolves.toEqual({ ok: false, error: "Invalid thread" })
  })

  it("rejects a thread that lives in another room", async () => {
    const sb = fakeSupabase({ root: { id: "t", room_id: "99999999-9999-4999-8999-999999999999", thread_root_id: null } })
    await expect(insertHumanMessage({ supabase: sb, userId: USER, roomId: ROOM, content: "hi", threadRootId: "33333333-3333-4333-8333-333333333333" })).resolves.toMatchObject({ ok: false, error: /Thread not found/ })
  })

  it("is idempotent on clientId: returns the existing message without inserting", async () => {
    const sb = fakeSupabase({ existing: { id: "existing-1" } })
    await expect(insertHumanMessage({ supabase: sb, userId: USER, roomId: ROOM, content: "hi", clientId: "c-1" })).resolves.toEqual({ ok: true, id: "existing-1" })
    expect(sb.inserted).toHaveLength(0)
  })

  it("inserts a trimmed human message with extracted mentions", async () => {
    const sb = fakeSupabase()
    const out = await insertHumanMessage({ supabase: sb, userId: USER, roomId: ROOM, content: "  hello @ada  ", clientId: "c-9" })
    expect(out).toEqual({ ok: true, id: "msg-1" })
    expect(sb.inserted).toHaveLength(1)
    const row = sb.inserted[0] as any
    expect(row.content).toBe("hello @ada")
    expect(row.mentions).toContain("ada")
    expect(row.sender_type).toBe("human")
    expect(row.metadata.clientId).toBe("c-9")
  })

  it("surfaces insert errors", async () => {
    await expect(insertHumanMessage({ supabase: fakeSupabase({ insertError: "db down" }), userId: USER, roomId: ROOM, content: "hi" })).resolves.toEqual({ ok: false, error: "db down" })
  })
})
