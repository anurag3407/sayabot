import { afterEach, describe, expect, it, vi } from "vitest"
import type { SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { memories, memoryLinks, openLoops, type Db } from "@sayabot/db"

vi.mock("./modules/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./modules/embeddings")>()),
  getOrgEmbedder: vi.fn(async () => null),
  hasPgvector: vi.fn(async () => false),
}))

import { drainBackground, runInBackground } from "./modules/background"
import { BeliefEngine } from "./modules/beliefs"
import { normalizeInsights, parseInsightJson } from "./modules/dream"
import { createEmbedder } from "./modules/embeddings"
import { extractWikilinks, MemoryGraphEngine, slugify } from "./modules/graph"
import { OpenLoopsManager } from "./modules/open-loops"
import {
  blendRelevance,
  buildOrTsQuery,
  citedMemoryIds,
  cosineSimilarity,
  isNearDuplicate,
  keywordRelevance,
  queryTerms,
  vectorRelevance,
} from "./modules/retrieval"
import { calculateRetention, compositeMemoryScore } from "./modules/salience"
import {
  buildScopeConditions,
  canReadMemory,
  canWriteMemory,
  formatSourceId,
  parseSourceId,
} from "./modules/sources"
import { MemoryService } from "./service"
import { memoryTools } from "./tools"

// ── Test harness ────────────────────────────────────────────────────────────

interface Step {
  method: string
  args: unknown[]
}
interface Call {
  op: string
  steps: Step[]
}

/**
 * Drizzle stand-in: every top-level call (select/insert/update/delete/...) starts a chain
 * that records each builder method, and resolves when awaited to `resolve(call)`. Tests
 * assert on what was queried instead of on hand-built mock chains.
 */
function mockDb(resolve: (call: Call) => unknown) {
  const calls: Call[] = []
  const start = (op: string, args: unknown[]) => {
    const call: Call = { op, steps: [{ method: op, args }] }
    calls.push(call)
    let settled: Promise<unknown> | null = null
    const chain: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            settled ??= Promise.resolve().then(() => resolve(call))
            return (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
              settled?.then(ok, fail)
          }
          return (...a: unknown[]) => {
            call.steps.push({ method: String(prop), args: a })
            return chain
          }
        },
      },
    )
    return chain
  }
  const db = new Proxy(
    {},
    {
      get:
        (_t, prop) =>
        (...args: unknown[]) =>
          start(String(prop), args),
    },
  )
  return { db: db as unknown as Db, calls }
}

const step = (call: Call, method: string) => call.steps.find((s) => s.method === method)
const tableOf = (call: Call) =>
  call.op === "select" ? step(call, "from")?.args[0] : call.steps[0]?.args[0]
const dialect = new PgDialect()
const render = (s: unknown) => dialect.sqlToQuery(s as SQL)
const whereOf = (call: Call) => render(step(call, "where")?.args[0])

function withDb(service: MemoryService, db: Db) {
  vi.spyOn(service as unknown as { getDb: () => Db }, "getDb").mockReturnValue(db)
  return service
}

const secret = ["sk-", "proj-", "abcdefghijklmnopqrstuvwxyz123456"].join("")
const ctx = { orgId: "org-1", agentId: "agent-1", roomId: "room-1" }

function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-1",
    orgId: "org-1",
    scope: "agent",
    agentId: "agent-1",
    roomId: null,
    kind: "fact",
    title: "Title",
    body: "Body",
    tags: [],
    source: "agent",
    confidence: 0.9,
    pinned: false,
    emotionalSalience: 0.5,
    epistemicStatus: "belief",
    perspective: "first_person",
    decayHalfLifeDays: 30,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    useCount: 0,
    createdByAgentId: "agent-1",
    embedding: null,
    ...overrides,
  }
}

