# Connectors & Bot Store

Sayabot separates app integrations from ready-made agent discovery into two dedicated workspace destinations in the Tools navigation:

1. **Connectors** (`/[org]/connectors`): Where a workspace connects the external tools and services its agents can use — remote MCP servers, OAuth integrations (Slack, Google Drive, Notion, Linear, Stripe, etc.), and custom servers.
2. **Bot Store** (`/[org]/bot-store`): Where ready-made bots live. Users browse specialized bot personas (Coder, Researcher, Code Reviewer, Designer, Writer, Data Analyst, Ops, General Assistant), inspect their capabilities and recommended models, and add them directly to their workspace and rooms.

The legacy `/[org]/marketplace` route automatically redirects to `/[org]/connectors` (or `/[org]/bot-store` when `tab=agents`), preserving all query params (e.g. `connected`, `tools`, `signin_error`).

Source files:
- Connectors: `apps/web/src/app/(workspace)/[org]/connectors/page.tsx`, `apps/web/src/components/connectors/connectors-view.tsx`
- Bot Store: `apps/web/src/app/(workspace)/[org]/bot-store/page.tsx`, `apps/web/src/components/bot-store/bot-store-view.tsx`, `apps/web/src/lib/curated-bot-templates.ts`
- Shared Catalog: `apps/web/src/lib/marketplace.ts`, `apps/web/src/lib/marketplace-catalog.ts`, `apps/web/src/lib/actions/marketplace.ts`

---

## 🖥️ Server Page (`(workspace)/[org]/marketplace/page.tsx`)

`MarketplacePage` is an async server component:

1. Awaits `params` (`org` slug) and `searchParams` (`tab`, `connected`, `tools`, `signin_error`).
2. `requireOrgAccess(orgSlug)` resolves `{ user, org, role }` and redirects if not a member.
3. Runs two parallel admin-client queries (`page.tsx:19-30`):
   - `mcp_servers` for the org, newest first, selecting `id, name, url, enabled, room_id, catalog_app, auth_kind, auth_status`.
   - `agent_templates` where `org_id IS NULL` (global) or `org_id = <org>`, oldest first, selecting `id, slug, name, description, category`.
4. Maps servers to a safe `ServerSummary` shape: only `host` (from `safeHost(url)`) is exposed — the comment at `page.tsx:42` explains why: *"Never send a saved URL to the browser: some carry the key (Exa, Firecrawl, Zapier)."* `signIn` is derived as `"ok" | "pending" | "signed_out"` from `auth_status` only when `auth_kind === "oauth"`, else `null`.
5. Renders `<MarketplaceView>` with `canManage` (`role === "owner" || "admin"`), `initialTab` (`tab === "agents" ? "agents" : "apps"`), and a `notice` built from the query params: `signin_error` becomes a danger toast (truncated to 300 chars); `connected` becomes a success toast (`"<name> connected"` plus `" with N tools"` when `tools` is numeric).

## 🧩 Marketplace View (`components/marketplace/marketplace-view.tsx`)

`MarketplaceView` is the client component. Props: `orgSlug`, `canManage`, `servers: ServerSummary[]`, `templates: TemplateSummary[]`, `initialTab: "apps" | "agents"`, and optional `notice`.

### Behaviour

- **Notice toast once** (`marketplace-view.tsx:390-396`): on mount, if `notice` exists and hasn't been shown (a `shownNotice` ref guard), `showToast(...)` fires with 8s duration and `router.replace('/<org>/marketplace', { scroll: false })` strips `?connected=` / `?signin_error=` so a reload doesn't repeat it.
- **Tabs**: an ARIA tablist toggles local state `apps` / `agents`. The header copy and search placeholder change with the tab.
- **Search + category filters**: `query` filters apps by name/tagline and templates by name/description; the category chip row (`All N` plus `APP_CATEGORIES`) filters apps. When neither filter is active, apps are sorted by `FEATURED_APP_IDS` rank first, then alphabetically (`marketplace-view.tsx:399-413`).
- **Connected-state matching** (`marketplace-view.tsx:415-423`): `connectedFor(app)` finds a saved server either by `catalogApp === app.id` or, for servers saved without a catalog id, by host via `appForHost(server.host)`. Servers whose `catalogApp` or host maps to a known app are "catalog"; the rest are listed under **Your custom connections** (only shown when not searching), each linking to `/[org]/settings/tools` to manage.
- **App rows** (`AppRow`): tile + name + tagline, with badges — `No sign-up` for `auth.kind === "none"`, `Signed out` when `signIn === "signed_out"`. Three states:
  - Not connected → a **Connect** / **Sign in** button (disabled for non-managers with the tooltip "Only workspace admins can connect apps").
  - Connected and healthy → a green "Connected" check plus a hover-revealed **Remove**.
  - Connected but `signed_out` or `pending` → **Sign in again** / **Finish sign-in** buttons (calls `beginSignIn` with the existing `serverId`) plus Remove.
