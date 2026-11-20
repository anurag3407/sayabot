import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

// Every admin query resolves to the next row queued for its table.
const rows: Record<string, unknown[]> = {}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ["select", "eq", "is", "order", "limit"]) q[m] = () => q
      q.maybeSingle = async () => ({ data: rows[table]?.shift() ?? null })
      return q
    },
  }),
}))
vi.mock("@/lib/env", () => ({ sayaAi: () => null, sayaAiPublic: () => null, getKek: () => "k" }))
vi.mock("@/lib/local-agents", () => ({
  localDetectionAllowed: () => false,
  detectLocalAgents: async () => [],
}))
vi.mock("@sayabot/llm/models", async (importOriginal) => {
  const real = await importOriginal<typeof import("@sayabot/llm/models")>()
  return {
    ...real,
    modelCatalog: () => ({ refresh: async () => {}, get: () => ({}) }),
    modelManifest: () => ({ refreshOnDemand: async () => {}, current: () => ({ engines: {} }) }),
    engineCatalogFromManifest: () => ({
      default: "gpt-6",
      options: [{ id: "gpt-6", label: "GPT-6" }],
      source: "manifest",
      checkedAt: 0,
      effortLevels: ["low", "high"],
    }),
  }
})

const { agentRunner, buildModelCatalog, macKeyId, parseMacKeyId } =
  await import("@/lib/model-catalog")
const { resolveModelChoice } = await import("@/lib/model-choice")