afterEach(async () => {
  await drainBackground()
  vi.restoreAllMocks()
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe("retention & composite score", () => {
  const now = new Date("2026-05-01T00:00:00Z")
  const monthAgo = new Date("2026-04-01T00:00:00Z")

  it("decays by half per half-life and is reinforced by use", () => {
    expect(calculateRetention({ createdAt: now, decayHalfLifeDays: 30, now })).toBe(1.0)
    expect(calculateRetention({ createdAt: monthAgo, decayHalfLifeDays: 30, now })).toBeCloseTo(
      0.5,
      1,
    )
    expect(
      calculateRetention({ createdAt: monthAgo, useCount: 15, decayHalfLifeDays: 30, now }),
    ).toBeGreaterThan(
      calculateRetention({ createdAt: monthAgo, useCount: 0, decayHalfLifeDays: 30, now }),
    )
  })

  it("weights epistemic status and zeroes withdrawn", () => {
    const base = {
      relevance: 1,
      pinned: false,
      confidence: 1,
      emotionalSalience: 0.8,
      retention: 1,
    }
    const verified = compositeMemoryScore({ ...base, epistemicStatus: "verified" })
    const hypothesis = compositeMemoryScore({ ...base, epistemicStatus: "hypothesis" })
    expect(verified).toBeGreaterThan(hypothesis)
    expect(compositeMemoryScore({ ...base, pinned: true, epistemicStatus: "withdrawn" })).toBe(0)
  })

  it("lets relevance dominate an otherwise identical memory", () => {
    const base = {
      pinned: false,
      confidence: 0.9,
      emotionalSalience: 0.5,
      retention: 1,
      epistemicStatus: "belief" as const,
    }
    expect(compositeMemoryScore({ ...base, relevance: 0.9 })).toBeGreaterThan(
      compositeMemoryScore({ ...base, relevance: 0.1 }),
    )
  })
})

describe("access control", () => {
  it("formats and parses source ids", () => {
    expect(formatSourceId("agent", "agent-123")).toBe("agent:agent-123")
    expect(parseSourceId("agent:agent-123")).toEqual({ scope: "agent", id: "agent-123" })
    expect(parseSourceId("invalid")).toBeNull()
  })

  it("keeps agent memory private and room-bound agent memory inside its room", () => {
    const own = {
      memoryScope: "agent" as const,
      memoryAgentId: "agent-1",
      requestingAgentId: "agent-1",
    }
    expect(canReadMemory(own)).toBe(true)
    expect(canReadMemory({ ...own, requestingAgentId: "agent-2" })).toBe(false)
    // learned in room-1: visible there, not in room-2
    expect(canReadMemory({ ...own, memoryRoomId: "room-1", requestingRoomId: "room-1" })).toBe(true)
    expect(canReadMemory({ ...own, memoryRoomId: "room-1", requestingRoomId: "room-2" })).toBe(
      false,
    )
  })

  it("shares room memory only within the room and org memory everywhere", () => {
    expect(
      canReadMemory({ memoryScope: "room", memoryRoomId: "room-1", requestingRoomId: "room-1" }),
    ).toBe(true)
    expect(
      canReadMemory({ memoryScope: "room", memoryRoomId: "room-1", requestingRoomId: "room-2" }),
    ).toBe(false)
    expect(canReadMemory({ memoryScope: "org", requestingAgentId: "agent-99" })).toBe(true)
  })

  it("lets only the creating agent change an org memory", () => {
    const org = { memoryScope: "org" as const, memoryCreatedByAgentId: "agent-1" }
    expect(canWriteMemory({ ...org, requestingAgentId: "agent-1" })).toBe(true)
    expect(canWriteMemory({ ...org, requestingAgentId: "agent-2" })).toBe(false)
    expect(
      canWriteMemory({ ...org, memoryCreatedByAgentId: null, requestingAgentId: "agent-1" }),
    ).toBe(false)
  })

  it("builds broad recall SQL with room-bound private memories", () => {
    const q = render(buildScopeConditions({ orgId: "org-1", agentId: "agent-1", roomId: "room-1" }))
    expect(q.sql).toContain('"room_id" is null')
    expect(q.params).toEqual(expect.arrayContaining(["org-1", "agent-1", "room-1"]))
  })

  it("matches nothing for an explicit scope without its id", () => {
    expect(render(buildScopeConditions({ orgId: "org-1", scope: "room" })).sql).toBe("false")
    expect(render(buildScopeConditions({ orgId: "org-1", scope: "agent" })).sql).toBe("false")
  })

  it("limits agent-wide reads outside a room to room-less private memories", () => {
    const q = render(buildScopeConditions({ orgId: "org-1", scope: "agent", agentId: "agent-1" }))
    expect(q.sql).toContain('"room_id" is null')
    expect(q.sql).not.toContain('"room_id" = $')
  })
})

describe("retrieval helpers", () => {
  it("tokenizes into safe, de-duplicated content words", () => {
    expect(queryTerms("Can I write to the staging database? The STAGING db!")).toEqual([
      "write",
      "staging",
      "database",
      "db",
    ])
    expect(buildOrTsQuery(queryTerms("deploy & rollback | (prod):*"))).toBe(
      "deploy | rollback | prod",
    )
    expect(buildOrTsQuery([])).toBeNull()
  })

  it("scores a short title contained in a long request as relevant", () => {
    const terms = queryTerms(
      "hey, before you start: can you check whether the staging database allows writes from bots today",
    )
    const r = keywordRelevance({ title: "Staging database", body: "Read-only for bots.", terms })
    expect(r).toBeGreaterThanOrEqual(0.8)
    expect(keywordRelevance({ title: "Lunch", body: "Pizza on Fridays", terms })).toBe(0)
  })

  it("maps vector similarity above the model floor", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0)
    expect(vectorRelevance(0.2, 0.25)).toBe(0)
    expect(vectorRelevance(0.9, 0.25)).toBe(1)
  })

  it("blends signals with an agreement bonus", () => {
    expect(blendRelevance({ fts: 0.5 })).toBe(0.5)
    expect(blendRelevance({ fts: 0.5, vector: 0.6, keyword: 0.4 })).toBeCloseTo(0.8)
    expect(blendRelevance({})).toBe(0)
  })

  it("detects restatements as near duplicates", () => {
    const existing = {
      title: "Deploy target",
      body: "We deploy the API to Fly.io in the ams region.",
    }
    expect(isNearDuplicate({ title: "deploy  TARGET", body: "something else" }, existing)).toBe(
      true,
    )
    expect(
      isNearDuplicate(
        { title: "API deploy region", body: "The API is deployed to Fly.io in ams region." },
        existing,
      ),
    ).toBe(true)
    expect(
      isNearDuplicate({ title: "Lunch preference", body: "Team likes pizza." }, existing),
    ).toBe(false)
    expect(isNearDuplicate({ title: "x", body: "y" }, existing, 0.95)).toBe(true)
  })

  it("finds only allowed [#id] citations", () => {
    const a = "11111111-1111-4111-8111-111111111111"
    const b = "22222222-2222-4222-8222-222222222222"
    expect(citedMemoryIds(`per [#${a}] and [#${b}]`, [a])).toEqual([a])
  })
})

