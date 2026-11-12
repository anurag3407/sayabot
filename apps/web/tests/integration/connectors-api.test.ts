import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

const TEST_KEK = Buffer.alloc(32, 5).toString("base64")

vi.mock("@/lib/env", () => ({
  getKek: () => TEST_KEK,
  getSupabaseUrl: () => "http://localhost:54321",
  getServiceRoleKey: () => "mock-service-role-key",
  getOrchestratorUrl: () => "http://localhost:4000",
}))

// Auth state simulation
let mockCurrentUser: { id: string; email: string; displayName?: string } | null = {
  id: "user-admin-1",
  email: "admin@sayalabs.in",
  displayName: "Admin Tester",
}
let mockUserRole: "owner" | "admin" | "member" = "admin"

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>()
  return {
    ...actual,
    getCurrentUser: vi.fn(async () => mockCurrentUser),
    getOrgAccess: vi.fn(async (slug: string) => {
      if (!mockCurrentUser) return null
      if (slug === "unauthorized-org" || slug === "other-org") return null
      return {
        org: { id: "org-1", slug, name: "Sayalabs Test Org", ssoEnabled: false },
        role: mockUserRole,
        user: mockCurrentUser,
      }
    }),
    isOrgAdmin: (role: string) => role === "owner" || role === "admin",
  }
})

// In-Memory Database Store for Supabase Admin Client
interface DBRecord {
  id: string
  [key: string]: any
}

let dbConnectors: DBRecord[] = []
let dbGrants: DBRecord[] = []
let dbAuditLogs: DBRecord[] = []
let idCounter = 1

function createMockAdmin() {
  return {
    from: (table: string) => {
      if (table === "workspace_connectors") {
        return {
          select: (_cols?: string) => {
            const filters: Record<string, any> = {}
            const builder = {
              eq: (col: string, val: any) => {
                filters[col] = val
                return builder
              },
              maybeSingle: async () => {
                const match = dbConnectors.find((row) =>
                  Object.entries(filters).every(([k, v]) => row[k] === v),
                )
                return { data: match ? { ...match } : null, error: null }
              },
              single: async () => {
                const match = dbConnectors.find((row) =>
                  Object.entries(filters).every(([k, v]) => row[k] === v),
                )
                return {
                  data: match ? { ...match } : null,
                  error: match ? null : new Error("Connector not found"),
                }
              },
            }
            return builder
          },
          insert: (record: any) => {
            const newRow: DBRecord = {
              id: record.id || `conn-${idCounter++}`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...record,
            }
            dbConnectors.push(newRow)
            return {
              select: () => ({
                single: async () => ({ data: { id: newRow.id }, error: null }),
              }),
            }
          },
          update: (fields: any) => {
            const filters: Record<string, any> = {}
            const builder = {
              eq: (col: string, val: any) => {
                filters[col] = val
                for (let i = 0; i < dbConnectors.length; i++) {
                  if (Object.entries(filters).every(([k, v]) => dbConnectors[i]![k] === v)) {
                    dbConnectors[i] = { ...dbConnectors[i]!, ...fields }
                  }
                }
                return Promise.resolve({ error: null })
              },
            }
            return builder
          },
          delete: () => {
            const filters: Record<string, any> = {}
            const builder = {
              eq: (col: string, val: any) => {
                filters[col] = val
                const idx = dbConnectors.findIndex((row) =>
                  Object.entries(filters).every(([k, v]) => row[k] === v),
                )
                if (idx !== -1) {
                  dbConnectors.splice(idx, 1)
                }
                return Promise.resolve({ error: null })
              },
            }
            return builder
          },
        }
      }

      if (table === "agent_connector_grants") {
        return {
          select: (_cols?: string) => {
            const filters: Record<string, any> = {}
            const builder = {
              eq: (col: string, val: any) => {
                filters[col] = val
                return builder
              },
              maybeSingle: async () => {
                const match = dbGrants.find((row) =>
                  Object.entries(filters).every(([k, v]) => row[k] === v),
                )
                return { data: match ? { ...match } : null, error: null }
              },
              single: async () => {
                const match = dbGrants.find((row) =>
                  Object.entries(filters).every(([k, v]) => row[k] === v),
                )
                return {
                  data: match ? { ...match } : null,
                  error: match ? null : new Error("Grant not found"),
                }
              },
            }
            return builder
          },
          insert: async (record: any) => {
            const newRow: DBRecord = {
              id: record.id || `grant-${idCounter++}`,
              created_at: new Date().toISOString(),
              ...record,
            }
            dbGrants.push(newRow)
            return { error: null }
          },
          update: (fields: any) => {
            const filters: Record<string, any> = {}
            const builder = {
              eq: (col: string, val: any) => {
                filters[col] = val
                for (let i = 0; i < dbGrants.length; i++) {
                  if (Object.entries(filters).every(([k, v]) => dbGrants[i]![k] === v)) {
                    dbGrants[i] = { ...dbGrants[i]!, ...fields }
                  }
                }
                return Promise.resolve({ error: null })
              },
            }
            return builder
          },
          delete: () => {
            const filters: Record<string, any> = {}
            const builder = {
              eq: (col: string, val: any) => {
                filters[col] = val
                const idx = dbGrants.findIndex((row) =>
                  Object.entries(filters).every(([k, v]) => row[k] === v),
                )
                if (idx !== -1) {
                  dbGrants.splice(idx, 1)
                }
                return Promise.resolve({ error: null })
              },
            }
            return builder
          },
        }
      }

      if (table === "audit_logs") {
        return {
          insert: async (record: any) => {
            dbAuditLogs.push({ id: `audit-${idCounter++}`, ...record })
            return { error: null }
          },
        }
      }

      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: async () => ({ error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    },
  }
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockAdmin(),
}))

