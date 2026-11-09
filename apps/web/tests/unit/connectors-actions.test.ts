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
  saveWorkspaceConnector,
  deleteWorkspaceConnector,
  testWorkspaceConnector,
  saveAgentConnectorGrant,
  deleteAgentConnectorGrant,
} from "../../src/lib/actions/connectors"

describe("Workspace Connectors Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fails if unsupported source is selected", async () => {
    const form = new FormData()
    form.append("orgSlug", "test-org")
    form.append("source", "unsupported_source")

    const res = await saveWorkspaceConnector(null, form)
    expect(res.ok).toBe(false)
    expect(res.error).toContain("Choose a supported connector source")
  })

  it("saves a valid Google Drive workspace connector", async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "workspace_connectors") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "conn-1" },
                error: null,
              }),
            }),
          }),
        }
      }
      return {}
    })

    const form = new FormData()
    form.append("orgSlug", "test-org")
    form.append("source", "google_drive")
    form.append("name", "Company Google Drive")
    form.append("token", "ya29.mock-oauth-token-12345")
    form.append("driveDomain", "sayalabs.in")

    const res = await saveWorkspaceConnector(null, form)
    expect(res.ok).toBe(true)
    expect(res.message).toContain("Company Google Drive connector connected successfully")
  })

  it("deletes a workspace connector", async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "workspace_connectors") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "conn-1", org_id: "org-1", name: "Slack", source: "slack" },
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      return {}
    })

    const res = await deleteWorkspaceConnector({
      orgSlug: "test-org",
      connectorId: "conn-1",
    })

    expect(res.ok).toBe(true)
    expect(res.message).toBe("Connector deleted")
  })

  it("saves an agent connector grant with scoped channels", async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "workspace_connectors") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "conn-1", name: "Slack", source: "slack" },
                }),
              }),
            }),
          }),
        }
      }
      if (table === "agent_connector_grants") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                }),
              }),
            }),
          }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      return {}
    })

    const form = new FormData()
    form.append("orgSlug", "test-org")
    form.append("agentId", "agent-cfo")
    form.append("connectorId", "conn-1")
    form.append("allowedChannels", "general, #finance, #invoices")

    const res = await saveAgentConnectorGrant(null, form)
    expect(res.ok).toBe(true)
    expect(res.message).toBe("Granted Slack access to agent")
  })

  it("revokes an agent connector grant", async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "agent_connector_grants") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "grant-1", agent_id: "agent-cfo", connector_id: "conn-1", org_id: "org-1" },
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      return {}
    })

    const res = await deleteAgentConnectorGrant({
      orgSlug: "test-org",
      grantId: "grant-1",
    })

    expect(res.ok).toBe(true)
    expect(res.message).toBe("Connector access revoked from agent")
  })
})