describe("extraction parsing", () => {
  it("parses fenced JSON and downgrades self-verified claims", () => {
    const raw = parseInsightJson(
      '```json\n{"beliefs":[{"title":"Deploy target","body":"Fly.io","epistemicStatus":"verified","shared":true}],"openLoops":[],"resolvedLoops":[]}\n```',
    )
    const out = normalizeInsights(raw, new Set())
    expect(out.beliefs).toHaveLength(1)
    expect(out.beliefs[0]).toMatchObject({ epistemicStatus: "belief", shared: true, kind: "fact" })
  })

  it("drops invalid items, caps counts and ignores unknown loop ids", () => {
    const out = normalizeInsights(
      {
        beliefs: [
          { title: "", body: "x" },
          ...Array.from({ length: 5 }, (_, i) => ({ title: `t${i}`, body: "b" })),
        ],
        openLoops: [{ description: "Send report", dueInHours: 24 }, { description: "" }],
        resolvedLoops: [{ id: "loop-1", resolution: "done" }, { id: "someone-elses-loop" }],
        episode: "Helped plan the launch.",
      },
      new Set(["loop-1"]),
    )
    expect(out.beliefs).toHaveLength(3)
    expect(out.openLoops).toEqual([{ description: "Send report", dueInHours: 24 }])
    expect(out.resolvedLoops).toEqual([{ id: "loop-1", resolution: "done" }])
    expect(out.episode).toBe("Helped plan the launch.")
  })

  it("returns nothing for non-JSON output", () => {
    expect(normalizeInsights(parseInsightJson("sorry, no"), new Set())).toEqual({
      beliefs: [],
      openLoops: [],
      resolvedLoops: [],
    })
  })
})

