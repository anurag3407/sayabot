# MCP OAuth — Sign-In for MCP Servers

`src/mcp-oauth.ts` implements sign-in ("link") for MCP servers that require it: OAuth 2.1 with authorization-server metadata discovery, dynamic client registration and PKCE, following the MCP spec. Nothing has to be registered with the vendor first, so any catalog app that supports sign-in works from inside Sayabot.

The design constraint that shapes the whole module: the browser part of the flow runs in the web app, while the orchestrator (which talks to the MCP server during turns) only ever refreshes tokens. Everything the flow needs between steps — the client registration, the PKCE verifier, the CSRF state, and the tokens — therefore lives in **one sealed blob** on the `mcp_servers` row, and this module is the object model around that blob.

Source files: `packages/llm/src/mcp-oauth.ts` (260 lines), `packages/llm/src/mcp-oauth.test.ts`

---

## 🗄️ The state blob and the `mcp_servers` row

```typescript
export interface McpOAuthState {
  redirectUrl: string
  clientInformation?: OAuthClientInformation   // dynamic registration result
  dynamicallyRegistered?: boolean
  authorizationServer?: OAuthAuthorizationServerInformation
  tokens?: OAuthTokens                         // access + refresh token
  tokensSavedAt?: number                       // when tokens.expires_in is measured from, ms since epoch
  codeVerifier?: string                        // PKCE verifier between begin and complete
  state?: string                               // CSRF state ("<serverId>.<nonce>")
}
```

(`packages/llm/src/mcp-oauth.ts:22-32`.) Sealing helpers, built directly on `sealSecret`/`openSecret` from [crypto.md](./crypto.md):

```typescript
export function sealMcpOAuthState(state: McpOAuthState, kek: string): string {
  return sealSecret(JSON.stringify(state), kek)
}
export function openMcpOAuthState(sealed: string, kek: string): McpOAuthState {
  const parsed = JSON.parse(openSecret(sealed, kek)) as McpOAuthState
  if (!parsed || typeof parsed.redirectUrl !== "string") throw new Error("Unreadable MCP sign-in state")
  return parsed
}
```

(`mcp-oauth.ts:34-42`.) The test pins that the sealed blob does not contain `access_token` in plaintext and round-trips exactly.

On the database side (`packages/db/src/schema/tools.ts:16-47`):

| Column | Meaning |
| :-- | :-- |
| `auth_kind` | `"static"` (headers or nothing) or `"oauth"` (browser sign-in, this module) |
| `oauth_enc` | The sealed `McpOAuthState` blob |
| `auth_status` | `"ok"`, `"pending"` (sign-in started, waiting for the callback) or `"signed_out"` (tokens gone or refused) |

---

## 🎫 CSRF state format

```typescript
/** `<serverId>.<nonce>`: the callback finds the row from the state alone, then checks the nonce. */
export function mcpOAuthStateFor(serverId: string): string {
  return `${serverId}.${randomBytes(24).toString("base64url")}`
}
export function serverIdFromMcpOAuthState(state: string): string | null
```

(`mcp-oauth.ts:45-52`.) `serverIdFromMcpOAuthState` returns the id only if the prefix is a 36-char hex/uuid shape, else `null` — so `/api/mcp/oauth/callback` can locate the row from the vendor's callback alone and then compare nonces. Tests pin both the round trip and the `null` for `"not-a-uuid.abc"`.

---

## 🔐 `StoredMcpOAuthProvider`

`StoredMcpOAuthProvider implements OAuthClientProvider` from `@ai-sdk/mcp` (`mcp-oauth.ts:81-194`). It is the bridge between the SDK's `auth()` flow and the persisted blob. Constructed with `{ serverId, state, persist, onRedirect?, clientName? }`; every mutation patches `this.current` and then **must** `persist(current)` before the promise settles.

| SDK hook | Behaviour |
| :-- | :-- |
| `redirectUrl` / `clientMetadata` | Public client: `client_name: "Sayabot"` (or `clientName` option), `redirect_uris: [redirectUrl]`, `grant_types: ["authorization_code", "refresh_token"]`, `response_types: ["code"]`, `token_endpoint_auth_method: "none"` (`mcp-oauth.ts:98-106`) |
| `tokens()` / `saveTokens(tokens)` | Returns the stored tokens (the SDK refreshes on a 401). Saving keeps the **old refresh token when the server sends no new one** (`tokens.refresh_token ?? current.tokens?.refresh_token`), stamps `tokensSavedAt`, and clears `codeVerifier`/`state` (`mcp-oauth.ts:118-127`) |
| `redirectToAuthorization(url)` | Calls `onRedirect` — the web app sends the person to that URL; headless runs use it to mark the app signed out |
| `saveCodeVerifier` / `codeVerifier` | Stores the PKCE verifier; reading a missing one throws `"Sign-in expired. Start it again."` — never an empty verifier (`mcp-oauth.ts:133-140`) |
| `clientInformation` / `saveClientInformation` | Dynamic registration result; saving sets `dynamicallyRegistered: true` |
| `authorizationServerInformation` / `saveAuthorizationServerInformation` | Cached auth-server metadata |
| `validateAuthorizationServerURL(_serverUrl, authServerUrl)` | Runs `assertSafeOAuthUrl` on the *authorization server* URL — plain HTTP is refused (`mcp-oauth.ts:162-164`) |
| `state()` / `storedState()` | Generates `<serverId>.<nonce>`, persists it, returns it |
| `invalidateCredentials(scope)` | Clears parts of the blob per scope: `"all"`, `"client"` (+ `dynamicallyRegistered`), `"tokens"` (+ `tokensSavedAt`), or the `verifier` (`mcp-oauth.ts:176-193`) |

