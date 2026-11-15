# Settings UI

Workspace settings live under `/(workspace)/[org]/settings/*`. One shared layout renders a grouped nav plus the page body; the nav's single source of truth is `lib/settings-nav.ts`, which also drives the overview page's cards. Personal pages (profile, phones, computers, storage) are open to every member; the rest gate themselves with `requireOrgAdmin` (non-admins are redirected to `/settings`), and the nav simply hides what the viewer cannot open.

Source files: `apps/web/src/lib/settings-nav.ts`, `apps/web/src/components/settings/*`, `apps/web/src/app/(workspace)/[org]/settings/layout.tsx` + all 14 sub-pages, plus `apps/web/src/components/phones/*`, `apps/web/src/components/storage/storage-view.tsx`, `apps/web/src/ee/billing/billing-view.tsx`

---

## 🧭 Navigation (`lib/settings-nav.ts`, `settings-nav.tsx`, `layout.tsx`)

`SETTINGS_GROUPS` defines 13 destinations in three groups. Each entry carries `segment`, `label`, `description`, `icon`, `adminOnly`, and optional `cloudOnly`:

| Group | Segment | Label | Access |
| :--- | :--- | :--- | :--- |
| Account | `profile` | Profile & alerts | everyone |
| Account | `phones` | Phones | everyone |
| Account | `computers` | Computers | everyone |
| Workspace | `workspace` | General & members | admin |
| Workspace | `keys` | AI providers | admin |
| Workspace | `storage` | Storage | everyone |
| Workspace | `billing` | Plan & billing | admin, **cloud only** |
| Workspace | `pricing` | Pricing & budgets | admin |
| Agents & tools | `tools` | Tools & MCP | admin |
| Agents & tools | `connectors` | Connectors | admin |
| Agents & tools | `bots` | External agents | admin |
| Agents & tools | `vault` | Secret vault | admin |
| Agents & tools | `vector` | Memory & RAG | admin |

`visibleSettingsGroups(isAdmin)` filters by role and by `publicEdition() === "cloud"`. `SettingsNav` renders a sticky vertical sidebar on desktop (`SETTINGS_ICONS` per link, active state from `usePathname`) and a horizontally scrolling chip row on phones. The layout requires org access, shows "org name · role" and gives the body a `max-w-3xl` column.

The **overview page** (`settings/page.tsx`) reuses the same list as link cards with live status text (e.g. `keys: "2 keys"`, `tools: "3 MCP servers on"`, `vector: "Active"`) computed by `adminSummary()` (provider keys, members, LLM vs external agents, enabled MCP servers, vault secret count, vector provider kinds). Admins additionally get a setup checklist (Connect a model provider → Create your first agent → Invite your team → Give agents tools (optional) → Turn on long-term memory (optional)) with a progress bar and highlighted next step; non-admins get a "your settings" note.

---

## 👤 Profile & Alerts (`profile`)

`ProfileForm` (`profile-form.tsx`) posts to `updateProfileAction` (`src/lib/actions/profile.ts`): display name, avatar (upload/replace/remove via `readAvatarFile` client-side processing), notification mode (`all` / `mentions` / `off` radio) and sound toggle. The page explains that renaming changes your @handle but not past messages; a "Browser alerts" section hosts `EnableAlerts` (push permission button); "Your workspaces" lists memberships with roles plus a New-workspace button; "Sign-in & security" offers Change password (`/forgot-password`) and a `signOutAction` form.

## 📱 Phones (`phones`)

`phones/page.tsx` reads paired `device_pairings` rows for the user (`status: "paired"`, newest first); `PhonesList` renders device name/platform/paired/last-seen with unpair actions. `AddPhoneDialog` (`add-phone-dialog.tsx`) is a step wizard (`ask → get-app → code → done/expired`): it calls `createPhonePairingAction` (`src/lib/actions/phones.ts`) returning `{ pairingId, code, deepLink, server, expiresAt }`, renders a QR code (`qrcode`) of the deep link + one-time code with a per-second countdown (`useCountdown`), polls `phonePairingStatusAction` every few seconds until `paired` (capturing the reported device name) or `expired`, and links the Android APK from GitHub releases (`ANDROID_APK` constant). State resets 200 ms after close.

## 💻 Computers (`computers`)

The page loads `listComputers(userId, orgId, role)` (`src/lib/computers.ts`) plus `org_computer_settings` (`boat_last4`, `vps_ssh_alias`, `vps_start_automatically`) and renders `ComputersView` (`src/components/computers/computers-view.tsx`): the person's desktop hosts and Boat/VPS configuration (see the computers view component for details; remote viewing lives in `remote-viewer.tsx`).