// Mock helper functions in connectors sub-modules for route testing
const mockCopilotFlow = {
  deviceCode: "copilot-dev-code-1234",
  userCode: "ABCD-EFGH",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
  interval: 5,
}

const mockCopilotSession = {
  githubToken: "gho_mock_github_oauth_token",
  copilotToken: "tid=mock_copilot_token;exp=1700000000",
  expiresAt: Math.floor(Date.now() / 1000) + 1800,
  chatEnabled: true,
  sku: "copilot_for_business",
}

vi.mock("@/lib/connectors/copilot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/copilot")>()
  return {
    ...actual,
    startCopilotDeviceFlow: vi.fn(async () => mockCopilotFlow),
    pollCopilotDeviceCode: vi.fn(async (code: string) => {
      if (code === "pending-code") return { status: "pending" }
      if (code === "complete-code") return { status: "pending", token: "gho_valid_token" }
      throw new Error("Invalid device code")
    }),
    getCopilotInternalToken: vi.fn(async () => mockCopilotSession),
  }
})

vi.mock("@/lib/connectors/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/openrouter")>()
  return {
    ...actual,
    buildOpenRouterOAuthUrl: vi.fn(async (callbackUrl: string) => ({
      authUrl: `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}`,
      codeVerifier: "mock_openrouter_pkce_verifier_secret_12345",
    })),
    exchangeOpenRouterCode: vi.fn(async (code: string, verifier: string) => {
      if (code === "bad-code") throw new Error("Invalid authorization code")
      return { apiKey: "sk-or-v1-mock-api-key-999" }
    }),
    getOpenRouterKeyDetails: vi.fn(async () => ({
      label: "Sayalabs Integration Key",
      usage: 12.5,
      limit: 100,
      isFreeTier: false,
    })),
  }
})

vi.mock("@/lib/connectors/chatgpt-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connectors/chatgpt-plan")>()
  return {
    ...actual,
    buildChatGptPlanAuthUrl: vi.fn(async (callbackUrl: string) => ({
      authUrl: `https://auth.openai.com/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}`,
      codeVerifier: "mock_chatgpt_pkce_verifier_secret_67890",
      state: "mock_state_uuid_123",
    })),
    exchangeChatGptPlanCode: vi.fn(async (code: string, verifier: string, redirectUri: string) => {
      if (code === "bad-code") throw new Error("Token exchange failed: invalid code")
      return {
        accessToken: "mock_chatgpt_access_token",
        refreshToken: "mock_chatgpt_refresh_token",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        planType: "plus",
      }
    }),
  }
})

// Route handlers
import { GET as getModels } from "../../src/app/api/connectors/models/route"
import { GET as getCopilot, POST as postCopilot } from "../../src/app/api/connectors/copilot/route"
import {
  GET as getOpenRouterOAuth,
  POST as postOpenRouterOAuth,
} from "../../src/app/api/connectors/openrouter/oauth/route"
import {
  GET as getChatGptOAuth,
  POST as postChatGptOAuth,
} from "../../src/app/api/connectors/chatgpt/oauth/route"

// Server actions
import {
  saveWorkspaceConnector,
  deleteWorkspaceConnector,
  testWorkspaceConnector,
  saveAgentConnectorGrant,
  deleteAgentConnectorGrant,
} from "../../src/lib/actions/connectors"
import { decryptSecret, encryptSecret } from "@sayabot/llm"
import * as copilotConnector from "../../src/lib/connectors/copilot"
import * as openRouterConnector from "../../src/lib/connectors/openrouter"
import * as chatGptConnector from "../../src/lib/connectors/chatgpt-plan"
import * as registryConnector from "../../src/lib/connectors/registry"

const realFetch = globalThis.fetch

