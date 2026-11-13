import { randomBytes } from "node:crypto"
import type {
  OAuthAuthorizationServerInformation,
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp"
import { auth } from "@ai-sdk/mcp"
import { assertSafeEgressHost } from "@sayabot/core/server"
import { openSecret, sealSecret } from "./crypto"

/**
 * Sign-in ("link") MCP servers: OAuth 2.1 with discovery, dynamic client registration and PKCE,
 * the way the MCP spec describes it. Nothing needs registering with the vendor first, so any
 * catalog app that supports sign-in works from inside Sayabot.
 *
 * Everything the flow needs between steps (client registration, PKCE verifier, CSRF state, the
 * tokens) lives in one sealed blob on the mcp_servers row. The web app runs the browser part;
 * the orchestrator only ever refreshes tokens and saves the new ones back.
 */
export interface McpOAuthState {
  redirectUrl: string
  clientInformation?: OAuthClientInformation
  dynamicallyRegistered?: boolean
  authorizationServer?: OAuthAuthorizationServerInformation
  tokens?: OAuthTokens
  /** When `tokens.expires_in` is measured from, ms since epoch. */
  tokensSavedAt?: number
  codeVerifier?: string
  state?: string
}

export function sealMcpOAuthState(state: McpOAuthState, kek: string): string {
  return sealSecret(JSON.stringify(state), kek)
}

export function openMcpOAuthState(sealed: string, kek: string): McpOAuthState {
  const parsed = JSON.parse(openSecret(sealed, kek)) as McpOAuthState
  if (!parsed || typeof parsed.redirectUrl !== "string") throw new Error("Unreadable MCP sign-in state")
  return parsed
}

/** `<serverId>.<nonce>`: the callback finds the row from the state alone, then checks the nonce. */
export function mcpOAuthStateFor(serverId: string): string {
  return `${serverId}.${randomBytes(24).toString("base64url")}`
}

export function serverIdFromMcpOAuthState(state: string): string | null {
  const id = state.split(".")[0] ?? ""
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

export interface StoredMcpOAuthProviderOptions {
  serverId: string
  state: McpOAuthState
  /** Called after every change. It must store the blob before the promise settles. */
  persist: (state: McpOAuthState) => Promise<void>
  /** Interactive: keep the URL to send the person to. Headless: the run marks the app as signed out. */
  onRedirect?: (url: URL) => void
  clientName?: string
}

async function assertSafeOAuthUrl(value: string | URL) {
  const url = new URL(value)
  const allowLocal = process.env.ALLOW_LOCAL_MCP === "true"
  if (url.protocol !== "https:" && !(allowLocal && url.protocol === "http:")) {
    throw new Error("Sign-in servers must use HTTPS")
  }
  if (url.username || url.password) throw new Error("Sign-in URL cannot contain credentials")
  if (!allowLocal) await assertSafeEgressHost(url.hostname)
}

/** A fetch for OAuth discovery and token calls that refuses private networks and redirects. */
export const safeOAuthFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" || input instanceof URL ? input : input.url
  await assertSafeOAuthUrl(url)
  return fetch(input, { ...init, redirect: "error" })
}

export class StoredMcpOAuthProvider implements OAuthClientProvider {
  private current: McpOAuthState
  private readonly opts: StoredMcpOAuthProviderOptions

  constructor(opts: StoredMcpOAuthProviderOptions) {
    this.opts = opts
    this.current = { ...opts.state }
  }

  get snapshot(): McpOAuthState {
    return { ...this.current }
  }

  get redirectUrl(): string {
    return this.current.redirectUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.opts.clientName ?? "Sayabot",
      redirect_uris: [this.current.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    } as OAuthClientMetadata
  }

  private async save(patch: Partial<McpOAuthState>) {
    this.current = { ...this.current, ...patch }
    await this.opts.persist(this.current)
  }

  /** An expired access token gets a 401, and the SDK then refreshes it with the refresh token. */
  tokens(): OAuthTokens | undefined {
    return this.current.tokens
  }

  async saveTokens(tokens: OAuthTokens) {
    // Some servers send no new refresh token on refresh; keep the one we have.
    const refresh = tokens.refresh_token ?? this.current.tokens?.refresh_token
    await this.save({
      tokens: refresh ? { ...tokens, refresh_token: refresh } : tokens,
      tokensSavedAt: Date.now(),
      codeVerifier: undefined,
      state: undefined,
    })
  }

  redirectToAuthorization(url: URL) {
    this.opts.onRedirect?.(url)
  }

  async saveCodeVerifier(codeVerifier: string) {
    await this.save({ codeVerifier })
  }

  codeVerifier(): string {
    if (!this.current.codeVerifier) throw new Error("Sign-in expired. Start it again.")
    return this.current.codeVerifier
  }

  clientInformation(): OAuthClientInformation | undefined {
    return this.current.clientInformation
  }

  isClientInformationDynamicallyRegistered(): boolean {
    return this.current.dynamicallyRegistered === true
  }

  async saveClientInformation(clientInformation: OAuthClientInformation) {
    await this.save({ clientInformation, dynamicallyRegistered: true })
  }

  authorizationServerInformation(): OAuthAuthorizationServerInformation | undefined {
    return this.current.authorizationServer
  }

  async saveAuthorizationServerInformation(authorizationServer: OAuthAuthorizationServerInformation) {
    await this.save({ authorizationServer })
  }

  async validateAuthorizationServerURL(_serverUrl: string | URL, authorizationServerUrl: string | URL) {
    await assertSafeOAuthUrl(authorizationServerUrl)
  }

  async state(): Promise<string> {
    const value = mcpOAuthStateFor(this.opts.serverId)
    await this.save({ state: value })
    return value
  }

  storedState(): string | undefined {
    return this.current.state
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier") {
    if (scope === "all") {
      await this.save({
        clientInformation: undefined,
        dynamicallyRegistered: undefined,
        authorizationServer: undefined,
        tokens: undefined,
        tokensSavedAt: undefined,
        codeVerifier: undefined,
      })
    } else if (scope === "client") {
      await this.save({ clientInformation: undefined, dynamicallyRegistered: undefined })
    } else if (scope === "tokens") {
      await this.save({ tokens: undefined, tokensSavedAt: undefined })
    } else {
      await this.save({ codeVerifier: undefined })
    }
  }
}

/**
 * Starts a sign-in. Returns the page to send the person to, or null when the server let us in
 * without one (it already had valid tokens, or needs no sign-in at all).
 */
export async function beginMcpOAuth(args: {
  serverId: string
  serverUrl: string
  redirectUrl: string
  persist: (state: McpOAuthState) => Promise<void>
  previous?: McpOAuthState
}): Promise<{ authorizationUrl: string | null }> {
  await assertSafeOAuthUrl(args.serverUrl)
  let authorizationUrl: string | null = null
  const provider = new StoredMcpOAuthProvider({
    serverId: args.serverId,
    // Keep a working client registration, drop old tokens: this is a fresh sign-in.
    state: {
      redirectUrl: args.redirectUrl,
      ...(args.previous?.redirectUrl === args.redirectUrl
        ? {
            clientInformation: args.previous.clientInformation,
            dynamicallyRegistered: args.previous.dynamicallyRegistered,
            authorizationServer: args.previous.authorizationServer,
          }
        : {}),
    },
    persist: args.persist,
    onRedirect: (url) => {
      authorizationUrl = url.toString()
    },
  })
  const result = await auth(provider, { serverUrl: args.serverUrl, fetchFn: safeOAuthFetch })
  if (result === "REDIRECT" && !authorizationUrl) throw new Error("The app did not return a sign-in page")
  return { authorizationUrl: result === "REDIRECT" ? authorizationUrl : null }
}

/** Finishes a sign-in with the code the vendor sent back. */
export async function completeMcpOAuth(args: {
  serverId: string
  serverUrl: string
  state: McpOAuthState
  code: string
  callbackState: string
  callbackIssuer?: string
  persist: (state: McpOAuthState) => Promise<void>
}): Promise<McpOAuthState> {
  if (!args.state.state || args.state.state !== args.callbackState) {
    throw new Error("This sign-in link is stale or was opened twice. Start it again.")
  }
  const provider = new StoredMcpOAuthProvider({
    serverId: args.serverId,
    state: args.state,
    persist: args.persist,
  })
  const result = await auth(provider, {
    serverUrl: args.serverUrl,
    authorizationCode: args.code,
    callbackState: args.callbackState,
    ...(args.callbackIssuer ? { callbackIssuer: args.callbackIssuer } : {}),
    fetchFn: safeOAuthFetch,
  })
  if (result !== "AUTHORIZED") throw new Error("The app did not accept the sign-in")
  return provider.snapshot
}
