import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

// ---- fake Supabase admin client: records calls, returns queued results per table ----
type Result = { data: unknown; error: { message: string } | null }
const queued = new Map<string, Result[]>()
const calls: { table: string; op: string; args: unknown[] }[] = []
const rpc = vi.fn()
const deleteUser = vi.fn()

function queue(table: string, ...results: Result[]) {
  queued.set(table, [...(queued.get(table) ?? []), ...results])
}

function builder(table: string) {
  const next = (): Result => queued.get(table)?.shift() ?? { data: null, error: null }
  const chain: Record<string, unknown> = {}
  for (const op of ["select", "insert", "update", "eq", "is", "gt"]) {
    chain[op] = (...args: unknown[]) => {
      calls.push({ table, op, args })
      return chain
    }
  }
  chain.maybeSingle = async () => next()
  // Awaiting the chain directly (insert / update without select).
  chain.then = (resolve: (r: Result) => unknown) => resolve(next())
  return chain
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => builder(table),
    rpc,
    auth: { admin: { deleteUser } },
  }),
}))

const userFromRequest = vi.fn()
vi.mock("@/lib/route-bearer", () => ({ userFromRequest: (r: Request) => userFromRequest(r) }))

const getUser = vi.fn()
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
}))

import { completeGuestMerge, hashTicket, MERGE_COOKIE } from "@/lib/guest-merge"
import { POST as startMerge } from "@/app/api/account/merge/route"
import { GET as mergeEntry } from "@/app/auth/merge/route"

const GUEST = "11111111-1111-1111-1111-111111111111"
const TARGET = "22222222-2222-2222-2222-222222222222"

beforeEach(() => {
  queued.clear()
  calls.length = 0
  vi.clearAllMocks()
  delete process.env.NEXT_PUBLIC_SITE_URL
})

function post(body: unknown) {
  return new Request("http://localhost:3000/api/account/merge", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer guest-token" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/account/merge", () => {
  it("rejects callers without a session", async () => {
    userFromRequest.mockResolvedValueOnce(null)
    expect((await startMerge(post({}))).status).toBe(401)
  })

  it("only lets guests start a merge", async () => {
    userFromRequest.mockResolvedValueOnce({ user: { id: TARGET, is_anonymous: false } })
    expect((await startMerge(post({}))).status).toBe(400)
  })

  it("stores only the ticket hash and returns the merge link", async () => {
    userFromRequest.mockResolvedValueOnce({ user: { id: GUEST, is_anonymous: true } })
    const res = await startMerge(post({ next: "/auth/desktop" }))
    expect(res.status).toBe(200)
    const { url } = (await res.json()) as { url: string }
    const link = new URL(url)
    expect(link.pathname).toBe("/auth/merge")
    expect(link.searchParams.get("next")).toBe("/auth/desktop")
    const ticket = link.searchParams.get("ticket") ?? ""
    expect(ticket.length).toBeGreaterThan(30)

    const insert = calls.find((c) => c.table === "account_merge_tickets" && c.op === "insert")
    const row = insert?.args[0] as { token_hash: string; guest_user_id: string }
    expect(row.guest_user_id).toBe(GUEST)
    expect(row.token_hash).toBe(hashTicket(ticket))
    expect(row.token_hash).not.toContain(ticket)
  })

  it("drops an unsafe next path", async () => {
    userFromRequest.mockResolvedValueOnce({ user: { id: GUEST, is_anonymous: true } })
    const { url } = (await (await startMerge(post({ next: "//evil.example" }))).json()) as {
      url: string
    }
    expect(new URL(url).searchParams.get("next")).toBeNull()
  })
})

describe("GET /auth/merge", () => {
  const entry = (ticket: string) =>
    mergeEntry(new Request(`http://localhost:3000/auth/merge?ticket=${ticket}&next=/auth/desktop`))

  it("sends expired or unknown tickets to login with an error", async () => {
    queue("account_merge_tickets", { data: null, error: null })
    const res = await entry("nope")
    expect(res.headers.get("location")).toContain("/login?error=")
    expect(res.headers.get("set-cookie")).toBeNull()
  })

  it("moves the ticket into an httpOnly cookie and asks a guest to sign in", async () => {
    queue("account_merge_tickets", { data: { id: "t1", guest_user_id: GUEST }, error: null })
    getUser.mockResolvedValueOnce({ data: { user: { id: GUEST, is_anonymous: true } } })
    const res = await entry("tok")
    const location = new URL(res.headers.get("location") ?? "")
    expect(location.pathname).toBe("/login")
    expect(location.searchParams.get("merge")).toBe("1")
    expect(location.searchParams.get("next")).toBe("/auth/merge/finish?next=%2Fauth%2Fdesktop")
    const cookie = res.headers.get("set-cookie") ?? ""
    expect(cookie).toContain(`${MERGE_COOKIE}=tok`)
    expect(cookie.toLowerCase()).toContain("httponly")
  })

  it("skips sign-in when the browser already has a real account", async () => {
    queue("account_merge_tickets", { data: { id: "t1", guest_user_id: GUEST }, error: null })
    getUser.mockResolvedValueOnce({ data: { user: { id: TARGET, is_anonymous: false } } })
    const res = await entry("tok")
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/auth/merge/finish")
  })
})

describe("completeGuestMerge", () => {
  it("refuses a ticket that is used or expired", async () => {
    queue("account_merge_tickets", { data: null, error: null })
    const out = await completeGuestMerge("tok", TARGET)
    expect(out.ok).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("moves the data, deletes the guest login and returns the moved workspace", async () => {
    queue("account_merge_tickets", { data: { id: "t1", guest_user_id: GUEST }, error: null })
    queue("org_members", { data: [{ orgs: { slug: "guest-ws", name: "Guest WS" } }], error: null })
    queue("desktop_hosts", { data: [{ name: "MacBook" }], error: null })
    rpc.mockResolvedValueOnce({ data: { moved: {} }, error: null })
    deleteUser.mockResolvedValueOnce({ error: null })

    const out = await completeGuestMerge("tok", TARGET)
    expect(out).toEqual({ ok: true, guestUserId: GUEST, firstWorkspaceSlug: "guest-ws" })
    expect(rpc).toHaveBeenCalledWith("merge_guest_into_user", { p_guest: GUEST, p_target: TARGET })
    expect(deleteUser).toHaveBeenCalledWith(GUEST)
  })

  it("releases the ticket and keeps the guest when the move fails", async () => {
    queue("account_merge_tickets", { data: { id: "t1", guest_user_id: GUEST }, error: null })
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } })

    const out = await completeGuestMerge("tok", TARGET)
    expect(out.ok).toBe(false)
    expect(deleteUser).not.toHaveBeenCalled()
    const release = calls.filter((c) => c.table === "account_merge_tickets" && c.op === "update")
    expect(release.at(-1)?.args[0]).toEqual({ used_at: null, target_user_id: null })
  })
})