`snapshot` returns a shallow copy of the current state, which `completeMcpOAuth` hands back to the caller for storage.

---

## 🛡️ URL safety

```typescript
async function assertSafeOAuthUrl(value: string | URL) {
  const url = new URL(value)
  const allowLocal = process.env.ALLOW_LOCAL_MCP === "true"
  if (url.protocol !== "https:" && !(allowLocal && url.protocol === "http:")) {
    throw new Error("Sign-in servers must use HTTPS")
  }
  if (url.username || url.password) throw new Error("Sign-in URL cannot contain credentials")
  if (!allowLocal) await assertSafeEgressHost(url.hostname)
}
```

(`mcp-oauth.ts:64-72`.) `safeOAuthFetch` wraps `fetch` for discovery and token calls: it validates the URL per the above and forces `redirect: "error"` — "A fetch for OAuth discovery and token calls that refuses private networks and redirects" (`mcp-oauth.ts:75-79`). It is passed to `auth()` as `fetchFn`, so no OAuth hop can be redirected to another host or reach a private network.

---

## 🔄 The two-phase flow

```mermaid
sequenceDiagram
    participant W as Web app
    participant O as mcp-oauth
    participant V as Vendor (auth server)
    participant DB as mcp_servers row

    W->>O: beginMcpOAuth({ serverId, serverUrl, redirectUrl })
    O->>V: auth(provider, { serverUrl, fetchFn: safeOAuthFetch })
    Note over O,V: discovery + dynamic registration + PKCE
    O->>DB: persist state (registration, verifier, CSRF state)
    O-->>W: { authorizationUrl } (or null = already authorized)
    W-->>W: browser redirects person to vendor, vendor returns ?code&state
    W->>O: completeMcpOAuth({ code, callbackState, state })
    O->>O: state.state === callbackState (else "stale or opened twice")
    O->>V: auth(..., { authorizationCode, callbackState, fetchFn })
    O->>DB: persist sealed tokens; auth_status = "ok"
```

### `beginMcpOAuth` (`mcp-oauth.ts:200-230`)

- Validates the server URL, then builds a `StoredMcpOAuthProvider` whose initial state **keeps a working client registration and drops old tokens** (a fresh sign-in): if `previous.redirectUrl` matches, `clientInformation`, `dynamicallyRegistered` and `authorizationServer` are carried over; tokens and verifier never are.
- Runs `auth(provider, { serverUrl, fetchFn: safeOAuthFetch })`.
- Returns `{ authorizationUrl: string | null }` — `null` when the server let us in without a page (valid tokens already, or no sign-in needed). `REDIRECT` without a captured URL throws `"The app did not return a sign-in page"`.

### `completeMcpOAuth` (`mcp-oauth.ts:233-259`)

- **CSRF check first**: `state.state` must exist and equal `callbackState`, else `"This sign-in link is stale or was opened twice. Start it again."`.
- Calls `auth()` with `authorizationCode`, `callbackState` and optional `callbackIssuer`; anything but `"AUTHORIZED"` throws `"The app did not accept the sign-in"`.
- Returns `provider.snapshot` — the caller (web callback route) seals it back into `oauth_enc` and sets `auth_status = "ok"`.

### Token refresh at run time

The orchestrator builds a `StoredMcpOAuthProvider` from the row's `oauth_enc` and passes it as the `authProvider` of the `McpServerConfig` ([mcp.md](./mcp.md)). When a call answers 401, `@ai-sdk/mcp` invokes `tokens()` → sees the access token → refreshes via the refresh token → `saveTokens()` persists the new sealed blob. The web callback route (`apps/web/src/app/api/mcp/oauth/callback/route.ts`) and the orchestrator tool builder (`apps/orchestrator/src/tools/index.ts:3-13`, importing `beginMcpOAuth`-adjacent helpers `openMcpOAuthState`, `sealMcpOAuthState`, `StoredMcpOAuthProvider`, `serverIdFromMcpOAuthState`) are the two integration points.

---

## 🧪 Test coverage (`mcp-oauth.test.ts`)

Uses a dummy KEK (`Buffer.alloc(32, 7).toString("base64")`) and a fixed server UUID:

| Suite | Pins |
| :-- | :-- |
| `isDangerousMcpTool` (re-exported from `mcp.ts`) | Exact-name gating; `"*"` gates everything; `"@writes"` passes read verbs (`search`, `get_page`, `list-issues`, `getIssue`, `fetch_doc`, `read_file`) and gates writes (`create_page`, `update_issue`, `delete_doc`, `send_email`, `listen`, `getaway`, `execute_sql`) |
| `MCP sign-in state` | `sealMcpOAuthState` output contains no `access_token`; `openMcpOAuthState` round-trips; state format `<serverId>.<nonce>` with uuid extraction and `null` for non-uuid |
| `StoredMcpOAuthProvider` | Every change reaches `persist`; a refresh without a new refresh token keeps the old one (`refresh_token: "r1"` survives); `state()` binds the server id and stores it; `clientMetadata` is a public client (`token_endpoint_auth_method: "none"`, the two grant types, the redirect URI); missing PKCE verifier throws `/expired/`; `validateAuthorizationServerURL` rejects plain HTTP with `/HTTPS/` |

---

## Related docs

- [mcp.md](./mcp.md) — the connection gateway consuming `authProvider`
- [crypto.md](./crypto.md) — `sealSecret`/`openSecret` underneath the state blob
- [overview.md](./overview.md) — package map
- [../../mcp-and-connectors.md](../../mcp-and-connectors.md) — user-facing MCP guide
