import { describe, expect, it, vi } from "vitest"
import { isDangerousMcpTool } from "./mcp"
import {
  mcpOAuthStateFor,
  openMcpOAuthState,
  sealMcpOAuthState,
  serverIdFromMcpOAuthState,
  StoredMcpOAuthProvider,
  type McpOAuthState,
} from "./mcp-oauth"

const KEK = Buffer.alloc(32, 7).toString("base64")
const SERVER = "5f0c7c1e-2b7a-4c55-9a39-0f1b8e2b9d11"

describe("isDangerousMcpTool", () => {
  it("gates only listed tools by default", () => {
    expect(isDangerousMcpTool(["delete_file"], "delete_file")).toBe(true)
    expect(isDangerousMcpTool(["delete_file"], "create_page")).toBe(false)
  })

  it("gates every tool with *", () => {
    expect(isDangerousMcpTool(["*"], "search")).toBe(true)
  })

  it("@writes lets reads through and gates everything else", () => {
    for (const name of ["search", "get_page", "list-issues", "getIssue", "fetch_doc", "read_file"]) {
      expect(isDangerousMcpTool(["@writes"], name)).toBe(false)
    }
    for (const name of ["create_page", "update_issue", "delete_doc", "send_email", "listen", "getaway", "execute_sql"]) {
      expect(isDangerousMcpTool(["@writes"], name)).toBe(true)
    }
  })
})

describe("MCP sign-in state", () => {
  it("round-trips through the sealed blob", () => {
    const state: McpOAuthState = { redirectUrl: "https://app.example/cb", tokens: { access_token: "a", token_type: "Bearer" } }
    const sealed = sealMcpOAuthState(state, KEK)
    expect(sealed).not.toContain("access_token")
    expect(openMcpOAuthState(sealed, KEK)).toEqual(state)
  })

  it("puts the server id in the state and reads it back", () => {
    const state = mcpOAuthStateFor(SERVER)
    expect(state.startsWith(`${SERVER}.`)).toBe(true)
    expect(serverIdFromMcpOAuthState(state)).toBe(SERVER)
    expect(serverIdFromMcpOAuthState("not-a-uuid.abc")).toBeNull()
  })
})

describe("StoredMcpOAuthProvider", () => {
  it("persists every change and keeps the old refresh token when a refresh sends none", async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const provider = new StoredMcpOAuthProvider({
      serverId: SERVER,
      state: { redirectUrl: "https://app.example/cb", tokens: { access_token: "old", token_type: "Bearer", refresh_token: "r1" } },
      persist,
    })
    await provider.saveTokens({ access_token: "new", token_type: "Bearer" })
    expect(provider.tokens()).toMatchObject({ access_token: "new", refresh_token: "r1" })
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ tokens: expect.objectContaining({ refresh_token: "r1" }) }))
  })

  it("issues a state bound to the server and stores it", async () => {
    const persist = vi.fn().mockResolvedValue(undefined)
    const provider = new StoredMcpOAuthProvider({ serverId: SERVER, state: { redirectUrl: "https://app.example/cb" }, persist })
    const value = await provider.state()
    expect(provider.storedState()).toBe(value)
    expect(serverIdFromMcpOAuthState(value)).toBe(SERVER)
  })

  it("registers as a public client with the redirect URL", () => {
    const provider = new StoredMcpOAuthProvider({ serverId: SERVER, state: { redirectUrl: "https://app.example/cb" }, persist: async () => {} })
    expect(provider.clientMetadata).toMatchObject({
      redirect_uris: ["https://app.example/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
    })
  })

  it("refuses a missing PKCE verifier instead of sending an empty one", () => {
    const provider = new StoredMcpOAuthProvider({ serverId: SERVER, state: { redirectUrl: "https://app.example/cb" }, persist: async () => {} })
    expect(() => provider.codeVerifier()).toThrow(/expired/)
  })

  it("rejects sign-in servers on plain http", async () => {
    const provider = new StoredMcpOAuthProvider({ serverId: SERVER, state: { redirectUrl: "https://app.example/cb" }, persist: async () => {} })
    await expect(provider.validateAuthorizationServerURL("https://mcp.example", "http://auth.example")).rejects.toThrow(/HTTPS/)
  })
})