describe("belief engine", () => {
  it("redacts secrets and supersedes the prior belief with a link", async () => {
    const { db, calls } = mockDb((call) => {
      if (call.op === "insert" && tableOf(call) === memories) return [memoryRow({ id: "mem-new" })]
      if (call.op === "update") return [memoryRow({ id: "mem-old", epistemicStatus: "superseded" })]
      return []
    })
    const engine = new BeliefEngine(db)
    const inserted = await engine.assertBelief({
      orgId: "org-1",
      scope: "org",
      title: "Production DB",
      body: `Connect with ${secret}`,
      supersedesMemoryId: "mem-old",
    })
    expect(inserted.id).toBe("mem-new")
    const values = step(calls[0] as Call, "values")?.args[0] as { body: string }
    expect(values.body).not.toContain(secret)
    expect(calls.some((c) => c.op === "insert" && tableOf(c) === memoryLinks)).toBe(true)
  })

  it("only searches memories visible to the caller for contradictions", async () => {
    const { db, calls } = mockDb(() => [
      {
        id: "m1",
        title: "Deploy Target Kubernetes Cluster",
        body: "Deploy to EKS.",
        tags: [],
        epistemicStatus: "verified",
      },
    ])
    const found = await new BeliefEngine(db).detectContradictions({
      ...ctx,
      title: "Deploy Target Cloudflare",
    })
    expect(found[0]?.existingMemoryId).toBe("m1")
    const where = whereOf(calls[0] as Call)
    expect(where.params).toEqual(expect.arrayContaining(["agent-1", "room-1"]))
  })

  it("stops lineage at a memory the caller cannot read", async () => {
    const { db } = mockDb(() => [memoryRow({ agentId: "agent-2" })])
    expect(await new BeliefEngine(db).getBeliefLineage("mem-1", "org-1", ctx)).toEqual([])
  })
})

describe("open loops", () => {
  it("scopes updates to the owning agent and formats markdown", async () => {
    const { db, calls } = mockDb((call) => {
      if (call.op === "update") return [{ id: "loop-1", status: "resolved" }]
      return [
        {
          id: "loop-1",
          description: "Verify webhook secret",
          status: "open",
          dueAt: null,
          blockerReason: null,
        },
      ]
    })
    const manager = new OpenLoopsManager(db)
    expect((await manager.resolveOpenLoop("loop-1", "org-1", "agent-1", "done"))?.status).toBe(
      "resolved",
    )
    expect(whereOf(calls[0] as Call).params).toEqual(["loop-1", "org-1", "agent-1"])

    const md = manager.formatOpenLoopsMarkdown(
      await manager.getActiveLoops({ orgId: "org-1", agentId: "agent-1" }),
    )
    expect(md).toContain("Verify webhook secret")
  })

  it("can list only loops not tied to a room", async () => {
    const { db, calls } = mockDb(() => [])
    await new OpenLoopsManager(db).getActiveLoops({
      orgId: "org-1",
      agentId: "agent-1",
      roomless: true,
    })
    expect(whereOf(calls[0] as Call).sql).toContain('"room_id" is null')
  })
})