describe("Web Connectors API & Server Actions Integration Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbConnectors = []
    dbGrants = []
    dbAuditLogs = []
    idCounter = 1

    // Default to authenticated admin user
    mockCurrentUser = {
      id: "user-admin-1",
      email: "admin@sayalabs.in",
      displayName: "Admin Tester",
    }
    mockUserRole = "admin"
  })

  afterAll(() => {
    globalThis.fetch = realFetch
  })

  // =========================================================================
  // 1. Authentication & Security Gates across all routes & actions
  // =========================================================================
  describe("Security & Authentication Gates", () => {
    it("returns 401 when unauthenticated on GET /api/connectors/models", async () => {
      mockCurrentUser = null
      const res = await getModels(new Request("http://localhost/api/connectors/models"))
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toBe("Sign in required")
    })

    it("returns 401 when unauthenticated on GET and POST /api/connectors/copilot", async () => {
      mockCurrentUser = null
      const getRes = await getCopilot()
      expect(getRes.status).toBe(401)
      const getData = await getRes.json()
      expect(getData.error).toBe("Sign in required")

      const postRes = await postCopilot(
        new Request("http://localhost/api/connectors/copilot", {
          method: "POST",
          body: JSON.stringify({ deviceCode: "copilot-123" }),
        }),
      )
      expect(postRes.status).toBe(401)
      const postData = await postRes.json()
      expect(postData.error).toBe("Sign in required")
    })

    it("returns 401 when unauthenticated on GET and POST /api/connectors/openrouter/oauth", async () => {
      mockCurrentUser = null
      const getRes = await getOpenRouterOAuth(
        new Request("http://localhost/api/connectors/openrouter/oauth"),
      )
      expect(getRes.status).toBe(401)
      const getData = await getRes.json()
      expect(getData.error).toBe("Sign in required")

      const postRes = await postOpenRouterOAuth(
        new Request("http://localhost/api/connectors/openrouter/oauth", {
          method: "POST",
          body: JSON.stringify({ code: "code-123", codeVerifier: "verif-123" }),
        }),
      )
      expect(postRes.status).toBe(401)
      const postData = await postRes.json()
      expect(postData.error).toBe("Sign in required")
    })

    it("returns 401 when unauthenticated on GET and POST /api/connectors/chatgpt/oauth", async () => {
      mockCurrentUser = null
      const getRes = await getChatGptOAuth(
        new Request("http://localhost/api/connectors/chatgpt/oauth"),
      )
      expect(getRes.status).toBe(401)
      const getData = await getRes.json()
      expect(getData.error).toBe("Sign in required")

      const postRes = await postChatGptOAuth(
        new Request("http://localhost/api/connectors/chatgpt/oauth", {
          method: "POST",
          body: JSON.stringify({ code: "code-123", codeVerifier: "verif-123" }),
        }),
      )
      expect(postRes.status).toBe(401)
      const postData = await postRes.json()
      expect(postData.error).toBe("Sign in required")
    })

    it("rejects server action calls when user is unauthenticated", async () => {
      mockCurrentUser = null
      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("source", "google_drive")
      form.append("name", "Test Drive")
      form.append("token", "ya29.valid-token")

      const saveRes = await saveWorkspaceConnector(null, form)
      expect(saveRes.ok).toBe(false)
      expect(saveRes.error).toBe("Organization not found")

      const testRes = await testWorkspaceConnector("test-org", "conn-1")
      expect(testRes.ok).toBe(false)
      expect(testRes.error).toBe("Organization not found")

      const delRes = await deleteWorkspaceConnector({ orgSlug: "test-org", connectorId: "conn-1" })
      expect(delRes.ok).toBe(false)
      expect(delRes.error).toBe("Organization not found")

      const grantForm = new FormData()
      grantForm.append("orgSlug", "test-org")
      grantForm.append("agentId", "agent-1")
      grantForm.append("connectorId", "conn-1")
      const grantRes = await saveAgentConnectorGrant(null, grantForm)
      expect(grantRes.ok).toBe(false)
      expect(grantRes.error).toBe("Organization not found")

      const delGrantRes = await deleteAgentConnectorGrant({
        orgSlug: "test-org",
        grantId: "grant-1",
      })
      expect(delGrantRes.ok).toBe(false)
      expect(delGrantRes.error).toBe("Organization not found")
    })

    it("rejects server action calls when user is a non-admin member", async () => {
      mockUserRole = "member"
      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("source", "google_drive")
      form.append("name", "Test Drive")
      form.append("token", "ya29.valid-token")

      const saveRes = await saveWorkspaceConnector(null, form)
      expect(saveRes.ok).toBe(false)
      expect(saveRes.error).toBe("Only organization admins can do this")

      const testRes = await testWorkspaceConnector("test-org", "conn-1")
      expect(testRes.ok).toBe(false)
      expect(testRes.error).toBe("Only organization admins can do this")

      const delRes = await deleteWorkspaceConnector({ orgSlug: "test-org", connectorId: "conn-1" })
      expect(delRes.ok).toBe(false)
      expect(delRes.error).toBe("Only organization admins can do this")
    })
  })

  // =========================================================================
  // 2. /api/connectors/models API Route
  // =========================================================================
  describe("GET /api/connectors/models", () => {
    it("returns expected grouped models structure for authenticated request", async () => {
      const res = await getModels(new Request("http://localhost/api/connectors/models"))
      expect(res.status).toBe(200)

      const body = (await res.json()) as { groups: any[]; totalModelsCount: number }
      expect(body).toHaveProperty("groups")
      expect(body).toHaveProperty("totalModelsCount")
      expect(Array.isArray(body.groups)).toBe(true)
      expect(body.groups.length).toBeGreaterThan(0)
      expect(body.totalModelsCount).toBeGreaterThan(0)

      const firstGroup = body.groups[0]
      expect(firstGroup).toHaveProperty("id")
      expect(firstGroup).toHaveProperty("label")
      expect(firstGroup).toHaveProperty("provider")
      expect(firstGroup).toHaveProperty("models")
      expect(Array.isArray(firstGroup.models)).toBe(true)

      // Ensure secret tokens/keys are never leaked in client payloads
      const payloadStr = JSON.stringify(body)
      expect(payloadStr).not.toContain(TEST_KEK)
      expect(payloadStr).not.toContain("ya29.")
      expect(payloadStr).not.toContain("xoxb-")
      expect(payloadStr).not.toContain("ghp_")
    })

    it("passes custom x-openrouter-key header to model resolver", async () => {
      const spyRegistry = vi.spyOn(registryConnector, "getAllGroupedModels")
      const req = new Request("http://localhost/api/connectors/models", {
        headers: { "x-openrouter-key": "sk-or-custom-client-key-555" },
      })
      const res = await getModels(req)
      expect(res.status).toBe(200)
      expect(spyRegistry).toHaveBeenCalledWith("sk-or-custom-client-key-555")
    })

    it("returns 500 when model retrieval throws", async () => {
      const spyRegistry = vi
        .spyOn(registryConnector, "getAllGroupedModels")
        .mockRejectedValueOnce(new Error("Upstream provider network timeout"))

      const res = await getModels(new Request("http://localhost/api/connectors/models"))
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toBe("Upstream provider network timeout")
    })
  })

  // =========================================================================
  // 3. /api/connectors/copilot Route Handler
  // =========================================================================
  describe("/api/connectors/copilot", () => {
    it("GET initializes Copilot device flow and returns payload", async () => {
      const res = await getCopilot()
      expect(res.status).toBe(200)
      const body = (await res.json()) as typeof mockCopilotFlow
      expect(body.deviceCode).toBe("copilot-dev-code-1234")
      expect(body.userCode).toBe("ABCD-EFGH")
      expect(body.verificationUri).toBe("https://github.com/login/device")
      expect(body.expiresIn).toBe(900)
    })

    it("GET returns 500 when device flow initialization fails", async () => {
      vi.spyOn(copilotConnector, "startCopilotDeviceFlow").mockRejectedValueOnce(
        new Error("GitHub API unavailable"),
      )
      const res = await getCopilot()
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toContain("GitHub API unavailable")
    })

    it("POST rejects requests with missing deviceCode with 400", async () => {
      const res = await postCopilot(
        new Request("http://localhost/api/connectors/copilot", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe("Missing deviceCode")
    })

    it("POST returns pending status when authorization is waiting", async () => {
      const res = await postCopilot(
        new Request("http://localhost/api/connectors/copilot", {
          method: "POST",
          body: JSON.stringify({ deviceCode: "pending-code" }),
        }),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe("pending")
    })

    it("POST returns complete status with session when authorized", async () => {
      const res = await postCopilot(
        new Request("http://localhost/api/connectors/copilot", {
          method: "POST",
          body: JSON.stringify({ deviceCode: "complete-code" }),
        }),
      )
      expect(res.status).toBe(200)
      const data = (await res.json()) as { status: string; session: typeof mockCopilotSession }
      expect(data.status).toBe("complete")
      expect(data.session.githubToken).toBe("gho_mock_github_oauth_token")
      expect(data.session.chatEnabled).toBe(true)
    })

    it("POST returns 500 when polling throws", async () => {
      vi.spyOn(copilotConnector, "pollCopilotDeviceCode").mockRejectedValueOnce(
        new Error("Polling failed: rate limited"),
      )
      const res = await postCopilot(
        new Request("http://localhost/api/connectors/copilot", {
          method: "POST",
          body: JSON.stringify({ deviceCode: "rate-limited-code" }),
        }),
      )
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toContain("Polling failed")
    })
  })

  // =========================================================================
  // 4. /api/connectors/openrouter/oauth Route Handler
  // =========================================================================
  describe("/api/connectors/openrouter/oauth", () => {
    it("GET generates OAuth URL and sets PKCE cookie", async () => {
      const res = await getOpenRouterOAuth(
        new Request("http://localhost/api/connectors/openrouter/oauth"),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { authUrl: string; codeVerifier: string }
      expect(body.authUrl).toContain("openrouter.ai/auth")
      expect(body.codeVerifier).toBe("mock_openrouter_pkce_verifier_secret_12345")

      // Verify cookie is set
      const cookie = res.cookies.get("openrouter_pkce_verifier")
      expect(cookie).toBeDefined()
      expect(cookie?.value).toBe("mock_openrouter_pkce_verifier_secret_12345")
      expect(cookie?.httpOnly).toBe(true)
    })

    it("GET returns 500 when OAuth URL generation throws", async () => {
      vi.spyOn(openRouterConnector, "buildOpenRouterOAuthUrl").mockRejectedValueOnce(
        new Error("PKCE entropy generation failed"),
      )
      const res = await getOpenRouterOAuth(
        new Request("http://localhost/api/connectors/openrouter/oauth"),
      )
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toContain("PKCE entropy generation failed")
    })

    it("POST rejects requests missing code and codeVerifier with 400", async () => {
      const res = await postOpenRouterOAuth(
        new Request("http://localhost/api/connectors/openrouter/oauth", {
          method: "POST",
          body: JSON.stringify({ code: "code-only" }),
        }),
      )
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe("Missing authorization code or code verifier")
    })

    it("POST exchanges code with codeVerifier in body", async () => {
      const res = await postOpenRouterOAuth(
        new Request("http://localhost/api/connectors/openrouter/oauth", {
          method: "POST",
          body: JSON.stringify({
            code: "valid-code",
            codeVerifier: "mock_openrouter_pkce_verifier_secret_12345",
          }),
        }),
      )
      expect(res.status).toBe(200)
      const data = (await res.json()) as { ok: boolean; apiKey: string; keyDetails: any }
      expect(data.ok).toBe(true)
      expect(data.apiKey).toBe("sk-or-v1-mock-api-key-999")
      expect(data.keyDetails.label).toBe("Sayalabs Integration Key")
    })

    it("POST retrieves codeVerifier from cookie header when omitted in body", async () => {
      const res = await postOpenRouterOAuth(
        new Request("http://localhost/api/connectors/openrouter/oauth", {
          method: "POST",
          headers: {
            cookie: "openrouter_pkce_verifier=verifier_from_cookie_value; other=1",
          },
          body: JSON.stringify({ code: "valid-code" }),
        }),
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(data.apiKey).toBe("sk-or-v1-mock-api-key-999")
    })

    it("POST returns 500 when code exchange fails", async () => {
      const res = await postOpenRouterOAuth(
        new Request("http://localhost/api/connectors/openrouter/oauth", {
          method: "POST",
          body: JSON.stringify({ code: "bad-code", codeVerifier: "any-verifier" }),
        }),
      )
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toContain("Invalid authorization code")
    })
  })

  // =========================================================================
  // 5. /api/connectors/chatgpt/oauth Route Handler
  // =========================================================================
  describe("/api/connectors/chatgpt/oauth", () => {
    it("GET generates ChatGPT auth URL and sets PKCE cookie", async () => {
      const res = await getChatGptOAuth(
        new Request("http://localhost/api/connectors/chatgpt/oauth"),
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { authUrl: string; codeVerifier: string; state: string }
      expect(body.authUrl).toContain("auth.openai.com")
      expect(body.codeVerifier).toBe("mock_chatgpt_pkce_verifier_secret_67890")
      expect(body.state).toBe("mock_state_uuid_123")

      const cookie = res.cookies.get("chatgpt_pkce_verifier")
      expect(cookie).toBeDefined()
      expect(cookie?.value).toBe("mock_chatgpt_pkce_verifier_secret_67890")
    })

    it("GET returns 500 when URL generation fails", async () => {
      vi.spyOn(chatGptConnector, "buildChatGptPlanAuthUrl").mockRejectedValueOnce(
        new Error("Failed to craft PKCE state"),
      )
      const res = await getChatGptOAuth(
        new Request("http://localhost/api/connectors/chatgpt/oauth"),
      )
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toContain("Failed to craft PKCE state")
    })

    it("POST rejects requests missing code with 400", async () => {
      const res = await postChatGptOAuth(
        new Request("http://localhost/api/connectors/chatgpt/oauth", {
          method: "POST",
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBe("Missing authorization code or verifier")
    })

    it("POST exchanges code using cookie verifier", async () => {
      const res = await postChatGptOAuth(
        new Request("http://localhost/api/connectors/chatgpt/oauth", {
          method: "POST",
          headers: {
            cookie: "chatgpt_pkce_verifier=mock_chatgpt_pkce_verifier_secret_67890",
          },
          body: JSON.stringify({ code: "valid-chatgpt-code" }),
        }),
      )
      expect(res.status).toBe(200)
      const data = (await res.json()) as { ok: boolean; credentials: any }
      expect(data.ok).toBe(true)
      expect(data.credentials.accessToken).toBe("mock_chatgpt_access_token")
      expect(data.credentials.planType).toBe("plus")
    })

    it("POST returns 500 when code exchange fails", async () => {
      const res = await postChatGptOAuth(
        new Request("http://localhost/api/connectors/chatgpt/oauth", {
          method: "POST",
          body: JSON.stringify({ code: "bad-code", codeVerifier: "test-verif" }),
        }),
      )
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toContain("Token exchange failed")
    })
  })

  // =========================================================================
  // 6. Server Actions: saveWorkspaceConnector & deleteWorkspaceConnector
  // =========================================================================
  describe("Server Actions: saveWorkspaceConnector & deleteWorkspaceConnector", () => {
    it("validates connector source", async () => {
      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("source", "dropbox_unsupported")
      form.append("name", "Dropbox Connector")
      form.append("token", "secret-token")

      const res = await saveWorkspaceConnector(null, form)
      expect(res.ok).toBe(false)
      expect(res.error).toContain("Choose a supported connector source")
    })

    it("validates connector name length", async () => {
      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("source", "google_drive")
      form.append("name", "")
      form.append("token", "ya29.valid-token")

      const res = await saveWorkspaceConnector(null, form)
      expect(res.ok).toBe(false)
      expect(res.error).toContain("Connector name must be between 1 and 80 characters")
    })

    it("validates token presence and minimum length", async () => {
      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("source", "google_drive")
      form.append("name", "My Drive")
      form.append("token", "ab")

      const res = await saveWorkspaceConnector(null, form)
      expect(res.ok).toBe(false)
      expect(res.error).toContain("Access token, bot token, or service key is required")
    })

    it("validates configJson is valid JSON", async () => {
      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("source", "slack")
      form.append("name", "Slack Workspace")
      form.append("token", "xoxb-valid-slack-token")
      form.append("configJson", "{ malformed: json")

      const res = await saveWorkspaceConnector(null, form)
      expect(res.ok).toBe(false)
      expect(res.error).toBe("Config must be valid JSON")
    })

    it("creates a new connector with encrypted credentials in DB and logs audit", async () => {
      const plaintextToken = "ya29.google-drive-secret-oauth-token-999"
      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("source", "google_drive")
      form.append("name", "Engineering Drive")
      form.append("token", plaintextToken)
      form.append("driveDomain", "sayalabs.in")
      form.append("configJson", JSON.stringify({ customSetting: true }))

      const res = await saveWorkspaceConnector(null, form)
      expect(res.ok).toBe(true)
      expect(res.message).toContain("Engineering Drive connector connected successfully")
      const connectorId = res.data?.connectorId ?? (res as any).connectorId
      expect(connectorId).toBeDefined()

      // Verify token is NOT leaked in client response payload
      const responseStr = JSON.stringify(res)
      expect(responseStr).not.toContain(plaintextToken)
      expect(responseStr).not.toContain("ya29.")

      // Verify DB record has encrypted credentials
      expect(dbConnectors).toHaveLength(1)
      const saved = dbConnectors[0]!
      expect(saved.org_id).toBe("org-1")
      expect(saved.source).toBe("google_drive")
      expect(saved.name).toBe("Engineering Drive")
      expect(saved.status).toBe("active")
      expect(saved.last4).toBe("t-999".slice(-4)) // last 4 chars

      // Must be encrypted with ciphertext, iv, tag
      expect(saved.ciphertext).toBeDefined()
      expect(saved.iv).toBeDefined()
      expect(saved.tag).toBeDefined()
      expect(saved.ciphertext).not.toBe(plaintextToken)

      // Test decrypting with test KEK
      const decrypted = decryptSecret(
        {
          ciphertext: saved.ciphertext,
          iv: saved.iv,
          tag: saved.tag,
        },
        TEST_KEK,
      )
      expect(decrypted).toBe(plaintextToken)

      // Verify config was saved
      expect(saved.config).toMatchObject({
        customSetting: true,
        domain: "sayalabs.in",
      })

      // Verify audit log entry
      expect(dbAuditLogs).toHaveLength(1)
      expect(dbAuditLogs[0]!.action).toBe("workspace_connector.created")
      expect(dbAuditLogs[0]!.target).toBe("Engineering Drive")
    })

    it("updates an existing connector with re-encrypted credentials", async () => {
      // Seed existing connector
      const existingToken = "xoxb-old-token-1111"
      const encryptedOld = encryptSecret(existingToken, TEST_KEK)
      dbConnectors.push({
        id: "conn-slack-1",
        org_id: "org-1",
        source: "slack",
        name: "Old Slack Name",
        ciphertext: encryptedOld.ciphertext,
        iv: encryptedOld.iv,
        tag: encryptedOld.tag,
        last4: "1111",
        status: "error",
        error_message: "Expired token",
        config: {},
      })

      const newToken = "xoxb-new-slack-bot-token-2222"
      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("connectorId", "conn-slack-1")
      form.append("source", "slack")
      form.append("name", "Updated Slack Production")
      form.append("token", newToken)
      form.append("defaultChannel", "general")

      const res = await saveWorkspaceConnector(null, form)
      expect(res.ok).toBe(true)
      expect(res.message).toContain("Updated Slack Production connector updated successfully")
      const connectorId = res.data?.connectorId ?? (res as any).connectorId
      expect(connectorId).toBe("conn-slack-1")

      // Ensure secret token is not returned
      expect(JSON.stringify(res)).not.toContain(newToken)

      // Verify updated DB record
      const updated = dbConnectors.find((c) => c.id === "conn-slack-1")!
      expect(updated.name).toBe("Updated Slack Production")
      expect(updated.status).toBe("active")
      expect(updated.error_message).toBeNull()
      expect(updated.last4).toBe("2222")
      expect(updated.config.defaultChannel).toBe("general")

      // Verify new token decrypts
      const decrypted = decryptSecret(
        {
          ciphertext: updated.ciphertext,
          iv: updated.iv,
          tag: updated.tag,
        },
        TEST_KEK,
      )
      expect(decrypted).toBe(newToken)

      // Verify audit log
      const audit = dbAuditLogs.find((a) => a.action === "workspace_connector.updated")
      expect(audit).toBeDefined()
      expect(audit?.target).toBe("Updated Slack Production")
    })

    it("prevents updating a connector belonging to another organization (cross-tenant check)", async () => {
      // Seed connector for other org
      dbConnectors.push({
        id: "conn-other-tenant",
        org_id: "other-org-id",
        source: "github",
        name: "Competitor GitHub",
        ciphertext: "ct",
        iv: "iv",
        tag: "tag",
      })

      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("connectorId", "conn-other-tenant")
      form.append("source", "github")
      form.append("name", "Hacked Connector")
      form.append("token", "ghp_attempted_token_leak")

      const res = await saveWorkspaceConnector(null, form)
      expect(res.ok).toBe(false)
      expect(res.error).toBe("Connector not found")
    })

    it("deletes a workspace connector and writes audit log", async () => {
      dbConnectors.push({
        id: "conn-del-1",
        org_id: "org-1",
        source: "github",
        name: "Repo Integration",
        ciphertext: "ct",
        iv: "iv",
        tag: "tag",
      })

      const res = await deleteWorkspaceConnector({
        orgSlug: "test-org",
        connectorId: "conn-del-1",
      })
      expect(res.ok).toBe(true)
      expect(res.message).toBe("Connector deleted")

      expect(dbConnectors.find((c) => c.id === "conn-del-1")).toBeUndefined()

      const audit = dbAuditLogs.find((a) => a.action === "workspace_connector.deleted")
      expect(audit).toBeDefined()
      expect(audit?.target).toBe("Repo Integration")
    })

    it("returns error when attempting to delete non-existent or other org's connector", async () => {
      const res = await deleteWorkspaceConnector({
        orgSlug: "test-org",
        connectorId: "conn-does-not-exist",
      })
      expect(res.ok).toBe(false)
      expect(res.error).toBe("Connector not found")
    })
  })

  // =========================================================================
  // 7. Server Action: testWorkspaceConnector (Live Provider Mocking)
  // =========================================================================
  describe("Server Action: testWorkspaceConnector", () => {
    it("returns fail when connector is not found", async () => {
      const res = await testWorkspaceConnector("test-org", "non-existent-id")
      expect(res.ok).toBe(false)
      expect(res.error).toBe("Connector not found")
    })

    it("handles decryption failure safely without crashing and records error status", async () => {
      // Insert connector with corrupted ciphertext / invalid tag
      dbConnectors.push({
        id: "conn-corrupted",
        org_id: "org-1",
        source: "google_drive",
        name: "Corrupted Drive",
        ciphertext: "bad-base64-ciphertext-!@#$",
        iv: "invalid-iv",
        tag: "invalid-tag",
        status: "active",
      })

      const res = await testWorkspaceConnector("test-org", "conn-corrupted")
      expect(res.ok).toBe(false)
      expect(res.error).toBe("Failed to decrypt connector credentials")

      const updated = dbConnectors.find((c) => c.id === "conn-corrupted")!
      expect(updated.status).toBe("error")
      expect(updated.error_message).toContain("Decryption failed; check workspace master key")
    })

    it("tests Google Drive connector successfully, sending decrypted bearer token in Authorization header", async () => {
      const plainToken = "ya29.google-test-token-777"
      const encrypted = encryptSecret(plainToken, TEST_KEK)
      dbConnectors.push({
        id: "conn-gdrive-test",
        org_id: "org-1",
        source: "google_drive",
        name: "Google Drive Prod",
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        status: "pending",
      })

      let interceptedAuthHeader = ""
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url)
        if (u.includes("googleapis.com/drive/v3/about")) {
          const headers = new Headers(init?.headers)
          interceptedAuthHeader = headers.get("authorization") || ""
          return new Response(
            JSON.stringify({
              user: { displayName: "Sayalabs Service", emailAddress: "bot@sayalabs.in" },
            }),
            { status: 200 },
          )
        }
        return new Response("Not found", { status: 404 })
      }) as typeof fetch

      const res = await testWorkspaceConnector("test-org", "conn-gdrive-test")
      expect(res.ok).toBe(true)
      expect(res.message).toContain("Connection successful")
      expect(res.message).toContain("Connected as bot@sayalabs.in")
      expect(interceptedAuthHeader).toBe(`Bearer ${plainToken}`)

      // Secret token must NEVER be returned in client response payload
      expect(JSON.stringify(res)).not.toContain(plainToken)

      const updated = dbConnectors.find((c) => c.id === "conn-gdrive-test")!
      expect(updated.status).toBe("active")
      expect(updated.error_message).toBeNull()
      expect(updated.last_synced_at).toBeDefined()
    })

    it("tests Slack connector successfully", async () => {
      const plainToken = "xoxb-slack-token-888"
      const encrypted = encryptSecret(plainToken, TEST_KEK)
      dbConnectors.push({
        id: "conn-slack-test",
        org_id: "org-1",
        source: "slack",
        name: "Slack Main",
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        status: "pending",
      })

      globalThis.fetch = (async (url: string | URL | Request, _init?: RequestInit) => {
        const u = String(url)
        if (u.includes("slack.com/api/auth.test")) {
          return new Response(
            JSON.stringify({ ok: true, team: "Sayalabs HQ", user: "sayabot" }),
            { status: 200 },
          )
        }
        return new Response("Not found", { status: 404 })
      }) as typeof fetch

      const res = await testWorkspaceConnector("test-org", "conn-slack-test")
      expect(res.ok).toBe(true)
      expect(res.message).toContain('Connected to workspace "Sayalabs HQ" as @sayabot')
      expect(JSON.stringify(res)).not.toContain(plainToken)

      const updated = dbConnectors.find((c) => c.id === "conn-slack-test")!
      expect(updated.status).toBe("active")
    })

    it("updates connector status to error when provider returns failure", async () => {
      const plainToken = "xoxb-invalid-token"
      const encrypted = encryptSecret(plainToken, TEST_KEK)
      dbConnectors.push({
        id: "conn-slack-fail",
        org_id: "org-1",
        source: "slack",
        name: "Slack Failing",
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        status: "active",
      })

      globalThis.fetch = (async (url: string | URL | Request, _init?: RequestInit) => {
        const u = String(url)
        if (u.includes("slack.com/api/auth.test")) {
          return new Response(
            JSON.stringify({ ok: false, error: "invalid_auth" }),
            { status: 200 },
          )
        }
        return new Response("Not found", { status: 404 })
      }) as typeof fetch

      const res = await testWorkspaceConnector("test-org", "conn-slack-fail")
      expect(res.ok).toBe(false)
      expect(res.error).toContain("Connection test failed: Slack error: invalid_auth")

      const updated = dbConnectors.find((c) => c.id === "conn-slack-fail")!
      expect(updated.status).toBe("error")
      expect(updated.error_message).toContain("invalid_auth")
    })

    it("tests GitHub connector successfully with user-agent verification", async () => {
      const plainToken = "ghp_mock_pat_999"
      const encrypted = encryptSecret(plainToken, TEST_KEK)
      dbConnectors.push({
        id: "conn-github-test",
        org_id: "org-1",
        source: "github",
        name: "GitHub Team",
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        status: "pending",
      })

      let userAgentHeader = ""
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url)
        if (u.includes("api.github.com/user")) {
          const headers = new Headers(init?.headers)
          userAgentHeader = headers.get("user-agent") || ""
          return new Response(JSON.stringify({ login: "sayabot-app" }), { status: 200 })
        }
        return new Response("Not found", { status: 404 })
      }) as typeof fetch

      const res = await testWorkspaceConnector("test-org", "conn-github-test")
      expect(res.ok).toBe(true)
      expect(res.message).toContain("Connected as GitHub user @sayabot-app")
      expect(userAgentHeader).toBe("Saaya-Enterprise-Connectors")
      expect(JSON.stringify(res)).not.toContain(plainToken)

      const updated = dbConnectors.find((c) => c.id === "conn-github-test")!
      expect(updated.status).toBe("active")
    })
  })

  // =========================================================================
  // 8. Server Actions: saveAgentConnectorGrant & deleteAgentConnectorGrant
  // =========================================================================
  describe("Server Actions: Agent Connector Grants", () => {
    beforeEach(() => {
      // Seed a connector for org-1
      dbConnectors.push({
        id: "conn-slack-shared",
        org_id: "org-1",
        source: "slack",
        name: "Slack Shared",
        ciphertext: "ct",
        iv: "iv",
        tag: "tag",
      })
    })

    it("rejects grant if connector does not belong to the workspace", async () => {
      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("agentId", "agent-finance")
      form.append("connectorId", "conn-does-not-exist")

      const res = await saveAgentConnectorGrant(null, form)
      expect(res.ok).toBe(false)
      expect(res.error).toBe("Selected connector does not belong to this workspace")
    })

    it("parses scoped folders, channels (stripping leading #), and repos", async () => {
      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("agentId", "agent-finance")
      form.append("connectorId", "conn-slack-shared")
      form.append("allowedChannels", "#general, #finance-team\n#invoices")
      form.append("allowedFolders", "Finance Docs, /2026/Q1")
      form.append("allowedRepos", "sayalabs/core, sayalabs/web")

      const res = await saveAgentConnectorGrant(null, form)
      expect(res.ok).toBe(true)
      expect(res.message).toBe("Granted Slack Shared access to agent")

      expect(dbGrants).toHaveLength(1)
      const grant = dbGrants[0]!
      expect(grant.org_id).toBe("org-1")
      expect(grant.agent_id).toBe("agent-finance")
      expect(grant.connector_id).toBe("conn-slack-shared")
      expect(grant.scope_config).toEqual({
        allowedChannels: ["general", "finance-team", "invoices"],
        allowedFolders: ["Finance Docs", "/2026/Q1"],
        allowedRepos: ["sayalabs/core", "sayalabs/web"],
      })

      const audit = dbAuditLogs.find((a) => a.action === "agent_connector_grant.saved")
      expect(audit).toBeDefined()
      expect(audit?.target).toBe("Slack Shared")
    })

    it("updates existing grant when saved again for the same agent and connector", async () => {
      // Seed existing grant
      dbGrants.push({
        id: "grant-existing-1",
        org_id: "org-1",
        agent_id: "agent-research",
        connector_id: "conn-slack-shared",
        scope_config: { allowedChannels: ["random"] },
      })

      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("agentId", "agent-research")
      form.append("connectorId", "conn-slack-shared")
      form.append("allowedChannels", "#research, #ml-papers")

      const res = await saveAgentConnectorGrant(null, form)
      expect(res.ok).toBe(true)
      expect(res.message).toBe("Granted Slack Shared access to agent")

      // Should update the existing grant, not create a duplicate
      expect(dbGrants).toHaveLength(1)
      const updated = dbGrants[0]!
      expect(updated.id).toBe("grant-existing-1")
      expect(updated.scope_config.allowedChannels).toEqual(["research", "ml-papers"])
    })

    it("revokes an agent connector grant and audits the deletion", async () => {
      dbGrants.push({
        id: "grant-to-delete",
        org_id: "org-1",
        agent_id: "agent-research",
        connector_id: "conn-slack-shared",
      })

      const res = await deleteAgentConnectorGrant({
        orgSlug: "test-org",
        grantId: "grant-to-delete",
      })
      expect(res.ok).toBe(true)
      expect(res.message).toBe("Connector access revoked from agent")

      expect(dbGrants).toHaveLength(0)

      const audit = dbAuditLogs.find((a) => a.action === "agent_connector_grant.deleted")
      expect(audit).toBeDefined()
      expect(audit?.target).toBe("grant-to-delete")
    })

    it("rejects revoking a grant that does not exist or belongs to another org", async () => {
      const res = await deleteAgentConnectorGrant({
        orgSlug: "test-org",
        grantId: "grant-unknown",
      })
      expect(res.ok).toBe(false)
      expect(res.error).toBe("Grant not found")
    })
  })

  // =========================================================================
  // 9. Comprehensive Secret Non-Leakage Check
  // =========================================================================
  describe("Client Payload Redaction & Secret Non-Leakage", () => {
    it("ensures secret tokens never appear in client responses across actions and APIs", async () => {
      const secretToken = "ya29.super-confidential-google-token-42"

      const form = new FormData()
      form.append("orgSlug", "test-org")
      form.append("source", "google_drive")
      form.append("name", "Confidential Drive")
      form.append("token", secretToken)

      const saveRes = await saveWorkspaceConnector(null, form)
      const saveStr = JSON.stringify(saveRes)
      expect(saveStr).not.toContain(secretToken)
      expect(saveStr).not.toContain('"ciphertext"')
      expect(saveStr).not.toContain('"iv":')
      expect(saveStr).not.toContain('"tag":')

      globalThis.fetch = (async () => {
        return new Response(JSON.stringify({ user: { emailAddress: "safe@sayalabs.in" } }), {
          status: 200,
        })
      }) as typeof fetch

      const connectorId = saveRes.data?.connectorId ?? (saveRes as any).connectorId
      const testRes = await testWorkspaceConnector("test-org", connectorId!)
      const testStr = JSON.stringify(testRes)
      expect(testStr).not.toContain(secretToken)
      expect(testStr).not.toContain('"ciphertext"')

      const modelsRes = await getModels(new Request("http://localhost/api/connectors/models"))
      const modelsData = await modelsRes.json()
      const modelsStr = JSON.stringify(modelsData)
      expect(modelsStr).not.toContain(secretToken)
      expect(modelsStr).not.toContain(TEST_KEK)
    })
  })
})
