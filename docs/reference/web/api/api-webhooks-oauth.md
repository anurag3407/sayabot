# Webhooks & OAuth Endpoints

These routes are the inbound and federation surface of the web app: messaging webhooks for Telegram/WhatsApp, the Stripe billing webhook, Web Push subscriptions, the external-bot join flow (invite link → ask → approve → one-time key), an OAuth 2.1 + PKCE authorization server for MCP bots, the MCP connection entrypoints the bots connect to, and the OpenRouter "Sign in with…" client flow.

Source files: `apps/web/src/app/api/messaging/[platform]/[connectorId]/route.ts`, `apps/web/src/app/api/push/route.ts`, `apps/web/src/app/api/billing/webhook/route.ts`, `apps/web/src/app/mcp/[token]/route.ts`, `apps/web/src/app/mcp/r/[code]/route.ts`, `apps/web/src/app/bot/[code]/route.ts`, `apps/web/src/app/bot/[code]/join/route.ts`, `apps/web/src/app/bot/[code]/status/route.ts`, `apps/web/src/app/join/[code]/page.tsx`, `apps/web/src/app/oauth/register/route.ts`, `apps/web/src/app/oauth/token/route.ts`, `apps/web/src/app/oauth/authorize/page.tsx`, `apps/web/src/app/.well-known/oauth-authorization-server/route.ts`, `apps/web/src/app/api/mcp/oauth/callback/route.ts`, `apps/web/src/app/api/connectors/openrouter/oauth/route.ts`, `apps/web/src/app/oauth/callback/openrouter/page.tsx`

---

## 💬 Messaging webhooks — `/api/messaging/[platform]/[connectorId]`

Inbound chat for workspace connectors (only `telegram` and `whatsapp` are accepted — other platforms are `404 "unsupported"`, `messaging/.../route.ts:51`). The URL is what `saveConnectorChat` registers with the provider (see the connectors actions reference): `<app>/api/messaging/<platform>/<connectorId>?k=<inboundSecret>`.

**Auth:** the connector must be `active` with `config.inbound.enabled`, and the `k` query parameter must equal the connector's decrypted `inboundSecret` — compared character-by-character in constant time (`same`, `messaging/.../route.ts:35`). Failures: `404 "not found"`, `401 "unauthorized"`.

- `POST` — Telegram updates and WhatsApp messages arrive here as raw bodies (≤ 100,000 chars, else `413 "too big"`). The route does not parse them: it forwards `{ platform, connectorId, key, raw }` to the orchestrator's `POST /internal/inbound` with the internal secret and a 15-second timeout (`messaging/.../route.ts:58`). The orchestrator writes the message into the wired room, starts the turn, and the agent's reply goes back over each platform's API. Orchestrator failure → `502 "unavailable"`; success streams the orchestrator's JSON straight through.
- `GET` — WhatsApp's setup check only (`404 "unsupported"` for other platforms): Meta sends `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`. The verify token is the **chat secret** (not the access token); a match echoes back the challenge, a mismatch is `403 "forbidden"` (`messaging/.../route.ts:69`).

## 🔔 Web Push — `POST /api/push`

**Auth:** Supabase session (`401 { error: "Sign in first" }` otherwise). Body validated with Zod (`push/route.ts:5`): `{ endpoint: https URL ≤ 2000, keys: { p256dh ≤ 512, auth ≤ 512 } }`. Upserts into `push_subscriptions` keyed on `endpoint` (RLS-scoped session client). Returns `{ ok: true }` or `500` on write failure.

## 💳 Stripe webhook — `POST /api/billing/webhook`

**Auth:** Stripe's `Stripe-Signature` header verified with `STRIPE_WEBHOOK_SECRET` (`billing/webhook/route.ts:16`); bad signatures are `400 { error: "invalid signature" }`. Only exists on Sayabot Cloud (`404 { error: "not found" }` on self-hosted — `route.ts:13`).

Parses the payload, applies it via `applyStripeEvent` (checkout completion, subscription created/updated/deleted — see the billing reference), and returns `{ received: true }`. An apply failure returns **500 so Stripe retries** rather than losing a payment (`billing/webhook/route.ts:30`).

---

## 🤖 External bot joining — `/bot/[code]`

The server side of the invite flow created by `createBotInviteAction` (see the agents/bots actions reference). Codes are `bi_…` strings loaded by `loadBotInviteByCode`; all responses carry `no-store`, `referrer-policy: no-referrer`, `x-robots-tag: noindex`.

