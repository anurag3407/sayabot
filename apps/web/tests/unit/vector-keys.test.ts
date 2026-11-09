import { beforeEach, describe, expect, it, vi } from "vitest"

const mockAdmin = {
  from: vi.fn(),
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockAdmin,
}))

vi.mock("@/lib/env", () => ({
  getKek: () => Buffer.alloc(32, 1).toString("base64"),
}))

vi.mock("@/lib/actions/shared", () => ({
  adminOrgAccess: vi.fn(async (slug: string) => ({
    access: {
      org: { id: "org-1", slug },
      user: { id: "user-1" },
    },
  })),
  audit: vi.fn(async () => {}),
  revalidateOrg: vi.fn(),
  errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  fail: (error: string) => ({ ok: false, error }),
  ok: (message: string, data?: any) => ({ ok: true, message, ...data }),
  field: (form: FormData, name: string) => String(form.get(name) ?? "").trim(),
  optionalField: (form: FormData, name: string) => {
    const val = form.get(name)
    return val ? String(val).trim() : null
  },
}))

import {
  deleteVectorProvider,
  saveVectorProvider,
  setActiveVectorProvider,
  testVectorProvider,
} from "../../src/lib/actions/vector-keys"

describe("Vector & RAG Providers Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fails if required fields are missing", async () => {
    const formData = new FormData()
    formData.append("orgSlug", "test-org")
    formData.append("kind", "invalid_kind")

    const res = await saveVectorProvider(null, formData)
    expect(res.ok).toBe(false)
    expect(res.error).toContain("Select a valid kind")
  })

  it("saves a valid Pinecone serverless vector DB provider", async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "vector_providers") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ count: 0 }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({}),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "vec-123" },
                error: null,
              }),
            }),
          }),
        }
      }
      return {}
    })

    const formData = new FormData()
    formData.append("orgSlug", "test-org")
    formData.append("kind", "vector_db")
    formData.append("provider", "pinecone")
    formData.append("label", "Production Pinecone")
    formData.append("apiKey", "pcsk_test123456789")
    formData.append("endpointUrl", "https://index-xxx.svc.pinecone.io")
    formData.append("indexName", "saaya-index")
    formData.append("dimension", "1536")

    const res = await saveVectorProvider(null, formData)
    expect(res.ok).toBe(true)
    expect((res as any).providerId).toBe("vec-123")
  })

  it("activates a vector provider and deactivates others of the same kind", async () => {
    mockAdmin.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "vec-target", org_id: "org-1", kind: "vector_db", label: "Target DB" },
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    }))

    const res = await setActiveVectorProvider({
      orgSlug: "test-org",
      providerId: "vec-target",
    })

    expect(res.ok).toBe(true)
    expect(res.message).toContain("Target DB is now active")
  })

  it("deletes a vector provider with audit logging", async () => {
    mockAdmin.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "vec-to-del", org_id: "org-1", label: "Old DB", is_active: false, kind: "vector_db" },
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }))

    const res = await deleteVectorProvider({
      orgSlug: "test-org",
      providerId: "vec-to-del",
    })

    expect(res.ok).toBe(true)
    expect(res.message).toBe("Vector provider deleted")
  })

  it("instantaneously verifies local PGLite without remote network calls", async () => {
    mockAdmin.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: "vec-pglite", org_id: "org-1", provider: "pglite" },
          }),
        }),
      }),
    }))

    const res = await testVectorProvider("test-org", "vec-pglite")
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Connected to embedded pglite")
  })
})
