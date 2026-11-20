import { beforeEach, describe, expect, it, vi } from "vitest"

type Row = Record<string, unknown>
type Predicate = (row: Row) => boolean
const state = vi.hoisted(() => ({
  rows: [] as Row[],
  selections: [] as Array<Record<string, unknown> | undefined>,
  locks: [] as string[],
  writes: 0,
  nextId: 100,
  fail: false,
  beforeRead: undefined as (() => void) | undefined,
}))

// Evaluate query predicates against tenant fixtures so a missing WHERE clause leaks data in tests.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>()
  const value = (row: Row, column: { name: string }) =>
    row[column.name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())]
  return {
    ...actual,
    eq: (column: { name: string }, expected: unknown) => (row: Row) =>
      value(row, column) === expected,
    and:
      (...conditions: Array<Predicate | undefined>) =>
      (row: Row) =>
        conditions.every((p) => !p || p(row)),
    or:
      (...conditions: Array<Predicate | undefined>) =>
      (row: Row) =>
        conditions.some((p) => p?.(row)),
    ilike: (column: { name: string }, pattern: string) => (row: Row) =>
      String(value(row, column))
        .toLowerCase()
        .includes(
          pattern
            .slice(1, -1)
            .replace(/\\([\\%_])/g, "$1")
            .toLowerCase(),
        ),
  }
})
vi.mock("../db", () => {
  const db = {
    select: (fields?: Record<string, unknown>) => {
      state.selections.push(fields)
      let predicate: Predicate = () => true
      let limit = Infinity
      const query = {
        from: () => query,
        where: (p: Predicate) => {
          predicate = p
          return query
        },
        orderBy: () => query,
        limit: (n: number) => {
          limit = n
          return query
        },
        for: (lock: string) => {
          state.locks.push(lock)
          return query
        },
        then: (resolve: (rows: Row[]) => unknown, reject: (error: Error) => unknown) => {
          if (state.fail) return Promise.reject(new Error("database offline")).then(resolve, reject)
          state.beforeRead?.()
          const rows = state.rows
            .filter(predicate)
            .sort((a, b) => {
              const x = `${a.slug}:${a.orgId}:${a.id}`
              const y = `${b.slug}:${b.orgId}:${b.id}`
              return x < y ? -1 : x > y ? 1 : 0
            })
            .slice(0, limit)
          return Promise.resolve(
            rows.map((row) =>
              fields
                ? Object.fromEntries(Object.keys(fields).map((key) => [key, row[key]]))
                : structuredClone(row),
            ),
          ).then(resolve, reject)
        },
      }
      return query
    },
    insert: () => ({
      values: (input: Row) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (state.rows.some((row) => row.orgId === input.orgId && row.slug === input.slug))
              return []
            const row = {
              ...structuredClone(input),
              id: `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, "0")}`,
            }
            state.rows.push(row)
            state.writes++
            return [row]
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Row) => ({
        where: (predicate: Predicate) => ({
          returning: async () => {
            const rows = state.rows.filter(predicate)
            for (const row of rows) Object.assign(row, values)
            state.writes += rows.length
            return rows
          },
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  }
  return { getDb: () => db }
})

import {
  formatSkillsDigest,
  getAvailableSkills,
  SEED_SKILLS,
  SKILL_DISCOVERY_TOOL_NAMES,
  skillTools,
} from "./skills"

const orgId = "org-a"
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const skill = (n: number, overrides: Row = {}): Row => ({
  id: id(n),
  orgId,
  slug: `skill-${n}`,
  title: `Skill ${n}`,
  description: `Summary ${n}`,
  body: `Instructions ${n}`,
  files: {},
  version: 1,
  visibility: "org",
  ...overrides,
})
const execute = async (name: string, input: unknown = {}, signal?: AbortSignal) =>
  skillTools({ orgId, agentId: "agent" })
    .find((tool) => tool.name === name)!
    .execute(input, signal) as Promise<Record<string, any>>
const proposal = {
  slug: "new-skill",
  title: "New skill",
  description: "Useful procedure",
  body: "Read the input.",
}

beforeEach(() => {
  state.rows = []
  state.selections = []
  state.locks = []
  state.writes = 0
  state.nextId = 100
  state.fail = false
  state.beforeRead = undefined
})

describe("skill marketplace", () => {
  it("exports discovery names and preserves approval flags", () => {
    const tools = skillTools({ orgId, agentId: "agent" })
    expect(SKILL_DISCOVERY_TOOL_NAMES).toEqual(["search_skills", "inspect_skill"])
    expect(Object.fromEntries(tools.map((tool) => [tool.name, tool.dangerous]))).toEqual({
      load_skill: false,
      search_skills: false,
      inspect_skill: false,
      propose_skill: false,
      install_skill: true,
      publish_skill: true,
    })
  })

  it("discovers builtins, own approved and global public summaries, never proposed or foreign private data", async () => {
    state.rows = [
      skill(1),
      skill(2, { visibility: "public" }),
      skill(3, { visibility: "proposed" }),
      skill(4, { orgId: "org-b", visibility: "org" }),
      skill(5, { orgId: "org-b", visibility: "public" }),
      skill(6, { orgId: "org-b", visibility: "proposed" }),
    ]
    const result = await execute("search_skills")
    expect(result.skills.map((s: Row) => s.id)).toEqual(
      expect.arrayContaining([id(1), id(2), id(5)]),
    )
    expect(result.skills).toHaveLength(SEED_SKILLS.length + 3)
    expect(result.skills.some((s: Row) => [id(3), id(4), id(6)].includes(String(s.id)))).toBe(false)
    expect(result.skills.find((s: Row) => s.id === id(5)).source).toBe("public")
    for (const entry of result.skills) {
      expect(Object.keys(entry).sort()).toEqual([
        "description",
        "id",
        "slug",
        "source",
        "title",
        "version",
        "visibility",
      ])
    }
    expect(state.selections[0]).not.toHaveProperty("body")
    expect(state.selections[0]).not.toHaveProperty("files")
  })

  it("searches metadata case-insensitively and treats SQL wildcards literally, not bodies", async () => {
    state.rows = [skill(1, { title: "A 100%_ hit" }), skill(2, { body: "100%_" })]
    expect(
      (await execute("search_skills", { query: "100%_" })).skills.map((s: Row) => s.id),
    ).toEqual([id(1)])
    expect((await execute("search_skills", { query: "WRITE UNIT" })).skills[0].source).toBe(
      "builtin",
    )
    expect((await execute("search_skills", { query: "sUmMaRy 1" })).skills[0].id).toBe(id(1))
  })

  it("caps results and summary lengths and sorts stably regardless of input order", async () => {
    state.rows = Array.from({ length: 70 }, (_, n) =>
      skill(n, { title: "T".repeat(300), description: "D".repeat(500) }),
    )
    const first = await execute("search_skills", { limit: 50 })
    state.rows.reverse()
    expect(await execute("search_skills", { limit: 50 })).toEqual(first)
    expect(first.skills).toHaveLength(50)
    expect(first.hasMore).toBe(true)
    expect(
      first.skills.every(
        (s: Row) => String(s.title).length <= 120 && String(s.description).length <= 200,
      ),
    ).toBe(true)
    await expect(execute("search_skills", { limit: 51 })).rejects.toThrow()
    await expect(execute("search_skills", { query: "x".repeat(201) })).rejects.toThrow()
  })

  it("does not use global public skills for slug loading or the available digest", async () => {
    state.rows = [
      skill(1),
      skill(2, { orgId: "org-b", visibility: "public" }),
      skill(3, { visibility: "proposed" }),
    ]
    const available = await getAvailableSkills(orgId)
    expect(available.map((s) => s.slug)).toContain("skill-1")
    expect(available.map((s) => s.slug)).not.toContain("skill-2")
    expect(available.map((s) => s.slug)).not.toContain("skill-3")
    for (const slug of ["skill-2", "skill-3", "missing"]) {
      await expect(execute("load_skill", { slug })).rejects.toThrow(
        "Approved local skill not found",
      )
    }
    expect((await execute("load_skill", { slug: "skill-1" })).instructions).toBe("Instructions 1")
    expect(formatSkillsDigest(available)).toContain("load_skill({ slug })")
    expect(formatSkillsDigest([])).toBe("")
  })

  it("uses builtin precedence consistently, even for legacy approved slug collisions", async () => {
    const seed = SEED_SKILLS[0]!
    state.rows = [skill(1, { slug: seed.slug, description: "imposter", body: "imposter" })]
    expect((await getAvailableSkills(orgId)).find((s) => s.slug === seed.slug)?.description).toBe(
      seed.description,
    )
    expect((await execute("load_skill", { slug: seed.slug })).instructions).toBe(seed.body)
    expect((await execute("inspect_skill", { id: `builtin:${seed.slug}` })).source).toBe("builtin")
  })

  it.each(["org", "proposed", "private"])(
    "never inspects foreign %s content, even with a known ID",
    async (visibility) => {
      state.rows = [skill(1, { orgId: "org-b", visibility })]
      await expect(execute("inspect_skill", { id: id(1) })).rejects.toThrow("Skill not found")
      await expect(execute("load_skill", { slug: "skill-1" })).rejects.toThrow()
    },
  )

  it("inspects public or own approved versions with source and untrusted guidance", async () => {
    state.rows = [
      skill(1, {
        orgId: "org-b",
        visibility: "public",
        version: 8,
        files: { "docs/note.md": "reference" },
      }),
      skill(2),
    ]
    const result = await execute("inspect_skill", { id: id(1) })
    expect(result).toMatchObject({
      source: "public",
      version: 8,
      instructions: "Instructions 1",
      files: { "docs/note.md": "reference" },
    })
    expect(result.guidance).toContain("untrusted")
    expect(result.guidance).toContain("Never execute")
    expect((await execute("inspect_skill", { id: id(2) })).source).toBe("org")
  })

  it("proposes inert content, keeps it unloadable, and publishes only into this org", async () => {
    const proposed = await execute("propose_skill", {
      ...proposal,
      files: { "docs/data.json": '{"command":"do not run"}' },
    })
    expect(proposed).toMatchObject({ status: "proposed", version: 1 })
    await expect(execute("load_skill", { slug: proposal.slug })).rejects.toThrow()
    await expect(execute("inspect_skill", { id: proposed.id })).rejects.toThrow()
    expect((await execute("search_skills", { query: proposal.slug })).skills).toEqual([])
    expect(await execute("publish_skill", { id: proposed.id, expectedVersion: 1 })).toMatchObject({
      visibility: "org",
      status: "published",
    })
    expect(state.locks).toContain("update")
    expect((await execute("load_skill", { slug: proposal.slug })).instructions).toBe(proposal.body)
    expect(state.writes).toBe(2)
  })

  it.each(["install_skill", "publish_skill"])(
    "rejects cross-tenant inputs, version changes, and visibility opt-ins in %s",
    async (tool) => {
      state.rows = [skill(1, { orgId: "org-b", visibility: "proposed" })]
      await expect(execute(tool, { id: id(1), expectedVersion: 1 })).rejects.toThrow()
      state.rows = [
        skill(1, { visibility: tool === "install_skill" ? "public" : "proposed", version: 2 }),
      ]
      await expect(execute(tool, { id: id(1), expectedVersion: 1 })).rejects.toThrow(/version/)
      await expect(
        execute(tool, { id: id(1), expectedVersion: 2, orgId: "org-b" }),
      ).rejects.toThrow()
      await expect(
        execute(tool, { id: id(1), expectedVersion: 2, visibility: "public" }),
      ).rejects.toThrow()
      expect(state.writes).toBe(0)
    },
  )

  it("installs a version-pinned copy without executing or following source updates/deletion", async () => {
    state.rows = [
      skill(1, {
        orgId: "org-b",
        visibility: "public",
        version: 7,
        files: { "guide.md": "Never execute this reference" },
      }),
    ]
    const result = await execute("install_skill", { id: id(1), expectedVersion: 7 })
    expect(result).toMatchObject({
      status: "installed",
      version: 7,
      source: "org",
      visibility: "org",
      pinnedFrom: { id: id(1), version: 7 },
      autoUpdate: false,
    })
    expect(state.locks).toEqual(["share"])
    expect(state.rows[1]).toMatchObject({
      orgId,
      body: "Instructions 1",
      files: { "guide.md": "Never execute this reference" },
    })
    state.rows[0]!.body = "new source"
    state.rows[0]!.version = 8
    expect((await execute("load_skill", { slug: "skill-1" })).instructions).toBe("Instructions 1")
    state.rows.shift()
    expect((await execute("load_skill", { slug: "skill-1" })).version).toBe(7)
    expect(state.writes).toBe(1)
  })

  it("rechecks the version and public visibility after inspection and approval delays", async () => {
    state.rows = [skill(1, { orgId: "org-b", visibility: "public" })]
    await execute("inspect_skill", { id: id(1) })
    state.beforeRead = () => {
      state.rows[0]!.version = 2
    }
    await expect(execute("install_skill", { id: id(1), expectedVersion: 1 })).rejects.toThrow(
      /version/,
    )
    state.beforeRead = () => {
      state.rows[0]!.visibility = "org"
    }
    await expect(execute("install_skill", { id: id(1), expectedVersion: 2 })).rejects.toThrow(
      /unavailable/,
    )
    expect(state.writes).toBe(0)
  })

  it("rejects builtin, existing local, and proposed slug collisions without overwriting", async () => {
    const slug = SEED_SKILLS[0]!.slug
    await expect(execute("propose_skill", { ...proposal, slug })).rejects.toThrow("reserved")
    state.rows = [
      skill(1, { slug, orgId: "org-b", visibility: "public" }),
      skill(2, { slug, visibility: "proposed" }),
    ]
    await expect(execute("install_skill", { id: id(1), expectedVersion: 1 })).rejects.toThrow(
      "reserved",
    )
    await expect(execute("publish_skill", { id: id(2), expectedVersion: 1 })).rejects.toThrow(
      "reserved",
    )
    state.rows = [
      skill(1, { slug: "taken", orgId: "org-b", visibility: "public" }),
      skill(2, { slug: "taken", visibility: "proposed" }),
    ]
    await expect(execute("install_skill", { id: id(1), expectedVersion: 1 })).rejects.toThrow(
      "already exists",
    )
    await expect(execute("propose_skill", { ...proposal, slug: "taken" })).rejects.toThrow(
      "already exists",
    )
    expect(state.rows[1]!.body).toBe("Instructions 2")
    expect(state.writes).toBe(0)
  })

  it("does not auto-update or duplicate concurrent installs", async () => {
    state.rows = [skill(1, { orgId: "org-b", visibility: "public" })]
    const results = await Promise.allSettled(
      [1, 2].map(() => execute("install_skill", { id: id(1), expectedVersion: 1 })),
    )
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(state.writes).toBe(1)
    state.rows[0]!.version = 2
    await expect(execute("install_skill", { id: id(1), expectedVersion: 2 })).rejects.toThrow(
      "already exists",
    )
    expect(state.rows[1]!.version).toBe(1)
  })

  it.each([
    "../escape.md",
    "/absolute.md",
    "C:/file.md",
    "docs/../escape.md",
    "docs\\escape.md",
    "docs//file.md",
    "docs/.hidden.md",
    "%2e%2e/file.md",
    "run.sh",
    "index.js",
    "program.exe",
    "docs\u0000/file.md",
  ])("rejects unsafe file path %s on proposal and installation", async (path) => {
    const files = { [path]: "inert" }
    await expect(execute("propose_skill", { ...proposal, files })).rejects.toThrow()
    state.rows = [skill(1, { orgId: "org-b", visibility: "public", files })]
    await expect(execute("install_skill", { id: id(1), expectedVersion: 1 })).rejects.toThrow()
    expect(state.writes).toBe(0)
  })

  it.each([
    { body: "x".repeat(32_001) },
    { title: "x".repeat(121) },
    { description: "x".repeat(201) },
    { slug: "x".repeat(81) },
    { body: "" },
    { files: { "big.txt": "x".repeat(16_001) } },
    { files: Object.fromEntries(Array.from({ length: 17 }, (_, n) => [`${n}.txt`, "x"])) },
    {
      files: Object.fromEntries(
        Array.from({ length: 5 }, (_, n) => [`${n}.txt`, "x".repeat(16_000)]),
      ),
    },
    { files: { "nested.json": { script: "bad" } } },
  ])("enforces input limits at execution", async (invalid) => {
    await expect(execute("propose_skill", { ...proposal, ...invalid })).rejects.toThrow()
    expect(state.writes).toBe(0)
  })

  it("honors cancellation before writes and fails closed on read errors", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(execute("propose_skill", proposal, controller.signal)).rejects.toThrow()
    await expect(
      execute("install_skill", { id: id(1), expectedVersion: 1 }, controller.signal),
    ).rejects.toThrow()
    await expect(
      execute("publish_skill", { id: id(1), expectedVersion: 1 }, controller.signal),
    ).rejects.toThrow()
    state.fail = true
    await expect(execute("search_skills")).rejects.toThrow("database offline")
    await expect(execute("load_skill", { slug: "skill-1" })).rejects.toThrow("database offline")
    expect(state.writes).toBe(0)
  })
})