## 🗄️ Storage (`storage`)

Calls the `storage_summary` Postgres RPC and renders `StorageView` (`storage-view.tsx`): a stacked bar of five categories — Chat history (`#5b9df5`), Files & canvases (`#4fcdb0`), Agent memory (`#b79cf0`), Tool activity (`#f2c14e`), Agent computers (`#ff7a70`) — each with bytes, count and unit; then tables by agent (bytes + messages + memories, sorted heaviest first) and by chat (only rooms with bytes > 0), plus per-Mac storage reported by the desktop heartbeat (`desktop_hosts.storage`: `measuredAt`, `appData.bytes`, per-agent `{ handle, bytes, files }` rows). Percentage labels use a `<0.1%` floor. Unavailable summaries degrade to an "unavailable" note.

## 💳 Plan & Billing (`billing`, cloud only)

404s on self-hosted (`edition() !== "cloud"`). Reads `workspacePlan` + `workspaceUsage` and renders `BillingView` (`src/ee/billing/billing-view.tsx`) with usage rows (Server replies this month, Agents, People, Agent computers) against `PLANS[plan].limits`. Handles `?upgraded=<plan>` / `?canceled=1` banners and `past_due` warnings ("The last payment didn't go through…"). The plan description differentiates Free ("Server replies reset on <next month start>. Agents that run on your Mac are unlimited on every plan."), cancel-at-period-end ("ends on <date>; after that the workspace moves to Free.") and renewing plans. The Stripe checkout/portal actions live in `src/ee/billing/`.

## 💲 Pricing & Budgets (`pricing`)

Lists `listPricing()` rows; each `PricingRow` (`pricing-row.tsx`) is an inline form (input/output USD per million tokens) posting `upsertModelPricing` (`src/lib/actions/pricing.ts`). An "Add or update a model" form upserts by provider+model. Prices are deployment-wide and drive budget enforcement ("A model with no row costs $0 and can still run").

## 🤖 AI Providers (`keys`)

Renders `ProvidersView` — documented fully in the [model system](./model-system.md): local agent detection, plan sign-ins via the Manage Accounts modal, connected key rows with `TestKeyButton` / `DeleteKeyButton` (`key-actions.tsx`), and per-provider `saveProviderKey` forms. `TestKeyButton` optionally takes a model id for `openai-compatible` providers; the test calls `testProviderKey` which makes a real provider call.

## 🧰 Tools & MCP (`tools`, admin)

The largest page. Sections:

- **MCP servers** — lists `listMcpServers()` with transport/URL/scope (workspace-wide or room)/enabled/dangerous-tools lines. Each row has "inspect tools" (`McpInspector`) and "edit" (an `ActionForm` over `updateMcpServer`: url, enabled, comma-separated dangerous tools, and replacement headers JSON — "Header values are sealed before insert and never shown again").
- **Add an MCP server** — `addMcpServer`: name (tool namespace), transport `http|sse`, URL, optional room scope, dangerous tools, headers JSON.
- **`McpInspector`** (`mcp-inspector.tsx`) — "list tools" calls `listMcpTools`, then pick a tool, edit JSON args, "invoke" via `invokeMcpTool`, with a copyable result block — a live harness against the server.
- **Built-in tools** config cards:
  - `web_search` → `WebSearchConfig` (`web-search-config.tsx`): a catalog of providers (DuckDuckGo, TinyFish, Tavily, Brave, SearXNG, Serper, Exa, Firecrawl, Perplexity, Bing…) tagged Free/Keyless vs API, with key/URL fields as required, saved through `saveOrgToolConfig` (`tool: "web_search"`), plus `testWebSearchAction`.
  - `document_extract` → `DocumentOcrConfig` (`document-ocr-config.tsx`): OCR engines (IBM Docling, Marker, Tesseract, Multimodal Vision, Mistral OCR, AWS Textract) with hardware notes, docker snippets, key/URL fields, `testDocumentOcrAction`.
  - `browser_automation & cdp` → `BrowserCdpConfig` (`browser-cdp-config.tsx`): read-mostly documentation card with tabs (`overview | tools | vault`) describing `browser_exec`, `browser_cdp`, `browser_dialog`, and `browser_vault` (zero-token-leakage credential auto-fill).
  - `terminal_sandboxes` → `TerminalSandboxConfig` (`terminal-sandbox-config.tsx`): sandbox backend options (Local, Docker, Modal, Daytona, Remote SSH, Serverless MicroVM) with isolation/hardware/cost specs, saved via `saveOrgToolConfig`.
  - `web_fetch` — static "built-in" card (keyless HTML→Markdown extractor).
  - `github_bridge` / `postgres_inspector` — `saveOrgToolConfig` forms for a sealed GitHub PAT / read-only connection string plus enabled state ("The inspector rejects anything that is not a single SELECT or WITH statement").