- **Agents tab**: lists templates (excluding `slug === "blank"`) with a `<Mascot seed={slug}>` tile and an **Add** button linking to `/[org]/agents/new?template=<slug>`. Below the list, a card explains that external agents (Hermes, Claude Code, Codex, Cursor…) can join a room via the room's **Add agent** flow, linking back to `/[org]`.

### ConnectDialog

`ConnectDialog` is a modal (bottom sheet on mobile, centered ≥ `sm`) for one app. Copy and inputs vary by `app.auth.kind`:

| Auth kind | UI | Submit gating |
| :--- | :--- | :--- |
| `none` | "No account needed" explainer | always enabled |
| `oauth` | "You'll go to <name> to sign in…" + note that mutating actions wait for approval in the Inbox | always enabled; button reads "Sign in with <name>" |
| `token` / `url-key` | password input for the secret + `auth.help` hint | token: enabled if `auth.optional` or non-empty; url-key: requires input |
| `personal-url` | URL input with `auth.placeholder` | requires input |

Additional footnotes: secrets are "Stored encrypted. Agents use it through Sayabot and never see it."; `runOn: "desktop"` / `"server"` apps get an explainer about where the local program runs; apps with explicit `dangerousTools` (not the `@writes` wildcard) get a note that those actions wait for approval in the Inbox. A docs link (`app.docs`, new tab) sits next to the submit button.