describe("knowledge graph", () => {
  it("extracts and slugifies wikilinks", () => {
    expect(
      extractWikilinks("Use [[Auth0-SSO]] with [[Session Management]]. See [[Auth0-SSO]]."),
    ).toEqual(["auth0-sso", "session-management"])
    expect(slugify("  Session Management! ")).toBe("session-management")
  })

  it("keeps supersedes history and clears old body links on rewrite", async () => {
    const { db, calls } = mockDb(() => [])
    await new MemoryGraphEngine(db).syncLinks({
      orgId: "org-1",
      sourceMemoryId: "m1",
      bodyText: "no links now",
    })
    const del = calls.find((c) => c.op === "delete")
    expect(del).toBeDefined()
    expect(whereOf(del as Call).params).toContain("supersedes")
    expect(calls.some((c) => c.op === "insert")).toBe(false)
  })

  it("returns nothing when the root memory is not visible", async () => {
    const { db, calls } = mockDb(() => [])
    const walk = await new MemoryGraphEngine(db).graphWalk({
      orgId: "org-1",
      startMemoryId: "root",
      access: ctx,
    })
    expect(walk.nodes).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it("follows edges from every node of a level, not just the first", async () => {
    const link = (source: string, target: string) => ({
      id: `${source}-${target}`,
      orgId: "org-1",
      sourceMemoryId: source,
      targetMemoryId: target,
      targetSlug: null,
      relationship: "depends_on",
      weight: 1,
    })
    const results: unknown[] = [
      [{ id: "R" }],
      [link("R", "A"), link("R", "C")],
      [memoryRow({ id: "A" }), memoryRow({ id: "C" })],
      [link("R", "A"), link("C", "E")],
      [memoryRow({ id: "E" })],
    ]
    const { db } = mockDb(() => results.shift())
    const walk = await new MemoryGraphEngine(db).graphWalk({
      orgId: "org-1",
      startMemoryId: "R",
      access: ctx,
      maxDepth: 2,
    })
    expect(walk.nodes.map((n) => [n.memory.id, n.depth])).toEqual([
      ["A", 1],
      ["C", 1],
      ["E", 2],
    ])
  })
})

describe("memory service", () => {
  it("refuses to forget another agent's private memory", async () => {
    const { db, calls } = mockDb(() => [memoryRow({ agentId: "agent-2" })])
    const service = withDb(new MemoryService(), db)
    expect(await service.forget("mem-1", ctx)).toBe(false)
    expect(calls.some((c) => c.op === "delete")).toBe(false)
  })

  it("refuses to withdraw an org memory another agent wrote", async () => {
    const { db, calls } = mockDb(() => [
      memoryRow({ scope: "org", agentId: null, createdByAgentId: "agent-2" }),
    ])
    const service = withDb(new MemoryService(), db)
    expect(await service.withdrawBelief("mem-1", ctx, "wrong")).toBeNull()
    expect(calls.some((c) => c.op === "update")).toBe(false)
  })

  it("forgets the agent's own memory", async () => {
    const { db, calls } = mockDb((call) =>
      call.op === "delete" ? [{ id: "mem-1" }] : [memoryRow()],
    )
    const service = withDb(new MemoryService(), db)
    expect(await service.forget("mem-1", ctx)).toBe(true)
    expect(calls.some((c) => c.op === "delete")).toBe(true)
  })

  it("updates a same-title memory without unpinning it, and redacts", async () => {
    const { db, calls } = mockDb((call) => {
      if (call.op === "select") return [{ ...memoryRow({ pinned: true }), body: "old" }]
      if (call.op === "update") return [memoryRow({ pinned: true })]
      return []
    })
    const service = withDb(new MemoryService(), db)
    await service.write({
      ...ctx,
      scope: "agent",
      roomId: null,
      kind: "fact",
      title: "Title",
      body: `key ${secret}`,
    })
    const set = step(calls.find((c) => c.op === "update") as Call, "set")?.args[0] as Record<
      string,
      unknown
    >
    expect(set).not.toHaveProperty("pinned")
    expect(set).not.toHaveProperty("tags")
    expect(set).not.toHaveProperty("epistemicStatus")
    expect(String(set.body)).not.toContain(secret)
    expect(set.embedding).toBeNull()
  })

  it("brings a withdrawn memory back when it is remembered again", async () => {
    const { db, calls } = mockDb((call) => {
      if (call.op === "select") return [memoryRow({ epistemicStatus: "withdrawn" })]
      if (call.op === "update") return [memoryRow()]
      return []
    })
    const service = withDb(new MemoryService(), db)
    await service.write({ ...ctx, scope: "agent", kind: "fact", title: "Title", body: "Body" })
    const set = step(calls.find((c) => c.op === "update") as Call, "set")?.args[0] as Record<
      string,
      unknown
    >
    expect(set).toMatchObject({ epistemicStatus: "belief", withdrawalReason: null })
  })

  it("never overwrites an org memory a person wrote", async () => {
    const { db, calls } = mockDb((call) => {
      if (call.op === "select")
        return [memoryRow({ scope: "org", agentId: null, source: "human", createdByAgentId: null })]
      if (call.op === "insert") return [memoryRow({ id: "mem-2", scope: "org" })]
      return []
    })
    const service = withDb(new MemoryService(), db)
    await service.write({
      ...ctx,
      scope: "org",
      kind: "fact",
      title: "Title",
      body: "Body",
      createdByAgentId: "agent-1",
    })
    expect(calls.some((c) => c.op === "update")).toBe(false)
    expect(calls.some((c) => c.op === "insert" && tableOf(c) === memories)).toBe(true)
  })

  describe("recall", () => {
    const staging = memoryRow({
      id: "m-staging",
      title: "Staging database policy",
      body: "Staging database is read-only for bots.",
    })
    const lunch = memoryRow({
      id: "m-lunch",
      title: "Lunch preference",
      body: "Team likes pizza on Fridays.",
      emotionalSalience: 1,
    })

    const recallDb = () =>
      mockDb((call) => {
        if (call.op !== "select") return []
        const columns = call.steps[0]?.args[0] as Record<string, unknown> | undefined
        if (columns && "rank" in columns) return [{ ...staging, rank: 0.3 }]
        return [staging, lunch]
      })

    it("ranks by relevance, drops unrelated memories and does not reinforce", async () => {
      const { db, calls } = recallDb()
      const service = withDb(new MemoryService(), db)
      const out = await service.recall({
        ...ctx,
        query: "can I write to the staging database?",
        minRelevance: 0.2,
      })
      expect(out.map((m) => m.id)).toEqual(["m-staging"])
      expect(calls.some((c) => c.op === "update")).toBe(false)

      const fts = calls.find((c) => "rank" in ((c.steps[0]?.args[0] as object) ?? {})) as Call
      expect(whereOf(fts).params).toContain("write | staging | database")
    })

    it("reinforces only on explicit recall", async () => {
      const { db, calls } = recallDb()
      const service = withDb(new MemoryService(), db)
      await service.recall({ ...ctx, query: "staging database", reinforce: true })
      expect(calls.some((c) => c.op === "update")).toBe(true)
    })

    it("excludes withdrawn and superseded memories by default", async () => {
      const { db, calls } = recallDb()
      const service = withDb(new MemoryService(), db)
      await service.recall({ ...ctx, query: "staging" })
      const params = whereOf(calls[0] as Call).params
      expect(params).toEqual(expect.arrayContaining(["verified", "belief", "hypothesis"]))
      expect(params).not.toContain("withdrawn")
      expect(params).not.toContain("superseded")
    })
  })

  describe("applyInsights", () => {
    const belief = (overrides: Record<string, unknown> = {}) => ({
      title: "Deploy target",
      body: "We deploy the API to Fly.io.",
      kind: "fact" as const,
      epistemicStatus: "belief" as const,
      confidence: 0.8,
      emotionalSalience: 0.5,
      perspective: "first_person" as const,
      tags: ["deploy"],
      shared: false,
      ...overrides,
    })

    it("stores private beliefs bound to the room, and shared ones in the room", async () => {
      const { db, calls } = mockDb((call) =>
        call.op === "insert" ? [memoryRow({ id: "new" })] : [],
      )
      const service = withDb(new MemoryService(), db)
      await service.applyInsights({
        ...ctx,
        insights: {
          beliefs: [belief(), belief({ title: "Release day", shared: true })],
          openLoops: [],
          resolvedLoops: [],
        },
        activeLoops: [],
      })
      const inserts = calls
        .filter((c) => c.op === "insert" && tableOf(c) === memories)
        .map((c) => step(c, "values")?.args[0] as Record<string, unknown>)
      expect(inserts[0]).toMatchObject({
        scope: "agent",
        agentId: "agent-1",
        roomId: "room-1",
        source: "consolidation",
      })
      expect(inserts[1]).toMatchObject({ scope: "room", agentId: null, roomId: "room-1" })
    })

    it("merges a restatement into the existing memory instead of inserting", async () => {
      const { db, calls } = mockDb((call) => {
        if (call.op === "select" && tableOf(call) === memories) {
          return [
            memoryRow({ id: "existing", title: "Deploy target", body: "Fly.io", tags: ["infra"] }),
          ]
        }
        return []
      })
      const service = withDb(new MemoryService(), db)
      const r = await service.applyInsights({
        ...ctx,
        insights: { beliefs: [belief()], openLoops: [], resolvedLoops: [] },
        activeLoops: [],
      })
      expect(r).toMatchObject({ beliefsSaved: 0, beliefsMerged: 1 })
      expect(calls.some((c) => c.op === "insert" && tableOf(c) === memories)).toBe(false)
      const set = step(calls.find((c) => c.op === "update") as Call, "set")?.args[0] as Record<
        string,
        unknown
      >
      expect(set.tags).toEqual(["infra", "deploy"])
    })

    it("skips duplicate loops and resolves completed ones", async () => {
      const active = {
        id: "loop-1",
        orgId: "org-1",
        agentId: "agent-1",
        roomId: "room-1",
        description: "Send the weekly report to Priya",
        status: "open",
        dueAt: null,
        blockerReason: null,
        resolution: null,
        sourceRef: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as const
      const { db, calls } = mockDb((call) => {
        if (call.op === "update" && tableOf(call) === openLoops)
          return [{ ...active, status: "resolved" }]
        if (call.op === "insert" && tableOf(call) === openLoops)
          return [{ ...active, id: "loop-2" }]
        return []
      })
      const service = withDb(new MemoryService(), db)
      const r = await service.applyInsights({
        ...ctx,
        insights: {
          beliefs: [],
          openLoops: [
            { description: "Send weekly report to Priya" },
            { description: "Book the venue" },
          ],
          resolvedLoops: [],
        },
        activeLoops: [active],
      })
      expect(r.loopsSaved).toBe(1)
      const inserted = calls.filter((c) => c.op === "insert" && tableOf(c) === openLoops)
      expect(
        (step(inserted[0] as Call, "values")?.args[0] as { description: string }).description,
      ).toBe("Book the venue")

      const r2 = await service.applyInsights({
        ...ctx,
        insights: {
          beliefs: [],
          openLoops: [],
          resolvedLoops: [{ id: "loop-1", resolution: "Sent" }],
        },
        activeLoops: [active],
      })
      expect(r2.loopsResolved).toBe(1)
    })
  })
})

describe("embedding providers", () => {
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

  it("orders OpenAI embeddings by index", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [
          { index: 1, embedding: [2] },
          { index: 0, embedding: [1] },
        ],
      }),
    )
    const embedder = createEmbedder({ provider: "openai", apiKey: "k" }, fetchImpl)
    expect(await embedder?.embed(["a", "b"], "document")).toEqual([[1], [2]])
    expect(embedder?.modelKey).toBe("openai:text-embedding-3-small")
  })

  it("sends the Gemini key as a header, never in the URL", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ embeddings: [{ values: [0.1, 0.2] }] }),
    )
    const embedder = createEmbedder({ provider: "google_gemini", apiKey: "gem-key" }, fetchImpl)
    await embedder?.embed(["q"], "query")
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain("gem-key")
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("gem-key")
    expect(String(init.body)).toContain("RETRIEVAL_QUERY")
  })

  it("passes Voyage input_type and rejects short responses", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ index: 0, embedding: [1] }] }))
    const embedder = createEmbedder({ provider: "voyage", apiKey: "k" }, fetchImpl)
    await expect(embedder?.embed(["a", "b"], "document")).rejects.toThrow(
      /returned 1 embeddings for 2/,
    )
  })

  it("reports HTTP errors without echoing secrets", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: `bad key ${secret}` }, 401))
    const embedder = createEmbedder({ provider: "openai", apiKey: "k" }, fetchImpl)
    await expect(embedder?.embed(["a"], "query")).rejects.toThrow(/401/)
    await expect(embedder?.embed(["a"], "query")).rejects.not.toThrow(secret)
  })

  it("returns null for providers it cannot call", () => {
    expect(createEmbedder({ provider: "fastembed_local", apiKey: "x" })).toBeNull()
  })
})

describe("background queue", () => {
  it("runs tasks and survives failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    let ran = 0
    runInBackground("ok", async () => {
      ran++
    })
    runInBackground("boom", async () => {
      throw new Error(`fail ${secret}`)
    })
    await drainBackground()
    expect(ran).toBe(1)
    expect(String(warn.mock.calls[0]?.[1])).not.toContain(secret)
  })
})

describe("memory tools", () => {
  it("exports the six cognitive tools", () => {
    expect(
      memoryTools({ orgId: "org-1", agentId: "agent-1", roomId: "room-1" }).map((t) => t.name),
    ).toEqual(["remember", "recall", "open_loop", "reflect", "graph_walk", "forget"])
  })
})
