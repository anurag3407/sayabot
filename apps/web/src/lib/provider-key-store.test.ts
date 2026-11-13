import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/env", () => ({ getKek: () => Buffer.alloc(32, 7).toString("base64") }))
vi.mock("@/lib/actions/shared", () => ({
  audit: vi.fn(async () => undefined),
  revalidateOrg: vi.fn(),
}))

const rows: Array<Record<string, unknown>> = []
const deleted: string[] = []
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            rows.push(row)
            return { data: { id: `key-${rows.length}` }, error: null }
          },
        }),
      }),
      delete: () => ({
        eq: async (_col: string, id: string) => {
          deleted.push(id)
          return { error: null }
        },
      }),
    }),
  }),
}))

const listProviderModels = vi.fn()
vi.mock("@sayabot/llm/models", () => ({
  listProviderModels: (...args: unknown[]) => listProviderModels(...args),
}))

const { storeProviderKey } = await import("./provider-key-store")

const access = {
  org: { id: "org-1", slug: "acme", name: "Acme", ssoEnabled: false },
  role: "owner" as const,
  user: { id: "user-1" },
} as unknown as Parameters<typeof storeProviderKey>[0]["access"]

beforeEach(() => {
  rows.length = 0
  deleted.length = 0
  listProviderModels.mockReset()
})

describe("storeProviderKey", () => {
  it("saves an encrypted key, checks it live and returns only its last four characters", async () => {
    listProviderModels.mockResolvedValue({ models: [{ id: "a" }, { id: "b" }], source: "live" })
    const result = await storeProviderKey({
      access,
      provider: "deepseek",
      secret: "sk-deepseek-123456",
      verify: true,
    })
    expect(result).toEqual({
      ok: true,
      keyId: "key-1",
      label: "DeepSeek",
      last4: "3456",
      models: 2,
    })
    expect(rows[0]).toMatchObject({
      provider: "openai-compatible",
      base_url: "https://api.deepseek.com/v1",
    })
    expect(JSON.stringify(rows[0])).not.toContain("sk-deepseek-123456")
    expect(listProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "deepseek", cacheKey: "key-1", force: true }),
    )
  })

  it("removes a key the provider refuses and says why", async () => {
    listProviderModels.mockResolvedValue({
      models: [],
      source: "catalog",
      error: "The provider refused this key",
    })
    const result = await storeProviderKey({
      access,
      provider: "openai",
      secret: "sk-wrong-000000",
      verify: true,
    })
    expect(result).toEqual({ ok: false, error: "The provider refused this key" })
    expect(deleted).toEqual(["key-1"])
  })

  it("keeps a key whose list could not be read for another reason, with a note", async () => {
    listProviderModels.mockResolvedValue({
      models: [],
      source: "catalog",
      error: "The provider answered HTTP 503",
    })
    const result = await storeProviderKey({
      access,
      provider: "grok",
      secret: "xai-abcdefgh",
      verify: true,
    })
    expect(result).toMatchObject({ ok: true, models: null })
    expect(result.ok && result.note).toContain("HTTP 503")
    expect(deleted).toEqual([])
  })

  it("lets a local server go without a key but not a hosted provider", async () => {
    const local = await storeProviderKey({
      access,
      provider: "openai-compatible",
      secret: "",
      baseUrl: "http://localhost:11434/v1",
    })
    expect(local.ok).toBe(true)
    expect(await storeProviderKey({ access, provider: "anthropic", secret: "" })).toEqual({
      ok: false,
      error: "Paste the API key",
    })
    expect(await storeProviderKey({ access, provider: "codex", secret: "whatever-123" })).toEqual({
      ok: false,
      error: "Choose a provider",
    })
  })
})