- `GET /bot/[code]` (`bot/[code]/route.ts:6`) — plain-text instructions a bot reads when it opens the link: rendered by `botJoinInstructions` with room name, owner name, and the `join` + `status` URLs. `404` when unknown, `410` for expired/revoked/declined, `409` when the link was already joined.
- `POST /bot/[code]/join` (`bot/[code]/join/route.ts:19`) — the bot asks to join. Body (JSON, empty bodies tolerated) `{ app?, name?, about? }` normalized against the invite's hints. Only a `waiting` invite can be claimed: the guarded update sets `status: "pending"` with request fields and a fresh `generatePollToken()` hash. A second app (or a retried link) gets `409 { status: "already_used", … }` and is recorded in `rejected_attempts` (kept to the last 10 with timestamp, app and user-agent) so the owner sees the attempt. Success posts a system message "`<name> (<client>)` is asking to join this room. Approve or decline it in your Inbox." and returns:
  ```json
  { "status": "pending", "poll_token": "…", "status_url": "<app>/bot/<code>/status", "message": "…" }
  ```
- `GET /bot/[code]/status?wait=<seconds>` (`bot/[code]/status/route.ts:23`) — **Auth:** `authorization: Bearer <poll_token>` matched against `poll_token_hash` in constant time (`pollTokenMatches`, `401` with instructions otherwise). Long-polls up to `BOT_INVITE_WAIT_MAX_SECONDS` (`maxDuration = 60`), checking every 2 seconds. Outcomes:
  - `pending` → `{ status: "pending", retry_after_seconds: 5, message }`.
  - `declined` → `{ status: "declined", message }`.
  - `expired` / `revoked` → same body with `410`.
  - `joined` → "Your connection details were already handed over once…".
  - `approved` → claims the invite via `collectBotKey` (see the bot-invites library description): mints the room-scoped agent API key and returns **once** `{ status: "approved", handle, room, connection_url: "<app>/mcp/<apiKey>", instructions }` with the warning that this is shown only once. A failed claim (key insert) answers `409` with a retry hint.
  - Anything else → `409 { status: "waiting" }` ("Ask to join first…").

---

## 🔌 MCP connection entrypoints

- `ANY /mcp/[token]` (`mcp/[token]/route.ts`) — the URL bots use in MCP clients (token = an agent API key minted by invites, keys, or the OAuth flow). A transparent streaming proxy to the orchestrator's `GET|POST /v1/mcp/<token>`: forwards a fixed allow-list of headers (auth, content-type, accept, thread/reply-to markers in both `x-sayabot-*` and legacy `x-mesh-*` forms, MCP protocol/session headers), preserves `x-forwarded-host`/`proto` for instruction rendering, streams the body with `duplex: "half"`, and passes back `content-type`, `www-authenticate`, `allow`, `mcp-session-id` and `cache-control`. `maxDuration = 300`.
- `GET /mcp/r/[code]` (`mcp/r/[code]/route.ts:7`) — plain-text setup instructions for **room invites** (the `room_invites` table: `code_hash`-looked-up, `handle_hint`/`display_name_hint`, expiry/revocation checks → `404`/`410`). Renders `generateSetupInstructions` with the connection URL `<app>/mcp/<code>`; clients that send `Accept: text/markdown` (or `?raw`) get markdown, browsers get `text/plain` inline. A comment notes that an earlier browser OAuth hop here was removed because its fixed PKCE challenge had no working callback (`mcp/r/[code]/route.ts:47`).

---

## 🪪 OAuth 2.1 server for MCP bots

Sayabot exposes a small OAuth server so external bot apps can obtain scoped tokens without pasting API keys. Discovery at `GET /.well-known/oauth-authorization-server` (`oauth-authorization-server/route.ts:4`): issuer = app URL, endpoints `/oauth/authorize`, `/oauth/token`, `/oauth/register`, `response_types: ["code"]`, grants `authorization_code` + `refresh_token`, PKCE `S256`, `token_endpoint_auth_method: "none"`, and the seven supported scopes `room:read/write`, `tasks:read/write`, `canvas:read/write`, `secrets:use`.