## 🔗 Connectors (`connectors`, admin)

Tier-1 of the two-tier connector model. The page explains the architecture in a banner ("Tier 1 (Workspace Level) … Tier 2 (Agent Scoping)") and links to the Marketplace for the 200+ other apps. `SOURCE_INFO` covers google_drive, slack, github, discord, telegram, whatsapp, onepassword, bitwarden, protonpass with emoji/description/status colors; rows show brand logo (`BrandLogo`/`brandLogo`), Active/Error chip, key last4, last verification, and error message. Per row:

- `TestConnectorButton` / `DeleteConnectorButton` (`connector-actions.tsx`) → `testWorkspaceConnector` / `deleteWorkspaceConnector` (confirm dialog: "Agents using this connector will lose access.").
- For messaging sources (telegram/discord/whatsapp) with rooms+agents available, `ConnectorChatForm` (`connector-chat-form.tsx`) configures **inbound chat**: enable "Answer messages", target room + agent, and an allowed-chat-id allowlist — "A message sent to this bot starts a turn in the room, as if someone typed @the agent" — saved via `saveConnectorChat`.

`ConnectorAddForm` (`connector-add-form.tsx`) adds a new connector through `saveWorkspaceConnector` (`src/lib/actions/connectors.ts`): per-source token labels/placeholders and setup help (Slack scopes, GitHub PAT scopes, Discord Message Content Intent, WhatsApp Cloud API phone-number ID), plus conditional fields — Google Drive domain/root folder, Slack default channel, Discord guild ID, GitHub default org, WhatsApp phone number ID, 1Password Connect URL, Bitwarden region, and "Use the app signed in on a computer, instead of an API" for the password-manager sources.

## 🧩 External Agents (`bots`, admin)

The Tier-1 surface for `kind: "external"` agents:

- Lists each external agent with its webhook URL or "connects over MCP", created time, an expandable `McpConnect` card, webhook-secret rotation (`RotateWebhookSecret` from `bot-actions.tsx`), and API-key management (`IssueApiKey`, key list with prefix/label/active/revoked/last-used, `RevokeKeyButton`).
- `McpConnect` (`mcp-connect.tsx`) builds per-client setup snippets for Codex, Hermes, Claude Code, Cursor, Antigravity, Claude app, ChatGPT, plus a "★ Copy Invitation Message" — a plain-language invitation (room name, time zone, check-in hours, owner-signed guarantee, "Anything on your own computer… still needs my OK") ending in the short `/mcp/<token>` setup URL (`getSetupUrl`, `mcp-connect.tsx:43`) — and a "Kickoff prompt".
- **Webhook deliveries** table (from `listWebhookDeliveries`): time, agent, attempt, status code, response ms, error — with the note that failed deliveries retry with exponential backoff up to five times and private/loopback targets are blocked.

Actions behind it: `issueAgentApiKey` / `rotateWebhookSecret` / `revokeAgentApiKey` in `src/lib/actions/bots.ts` (see the [agents UI](./agents-ui.md)).

## 🔐 Secret Vault (`vault`, admin)

Four `Section`s over `vault_secrets` and `agent_secret_grants`:

1. **Add Secret** — `saveVaultSecret` (`src/lib/actions/vault.ts`): label, kind (`api_token`, `basic_auth`, `password`, `header_set`, `github_app`), value. "Encrypted immediately with AES-256-GCM. We only store the sealed ciphertext and the last 4 characters."
2. **Vault Secrets** — rows with `••••<last4>`, kind, last-used date, and `deleteVaultSecret`.
3. **Grant Secret to a Bot** — `grantSecret`: target agent + secret + env var name + **allowed hosts** ("Placeholders sent to any other host will be blocked by the Egress proxy") + optional "Require human approval on first use in each turn".
4. **Active Grants** — `$ENV_NAME → @bot (label)` with allowed hosts, truncated placeholder, and `revokeGrant`.

These are the placeholders agents reference (never plaintext), matching the orchestrator's secret broker.

## 🧠 Memory & RAG (`vector`, admin)