Submitting calls `beginSignIn` for OAuth or `connectMarketplaceAppAction` otherwise; success shows a toast (warning tone when `result.data.reachable === false`, i.e. saved but the server didn't answer), closes the dialog and `router.refresh()`.

`beginSignIn` (`marketplace-view.tsx:38-53`) calls `startMarketplaceSignInAction`; on success it either `window.location.assign(authorizationUrl)` (vendor sign-in page, which returns via `/api/mcp/oauth/callback`) or, when no redirect is needed, toasts and reloads.

### AppTile

Renders the brand logo in a white rounded tile when `brandLogo(app.id)` exists (`lib/brand-logos.ts`, `components/connectors/brand-logo.tsx`), otherwise a colored square with the app's initial letter on the catalog `color`.

---

## 📚 Catalog (`lib/marketplace.ts`, `lib/marketplace-catalog.ts`)

### Types

- `AppAuth` is a discriminated union: `none` | `token` (`header`, `prefix`, `label`, `help`, `optional?`, `env?` — when `env` is set the key becomes an environment variable for a local program, not an HTTP header) | `url-key` (a `template` with `{key}`) | `personal-url` (validated against `host`) | `oauth`.
- `MarketplaceApp` adds `id`, `name`, `tagline`, `category`, `url`, `transport: "http" | "sse" | "stdio"`, `runOn?: "server" | "desktop"` (for stdio local programs), `color`, `docs`, and `dangerousTools?: string[]` — tool names that require human approval; the special value `"@writes"` means *every tool not named like a read* (`get_`, `list_`, `search_`…), for apps whose tool names vary.

### Composition

`MARKETPLACE_APPS` = `KEY_APPS` (16 hand-written entries in `marketplace.ts:84-287`: GitHub, Semgrep, grep.app, DeepWiki, Context7, Microsoft Learn, AWS Knowledge, Cloudflare Docs, Hugging Face, Exa, Tavily, Firecrawl, Apify, Supabase, Neon, Stripe) + `LOCAL_MARKETPLACE` (mapped from `LOCAL_APPS` in `@sayabot/llm/local-apps`, `url: "stdio://<id>"`) + `CATALOG_APPS` minus any id collisions, all sorted alphabetically (`marketplace.ts:330-334`).

`CATALOG_APPS` (`marketplace-catalog.ts`) is a generated list of ~230 remote MCP servers with vendor URL, transport, auth kind (`oauth` for the vast majority, `none` for a few like Excalidraw and CoinGecko), a Sayabot-written tagline, category and brand color. The header comment says to regenerate rather than hand-edit. Most OAuth entries work via **OAuth 2.1 with dynamic client registration** — nothing has to be registered with the vendor first (see `lib/mcp-oauth.ts`).

Key design point (module docblock): URLs and the final server config are built **server-side** from this list; the browser only ever sends an app id and the person's key.

`FEATURED_APP_IDS` (`marketplace.ts:294-303`) pins the sort order for eight apps: `github, notion, linear, atlassian, stripe, sentry, cloudflare, canva`.

Helpers:

- `findMarketplaceApp(id)` — lookup by id or `null`.
- `hostMatchesApp(host, app)` — exact host or subdomain match (`host.endsWith("." + appHost)`); always `false` for `stdio` apps.
- `appForHost(host)` — the catalog app whose host is the **longest** match (so `docs.mcp.cloudflare.com` resolves to Cloudflare Docs, not Cloudflare).

`APP_CATEGORIES` groups apps into ten chips: Work & productivity, Docs & knowledge, Developer tools, Search & research, Data & analytics, Sales & marketing, Money & finance, Design & media, Automation, More apps.

---

## 🔐 Server Actions (`lib/actions/marketplace.ts`)

All three actions gate on `adminOrgAccess(orgSlug)` (owner/admin required, see `lib/actions/shared.ts`), use the Supabase admin client, and write an audit entry.

### `connectMarketplaceAppAction({ orgSlug, appId, secret?, personalUrl? })`

The browser sends only the id and the secret; URL, transport, and headers come from the catalog (`actions/marketplace.ts:12-16`). Per auth kind:

- `stdio` + token-with-`env`: the secret is validated into an env name (`/^[A-Z][A-Z0-9_]{0,40}$/`) and sealed as `sealSecret(JSON.stringify({ env: { [ENV]: secret } }), getKek())`.
- `oauth` is rejected — use the sign-in action instead.
- `none`: no headers.
- `token`: header becomes `<prefix><secret>` (e.g. `Authorization: Bearer …`); optional when `auth.optional`.
- `url-key`: the secret is rejected if it contains whitespace/`/?#&`, then substituted into `auth.template.replace("{key}", encodeURIComponent(secret))`.
- `personal-url`: parsed, must be `https:` and on `auth.host` or a subdomain of it.

The row is inserted into `mcp_servers` with `room_id: null`, sealed `headers_enc` (either `{ headers }` or `{ env }` envelope), `dangerous_tools: app.dangerousTools ?? []`, `enabled: true`, `created_by`, `catalog_app: app.id`, and audited as `mcp_server.created`.

For `stdio` apps it returns immediately ("saved", with a `runOn` explainer). For remote apps it immediately **tests the connection** with `listMcpTools(orgSlug, serverId)` (`actions/marketplace.ts:112`): a failure returns success with `reachable: false` and a "Saved, but <name> didn't answer yet" message so a wrong key surfaces here rather than later in a room; success reports the tool count.

### `disconnectMarketplaceServerAction({ orgSlug, serverId })`

Loads the server, verifies it belongs to the org, deletes the row, audits `mcp_server.deleted`, revalidates, and returns `"<name> disconnected"`.

### `startMarketplaceSignInAction({ orgSlug, appId, serverId? })`

Starts OAuth sign-in for catalog apps with `auth.kind === "oauth"`:

- With `serverId`: re-signs an existing connection in (expired/revoked tokens); the row must be in this org and `auth_kind === "oauth"`, then is set back to `auth_status: "pending"`.
- Without: reuses an abandoned `pending` row for the same `catalog_app` instead of duplicating (`actions/marketplace.ts:182-190`), otherwise inserts a fresh `pending` row whose `dangerous_tools` defaults to the app's list or `["@writes"]` (reads-only default — `signInDangerousTools` at `actions/marketplace.ts:149-151`).

It then calls `beginMcpOAuth({ serverId, serverUrl, redirectUrl: mcpOAuthRedirectUrl(), persist: persistMcpOAuth(row.id), previous: readMcpOAuth(row) })` from `@sayabot/llm` / `lib/mcp-oauth.ts`. If no `authorizationUrl` comes back (already authorized), the row flips to `auth_status: "ok"` and the action returns "connected"; otherwise the browser is sent to the vendor and completes at `/api/mcp/oauth/callback`.

---

## 🔗 How it fits together

1. Admin picks an app → `ConnectDialog` → server action inserts/seals a `mcp_servers` row → live tool listing validates it.
2. OAuth apps persist flow state in `oauth_enc` (via `lib/mcp-oauth.ts`) and track `auth_kind`/`auth_status`; the marketplace row shows `Signed out` / `Finish sign-in` badges from those fields.
3. Agents consume these servers through the orchestrator's MCP gateway; tools listed in `dangerous_tools` (or `@writes`) halt for human approval in the Inbox per the approval gate.
4. The custom-MCP counterpart lives at `/[org]/settings/tools` (see [Settings UI](./settings-ui.md)); the marketplace links there for custom servers and non-managers see rows read-only.

## Related docs

- [Settings UI](./settings-ui.md) — the tools/MCP settings page this screen links to
- [Agents UI](./agents-ui.md) — where the Agents tab's templates deep-link (`agents/new?template=`)
- [Tasks / Inbox / Meetings UI](./tasks-inbox-meetings-ui.md) — where tool approvals wait for a human OK
- [App overview](./app-overview.md) — workspace layout and shell around this page
- [Auth flows](./auth-flows.md) — how `requireOrgAccess` / roles resolve
- ../../architecture/system-overview.md — MCP gateway and orchestrator side
- ../../../mcp-and-connectors.md — MCP concepts and connector tiers
- ../../../tools-and-sandboxes.md — approval gates (`dangerous: true`) for tool execution