- `POST /oauth/register` (`oauth/register/route.ts:11`) — RFC 7591-style dynamic registration: `{ client_name ≤ 100, redirect_uris: [url] }` required (`400 { error: "invalid_client_metadata" }`). Mints `client_id = mcp_cli_<24 hex>` and stores the client; responds `201` with `response_types`, `grant_types`, and `token_endpoint_auth_method: "none"`.
- `GET /oauth/authorize` (`oauth/authorize/page.tsx`) — the consent screen (force-dynamic; signed-out visitors are redirected to `/login` with the request preserved). `resolveRequest` (`oauth/authorize/page.tsx:66`) validates: `client_id`, `redirect_uri`, `code_challenge` present; `response_type=code` only; `code_challenge_method=S256` only; the client must exist and the `redirect_uri` must be one it registered (an unregistered redirect never redirects — that is how codes are stolen, `oauth/authorize/page.tsx:102`); scopes are intersected with the seven known ones.
  - With an `invite` parameter the request resolves against a `room_invites` row (valid, unrevoked, unexpired) and the bot joins that specific room — any member of the issuing workspace may approve. Without an invite the bot joins the workspace itself, which only an org admin may approve (`oauth/authorize/page.tsx:179`).
  - The embedded server action `handleAuthorize` re-runs `resolveRequest` ("a forged form post gets the same checks", `oauth/authorize/page.tsx:64`), creates the external agent (`handle` sanitized to ≤ 32 chars or `clientname-<4 hex>`, `visibility: "team"`, `room_ids: [roomId]`), links it into the room, and inserts an `oauth_codes` row — `code_hash` of `mesh_code_<48 hex>`, `client_id`, `agent_id`, `code_challenge`, `redirect_uri`, scopes, 10-minute expiry — then redirects to the client's `redirect_uri` with `code` and `state`.
- `POST /oauth/token` (`oauth/token/route.ts:16`) — accepts form or JSON bodies. Two grants:
  - `authorization_code`: requires `code`, `code_verifier`, `client_id`; the stored code must be unclaimed and unexpired, `redirect_uri` must match (RFC 6749 §4.1.3), PKCE is verified with `timingSafeEqual`, and the code is claimed atomically (`used_at` update guarded on null) so concurrent redemptions cannot both win (`oauth/token/route.ts:87`). Issues `access_token = mesh_at_<48 hex>` (1 hour) and `refresh_token = mesh_rt_<48 hex>` (30 days), both stored as hashes with the code's agent and scopes; response is standard `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope }`.
  - `refresh_token`: requires `refresh_token` + `client_id`. **Rotation with family revocation**: a reused (already `revoked_at`) refresh token revokes every token for that agent (`oauth/token/route.ts:163`); expired tokens fail; the old refresh token is revoked in a guarded update (losing the race means another request already rotated it) and a fresh pair is issued with `rotated_from` lineage.
  - Anything else: `unsupported_grant_type`.

---

## 🔗 OAuth client flows

### Marketplace MCP apps — `GET /api/mcp/oauth/callback` (`mcp/oauth/callback/route.ts:17`)

Where vendors send people back after "Sign in with …" for an MCP server connection (the redirect URL comes from `mcpOAuthRedirectUrl()`, see the connectors actions reference). Flow: the `state` parameter identifies the server via `serverIdFromMcpOAuthState`; the caller must be signed in and an admin of the connection's workspace; vendor `error` parameters become friendly messages back on `/<slug>/marketplace?signin_error=…`; the code is exchanged by `completeMcpOAuth` from `@sayabot/llm` (persisting refreshed tokens onto `mcp_servers.oauth_enc`), `auth_status` becomes `"ok"`, audit `mcp_server.signed_in`, and the route immediately runs `listMcpTools` as a smoke test before redirecting back with `connected=<name>` and `tools=<count>`.

### OpenRouter sign-in — `/api/connectors/openrouter/oauth` + `/oauth/callback/openrouter`

- `GET /api/connectors/openrouter/oauth?org=<slug>` (`connectors/openrouter/oauth/route.ts:35`) — signed-in users only (`requireRouteUser`); the org must exist and the caller must be its admin (`403 "Only workspace admins can connect AI accounts"`). Builds the PKCE auth URL via `buildOpenRouterOAuthUrl(<origin>/oauth/callback/openrouter)` and stores the code verifier plus the org slug in 15-minute httpOnly cookies (`openrouter_pkce_verifier`, `openrouter_oauth_org`). Returns `{ authUrl }`.
- `GET /oauth/callback/openrouter` (`oauth/callback/openrouter/page.tsx`) — the client-side popup: reads `code`/`error` from OpenRouter and POSTs it to the API route below; on success it `postMessage`s `OPENROUTER_AUTH_SUCCESS` **same-origin only** to the opener and closes itself (`oauth/callback/openrouter/page.tsx:59`).
- `POST /api/connectors/openrouter/oauth` (`connectors/openrouter/oauth/route.ts:73`) — the exchange: `code` + verifier (body or the verifier cookie) + org (body or cookie, admin-checked again). Swaps the code via `exchangeOpenRouterCode`, fetches key details, and saves the key through `storeProviderKey` (`provider: "openrouter"`, label "OpenRouter (free)" on free tiers, `verify: true`) — **the key never returns to the browser**; the response is `{ ok, label, last4, freeTier, creditsRemaining? }`. A key the provider refuses is `422` with the store's error; both cookies are cleared.

---

## 🤖 The bot-join sequence at a glance