An educational banner distinguishes the "thinking brain" (LLMs) from "persistent memory" (vector DB + embedding model) and shows the currently active pair (defaults: built-in PostgreSQL/PGLite storage; hybrid keyword/recency matching). Sections:

- A static "Generous Free-Tier Options" cheat sheet (Pinecone 2 GB, Gemini embeddings 1500 RPM, Qdrant 1 GB, Voyage 200M tokens, Supabase/Neon 500 MB, local PGLite).
- **Vector Databases** and **Embedding Models** lists (`listVectorProviders`, split by `kind`) — each row shows provider display name (`PROVIDER_NAMES`), `•••• last4`, endpoint/index/dimension info, and `SetActiveVectorButton` / `TestVectorButton` / `DeleteVectorButton` (`vector-actions.tsx` → `setActiveVectorProvider` / `testVectorProvider` / `deleteVectorProvider` in `src/lib/actions/vector-keys.ts`).
- **`VectorAddForm`** (`vector-add-form.tsx`) — kind (vector_db | embedding) + provider selects (7 vector DBs, 8 embedding providers, with free-tier labels), key/endpoint/index/dimension fields as the provider requires (local `pglite`/`fastembed_local` need no key), saved through `saveVectorProvider`.

## 👥 General & Members (`workspace`, admin)

- **Workspace** — rename via `renameWorkspaceAction` (`src/lib/actions/orgs.ts`).
- **Members** — list with role; per-member `MemberRoleForm` (`src/components/admin/member-role-form.tsx`) and `RemoveMemberButton` (self excluded); `allowOwner` only for the owner role.
- **`InvitePeopleCard`** (`invite-people-card.tsx`) — three tabs: **email** (`inviteMember`), **link** (single-use) and **permanent**, the latter two via `createInviteLinkAction` / `revokeInviteAction` (`src/lib/actions/workspace-invites.ts`) with role select (member/admin), copyable URL, expiry display ("Never expires" or "Expires <date>"), and the pending-invite list.
- **SAML SSO** — enable/disable via `updateSso`, only when the server has SSO set up (`ssoEnabled()`), otherwise a warning.
- **Audit log** — last 100 entries from `listAuditLogs` as a table (time, action, target, actor type:id-prefix, expandable metadata JSON).

## 🧱 Shared Building Blocks

- **`Section`** (`section.tsx`) — the page rhythm everywhere: title, description, optional right-aligned `actions` slot, children; the first section on a page passes `className="border-t-0 pt-0"`.
- **`ActionForm`** (`src/components/ui/action-form.tsx`) — wraps a server action with submit/pending labels, optional `resetOnSuccess`, and inline result handling; used by rename, SSO, MCP, pricing, vault and connector forms.
- **`SETTINGS_ICONS`** (`settings-icons.ts`) — maps the nav's `SettingsIconKey` to lucide icons for both the sidebar and the overview cards.
- **`TestKeyButton` / `DeleteKeyButton`** (`key-actions.tsx`) — the AI-provider row controls: test accepts an optional model for `openai-compatible` providers and shows ok/danger status inline; delete is a two-step confirm ("Confirm delete" / Cancel) over `deleteProviderKey` with `router.refresh()`.
- **Action sharing** — the same actions serve several surfaces: `saveProviderKey` (ProvidersView + ManageAccountsModal), `saveOrgToolConfig` (web search, OCR, terminal sandbox, GitHub bridge, Postgres inspector), `saveWorkspaceConnector`/`saveConnectorChat` (connectors), `saveVectorProvider`/`setActiveVectorProvider`/`testVectorProvider`/`deleteVectorProvider` (vector), and the vault quartet (`saveVaultSecret`, `deleteVaultSecret`, `grantSecret`, `revokeGrant`).

---

## Related docs

- [Model system](./model-system.md) — the `/settings/keys` view in depth
- [Agents UI](./agents-ui.md) — the agent side of connector grants and external-bot keys
- [Auth flows](./auth-flows.md) — sign-out and password actions reused here
- [App overview](./app-overview.md) — plan usage banner fed by the same `workspaceUsage`
- ../../database/schema-connectors-and-vault.md — `workspace_connectors`, `vault_secrets`, `agent_secret_grants`
- ../../database/schema-computers-devices-desktop.md — `device_pairings`, `desktop_hosts`, `org_computer_settings`
- ../../database/schema-billing.md — plan rows behind the billing page
- Server actions for these screens are catalogued in `docs/reference/web/actions/`.