const HOST = "11111111-1111-1111-1111-111111111111"
const mac = {
  id: HOST,
  name: "Anurag's MacBook",
  runnerEnabled: true,
  localAgents: [
    {
      id: "claude-code",
      status: "ready",
      version: "2.1.325",
      account: "me@example.com · My Org",
      models: [
        {
          id: "claude-sonnet-5",
          label: "Claude Sonnet 5",
          isDefault: true,
          effort: ["low", "high"],
        },
        { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      ],
    },
    { id: "codex", status: "ready", version: "0.9.0" },
    { id: "gemini", status: "signed_out" },
    {
      id: "ollama",
      status: "ready",
      models: [{ id: "llama3.2:latest", label: "llama3.2:latest" }],
    },
  ],
}

describe("Mac apps in the model picker", () => {
  it("gives each signed-in app its own entry with account, version and models", async () => {
    const groups = await buildModelCatalog("org-1", [], [], [mac], [])
    const claude = groups.find((g) => g.keyId === macKeyId(HOST, "claude-code"))
    expect(claude).toMatchObject({
      section: "mac",
      label: "Claude",
      account: "me@example.com · My Org",
      version: "2.1.325",
      source: "live",
    })
    expect(claude?.models.map((m) => m.id)).toEqual([
      "default",
      "claude-sonnet-5",
      "claude-opus-5-5",
    ])
    expect(claude?.models[0]?.label).toBe("Claude default · Claude Sonnet 5")
    expect(claude?.models[1]?.effort).toEqual(["low", "high"])
  })

  it("falls back to Sayabot's list for an app that didn't list its models", async () => {
    const groups = await buildModelCatalog("org-1", [], [], [mac], [])
    const codex = groups.find((g) => g.keyId === macKeyId(HOST, "codex"))
    expect(codex?.source).toBe("manifest")
    expect(codex?.models.map((m) => m.id)).toEqual(["default", "gpt-6"])
  })

  it("leaves out apps that aren't signed in and lists local models under Local", async () => {
    const groups = await buildModelCatalog("org-1", [], [], [mac], [])
    expect(groups.some((g) => g.keyId === macKeyId(HOST, "gemini"))).toBe(false)
    const ollama = groups.find((g) => g.keyId === macKeyId(HOST, "ollama"))
    expect(ollama).toMatchObject({ section: "local", label: "Ollama" })
    expect(ollama?.models).toEqual([
      { id: "llama3.2:latest", label: "llama3.2:latest", free: true },
    ])
  })

  it("shows a Mac with nothing signed in as one computer entry", async () => {
    const groups = await buildModelCatalog("org-1", [], [], [{ ...mac, localAgents: [] }], [])
    expect(groups.map((g) => [g.keyId, g.section])).toEqual([[`host:${HOST}`, "computer"]])
  })

  it("maps a bot's runner to the picker key and back", () => {
    expect(
      agentRunner({ params: { runner: { hostId: HOST, app: "codex", model: "gpt-6" } } } as never),
    ).toEqual({
      keyId: macKeyId(HOST, "codex"),
      model: "gpt-6",
    })
    expect(
      agentRunner({ params: { runner: { hostId: HOST, app: "claude-code" } } } as never)?.model,
    ).toBe("default")
    expect(parseMacKeyId(`host:${HOST}:ollama`)).toEqual({ hostId: HOST, app: "ollama" })
    expect(parseMacKeyId(`host:${HOST}`)).toEqual({ hostId: HOST, app: null })
    expect(parseMacKeyId("host:nope")).toBeNull()
  })
})

describe("resolveModelChoice", () => {
  const base = { orgId: "org-1", userId: "u1", requestHost: "app.example.com" }
  beforeEach(() => {
    for (const key of Object.keys(rows)) delete rows[key]
  })

  it("runs on the person's own Mac with the model and effort picked", async () => {
    rows.desktop_hosts = [{ id: HOST, user_id: "u1", name: "MacBook", revoked_at: null }]
    const result = await resolveModelChoice({
      ...base,
      keyId: macKeyId(HOST, "claude-code"),
      model: "claude-opus-5-5",
      effort: "high",
    })
    expect(result).toEqual({
      ok: true,
      choice: {
        providerKeyId: null,
        agentModel: null,
        runner: { hostId: HOST, app: "claude-code", model: "claude-opus-5-5" },
        effort: "high",
        label: "claude-opus-5-5 on MacBook",
        macOwnerUserId: "u1",
      },
    })
  })

  it("keeps the app's default for the default row and accepts the older host key", async () => {
    rows.desktop_hosts = [{ id: HOST, user_id: "u1", name: "MacBook", revoked_at: null }]
    const result = await resolveModelChoice({ ...base, keyId: `host:${HOST}`, model: "codex" })
    expect(result.ok && result.choice.runner).toEqual({ hostId: HOST, app: "codex" })
  })

  it("refuses someone else's computer, an unsafe model, and a local model without one", async () => {
    rows.desktop_hosts = [{ id: HOST, user_id: "u2", name: "Theirs", revoked_at: null }]
    expect(
      (await resolveModelChoice({ ...base, keyId: macKeyId(HOST, "codex"), model: null })).ok,
    ).toBe(false)
    rows.desktop_hosts = [{ id: HOST, user_id: "u1", name: "Mine", revoked_at: null }]
    expect(
      await resolveModelChoice({ ...base, keyId: macKeyId(HOST, "codex"), model: "$(id)" }),
    ).toEqual({ ok: false, error: "That model id isn't valid" })
    rows.desktop_hosts = [{ id: HOST, user_id: "u1", name: "Mine", revoked_at: null }]
    expect(
      await resolveModelChoice({ ...base, keyId: macKeyId(HOST, "ollama"), model: "default" }),
    ).toEqual({ ok: false, error: "Pick a model in Ollama" })
  })

  it("drops effort for a local model", async () => {
    rows.desktop_hosts = [{ id: HOST, user_id: "u1", name: "Mine", revoked_at: null }]
    const result = await resolveModelChoice({
      ...base,
      keyId: macKeyId(HOST, "ollama"),
      model: "llama3.2:latest",
      effort: "high",
    })
    expect(result.ok && result.choice).toMatchObject({
      runner: { hostId: HOST, app: "ollama", model: "llama3.2:latest" },
      effort: null,
    })
  })

  it("uses a key only from this workspace", async () => {
    rows.provider_keys = [{ id: "key-1", org_id: "org-2" }]
    expect((await resolveModelChoice({ ...base, keyId: "key-1", model: "gpt-6" })).ok).toBe(false)
    rows.provider_keys = [{ id: "key-1", org_id: "org-1" }]
    const result = await resolveModelChoice({
      ...base,
      keyId: "key-1",
      model: "gpt-6",
      effort: "bogus",
    })
    expect(result.ok && result.choice).toMatchObject({
      providerKeyId: "key-1",
      agentModel: "gpt-6",
      runner: null,
      effort: null,
    })
  })

  it("refuses the server's own apps when Sayabot isn't on this computer", async () => {
    expect(
      (await resolveModelChoice({ ...base, keyId: "cli:claude-code", model: "default" })).ok,
    ).toBe(false)
  })
})