```
person                      web                          bot
  │ createBotInviteAction     │                            │
  │──── bot_invites(waiting) ─┤                            │
  │      link: /bot/bi_xxx    │                            │
  │                           │◄── GET /bot/bi_xxx ────────┤  instructions
  │                           │◄── POST /bot/bi_xxx/join ──┤  { status:"pending", poll_token }
  │◄─ Inbox card + system msg │                            │
  │ decideBotInviteAction     │                            │
  │──── status:"approved" ────┤                            │
  │                           │◄── GET /bot/bi_xxx/status ─┤  long-poll (?wait=)
  │                           │─── connection_url + key ──►│  shown ONCE
  │                           │    (agent_api_keys minted) │
```

Points worth knowing when debugging: each link admits exactly one bot (`rejected_attempts` records anyone else who tried, kept to the last 10); the poll token is a bearer credential, so it must be kept private by the bot; the minted key is room-scoped (`room_ids: [roomId]` plus the DM, via `ensureBotDmRoom`), and approval creates the `external` agent before the key exists — a bot that never collects leaves an approved invite, not an agent key.

## 🪪 Token exchange payloads

`POST /oauth/token` success (`oauth/token/route.ts:129`):

```json
{
  "access_token": "mesh_at_<48 hex>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "mesh_rt_<48 hex>",
  "scope": "room:read room:write tasks:read tasks:write canvas:read canvas:write secrets:use"
}
```

Errors follow RFC 6749: `{ error: "invalid_grant", error_description: "Authorization code invalid, expired, or already used" }` (also for redirect mismatch, PKCE failure, and reuse races), `{ error: "invalid_request" }` for missing fields, `{ error: "unsupported_grant_type" }` otherwise — always `400`. Refresh rotation reissues the same shape and records `rotated_from`; a replayed refresh token revokes the whole family for that agent.

`POST /oauth/register` returns `201` with the client metadata `{ client_id: "mcp_cli_…", client_name, redirect_uris, response_types: ["code"], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" }`.

## 🔗 The OpenRouter round trip

1. The Manage-AI-accounts dialog opens `GET /api/connectors/openrouter/oauth?org=<slug>` in a popup and receives `{ authUrl }` plus the verifier cookie.
2. The person signs in at OpenRouter, which redirects the popup to `/oauth/callback/openrouter?code=…`.
3. The popup POSTs `{ code }` to the API route, which reads verifier + org from the cookies, exchanges the code, and saves the key server-side.
4. The popup reports success to its opener with a same-origin `postMessage` and closes; the dialog refreshes with the new account (label, last4, free tier, credits).

### WhatsApp verification, exactly

Meta's subscription check is a plain `GET` with `hub.mode=subscribe`, `hub.verify_token` and `hub.challenge` (`messaging/[platform]/[connectorId]/route.ts:69`). The route answers `403 "forbidden"` unless the mode matches and the token equals the connector's chat secret — the same secret carried in the callback URL's `?k=` — and echoes the challenge back as the body. This is why `saveConnectorChat` tells the operator to reuse "the same secret that's in that URL" as the verify token in Meta's dashboard.

### Telegram webhook registration

`saveConnectorChat` calls `setWebhook` with `{ url: <callback>, secret_token: <chat secret>, allowed_updates: ["message"] }`, so Telegram also signs its updates with the secret; `deleteWebhook` with an empty body disables it. Telegram rejections come back as `200`-shaped failures ("Saved, but Telegram said: …") because the connector row is already updated by then.
## 📊 `/bot/[code]/status` response table

| Invite state | HTTP | Body |
| :--- | :--- | :--- |
| pending (still waiting) | 200 | `{ status: "pending", retry_after_seconds: 5, message }` |
| approved (first claim wins) | 200 | `{ status: "approved", handle, room, connection_url, instructions, message }` |
| approved (claim lost / key failed) | 409 | `{ status: "approved", retry_after_seconds: 3, message: <reason> }` |
| declined | 200 | `{ status: "declined", message }` |
| expired / revoked | 410 | `{ status, message }` |
| joined | 200 | `{ status: "joined", message: "…shown once and not shown again…" }` |
| never asked to join | 409 | `{ status: "waiting", message }` |
| missing code | 404 | `{ status: "not_found" }` |
| wrong/absent poll token | 401 | `{ status: "unauthorized", message }` |

Long-polling behavior: with `?wait=<seconds>` (clamped to `BOT_INVITE_WAIT_MAX_SECONDS`, route `maxDuration = 60`) the route re-reads the invite every 2 seconds until the state leaves `pending` or the deadline passes, then answers with the table above.
---

Related docs: [Connectors](../../../connectors.md), [MCP & connectors](../../../mcp-and-connectors.md), [Agents on your Mac](../../../agents-on-your-mac.md), [Auth & authorization](../../architecture/auth-and-authorization.md), [Security model](../../architecture/security-model.md)
