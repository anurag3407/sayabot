# Settings UI

Workspace settings live under `/(workspace)/[org]/settings/*`. One shared layout renders a grouped nav plus the page body; the nav's single source of truth is `lib/settings-nav.ts`, which also drives the overview page's cards. Personal pages (profile, phones, computers, storage) are open to every member; the rest gate themselves with `requireOrgAdmin` (non-admins are redirected to `/settings`), and the nav simply hides what the viewer cannot open.

Source files: `apps/web/src/lib/settings-nav.ts`, `apps/web/src/components/settings/*`, `apps/web/src/app/(workspace)/[org]/settings/layout.tsx` + all 14 sub-pages, plus `apps/web/src/components/phones/*`, `apps/web/src/components/storage/storage-view.tsx`, `apps/web/src/ee/billing/billing-view.tsx`

---

## 🧭 Navigation (`lib/settings-nav.ts`, `settings-nav.tsx`, `layout.tsx`)

`SETTINGS_GROUPS` defines 13 destinations in three groups. Each entry carries `segment`, `label`, `description`, `icon`, `adminOnly`, and optional `cloudOnly`:

| Group          | Segment      | Label             | Access                |
| :------------- | :----------- | :---------------- | :-------------------- |
| Account        | `profile`    | Profile & alerts  | everyone              |
| Account        | `phones`     | Phones            | everyone              |
| Account        | `keys`       | AI providers      | admin                 |
| Account        | `computers`  | Computers         | everyone              |
| Workspace      | `workspace`  | General & members | admin                 |
| Workspace      | `storage`    | Storage           | everyone              |
| Workspace      | `billing`    | Plan & billing    | admin, **cloud only** |
| Workspace      | `pricing`    | Pricing & budgets | admin                 |
| Agents & tools | `tools`      | Tools & MCP       | admin                 |
| Agents & tools | `search`     | Search providers  | admin                 |
| Agents & tools | `connectors` | Connectors        | admin                 |
| Agents & tools | `bots`       | External agents   | admin                 |
| Agents & tools | `vault`      | Secret vault      | admin                 |
| Agents & tools | `vector`     | Memory & RAG      | admin                 |

`visibleSettingsGroups(isAdmin)` filters by role and by `publicEdition() === "cloud"`. `SettingsNav` renders a sticky vertical sidebar on desktop (`SETTINGS_ICONS` per link, active state from `usePathname`) and a horizontally scrolling chip row on phones. The layout requires org access, shows "org name · role" and gives the body a `max-w-3xl` column.

**Loading and saving.** `settings/loading.tsx` renders a skeleton inside the settings layout, so a nav click shows the next page's shell at once (and Next prefetches it) instead of freezing on the previous page while the server renders. Settings client components do not call `router.refresh()` after an action: the actions revalidate (`revalidateOrg` or a settings path), and that response already carries the fresh page, so a refresh rendered everything twice. The remaining refreshes pick up changes made outside an action: a phone finishing pairing, closing the AI accounts modal, and Storage's "measure again". The layout's access check and the shared lists (`listOrgAgents`, `listUserOrgs`) are memoised per request with React `cache()`.

The **overview page** (`settings/page.tsx`) reuses the same list as link cards with live status text (e.g. `keys: "2 keys"`, `tools: "3 MCP servers on"`, `vector: "Active"`) computed by `adminSummary()` (provider keys, members, LLM vs external agents, enabled MCP servers, vault secret count, vector provider kinds). Admins additionally get a setup checklist (Connect a model provider → Create your first agent → Invite your team → Give agents tools (optional) → Turn on long-term memory (optional)) with a progress bar and highlighted next step; non-admins get a "your settings" note.

---

## 👤 Profile & Alerts (`profile`)

`ProfileForm` (`profile-form.tsx`) posts to `updateProfileAction` (`src/lib/actions/profile.ts`): display name, avatar (upload/replace/remove via `readAvatarFile` client-side processing), notification mode (`all` / `mentions` / `off` radio) and sound toggle. The bot sidebar writes the same notification mode through `setAlertModeAction`, and the sound flag through `setAlertSoundAction`, without touching the name or photo. The page explains that renaming changes your @handle but not past messages; a "Browser alerts" section hosts `EnableAlerts` (push permission button); "Your workspaces" lists memberships with roles plus a New-workspace button; "Sign-in & security" offers Change password (`/forgot-password`) and a `signOutAction` form.

## 📱 Phones (`phones`)

`phones/page.tsx` reads paired `device_pairings` rows for the user (`status: "paired"`, newest first); `PhonesList` renders device name/platform/paired/last-seen with unpair actions. `AddPhoneDialog` (`add-phone-dialog.tsx`) is a step wizard (`ask → get-app → code → done/expired`): it calls `createPhonePairingAction` (`src/lib/actions/phones.ts`) returning `{ pairingId, code, deepLink, server, reach, expiresAt }`, renders a QR code (`qrcode`) of the deep link + one-time code with a per-second countdown (`useCountdown`), polls `phonePairingStatusAction` every few seconds until `paired` (capturing the reported device name) or `expired`, and links the Android APK from GitHub releases (`ANDROID_APK` constant). Under the code it shows the server to use if the app asks (selectable). When that server is a `*.trycloudflare.com` quick tunnel, the dialog says scanning connects the phone to Sayabot on this computer and that the phone does not need to be on the same Wi-Fi. A `same-wifi` address, if one is ever returned, says the phone must share the Wi-Fi. State resets 200 ms after close.

## 💻 Computers (`computers`)

The page loads `listComputers(userId, orgId, role)` (`src/lib/computers.ts`) plus `loadComputerProviders(orgId)` and renders `ComputersView` (`src/components/computers/computers-view.tsx`): the shared `ComputerProviders` block (Boat, E2B, VPS; editable by admins) and then the person's Macs (see [computers-remote-ui.md](./computers-remote-ui.md); remote viewing lives in `remote-viewer.tsx`).

## 🗄️ Storage (`storage`)

Calls the `storage_summary` Postgres RPC and renders `StorageView` (`storage-view.tsx`): a stacked bar of five categories — Chat history (`#5b9df5`), Files & canvases (`#4fcdb0`), Agent memory (`#b79cf0`), Tool activity (`#f2c14e`), Agent computers (`#ff7a70`) — each with bytes, count and unit; then tables by agent (bytes + messages + memories, sorted heaviest first) and by chat (only rooms with bytes > 0), plus per-Mac storage reported by the desktop heartbeat (`desktop_hosts.storage`: `measuredAt`, `appData.bytes`, per-agent `{ handle, bytes, files }` rows). Percentage labels use a `<0.1%` floor. Unavailable summaries degrade to an "unavailable" note.

## 💳 Plan & Billing (`billing`, cloud only)

404s on self-hosted (`edition() !== "cloud"`). Reads `workspacePlan` + `workspaceUsage` and renders `BillingView` (`src/ee/billing/billing-view.tsx`) with usage rows (Server replies this month, Agents, People, Agent computers) against `PLANS[plan].limits`. Handles `?upgraded=<plan>` / `?canceled=1` banners and `past_due` warnings ("The last payment didn't go through…"). The plan description differentiates Free ("Server replies reset on <next month start>. Agents that run on your Mac are unlimited on every plan."), cancel-at-period-end ("ends on <date>; after that the workspace moves to Free.") and renewing plans. Plan cards list every highlight with a check and a **Coming soon** label, and a warning says Sayabot Cloud is coming soon while agents on your Mac and a server you host work today. Other plans show a disabled "Coming soon" button and do not open checkout. "Manage billing" stays available for a workspace that is already paying. The Stripe checkout/portal actions live in `src/ee/billing/`.

## 💲 Pricing & Budgets (`pricing`)

Lists `listPricing()` rows; each `PricingRow` (`pricing-row.tsx`) is an inline form (input/output USD per million tokens) posting `upsertModelPricing` (`src/lib/actions/pricing.ts`). An "Add or update a model" form upserts by provider+model. Prices are deployment-wide and drive budget enforcement ("A model with no row costs $0 and can still run").

## 🤖 AI Providers (`keys`)

Renders `ProvidersView` (`src/components/providers/providers-view.tsx`; model details in the [model system](./model-system.md)). The page loads provider keys, agents (for per-key bot counts), and rooms. The view is one scrolling page with a row of anchor chips and four sections, each a `ProviderSection` of `ProviderCard` rows (`provider-card.tsx`: icon, title, subtitle, status pill, controls, footnote):

| Section (anchor)                          | Contents                                                                                                                                                                                                                                                                                                                                                                                                                   |
| :---------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Providers (`#providers`)                  | Agent apps signed in on this computer (`LocalAgents`, from `/api/providers/local`), a **Check again** button that re-runs the lookup, "More providers" install hints, and "Sign in with a plan you pay for" → `ManageAccountsModal` (ChatGPT, Copilot, OpenRouter).                                                                                                                                                        |
| AI providers (`#ai-providers`)            | One `ApiKeyRow` per `ACCOUNT_PROVIDERS` entry of kind `key` or `openrouter` (OpenRouter, Anthropic, OpenAI, Gemini, DeepSeek, xAI Grok, Kimi, Qwen, MiniMax, Groq, Cerebras…), ready ones first: "Paste your key", "Get a key ↗", **Save** → `saveProviderKey` with an automatic label (`My <name>`, then `<name> 2`…). Saved keys list above the field with `TestKeyButton` / `DeleteKeyButton`.                          |
| Your own model servers (`#model-servers`) | The `custom` providers (Cloudflare, OpenAI-compatible servers such as LM Studio, Ollama, vLLM): an address field plus an optional key.                                                                                                                                                                                                                                                                                     |
| Apps and tools (`#apps`)                  | Links to Connected apps, Tools and MCP servers, and Your own bots.                                                                                                                                                                                                                                                                                                                                                         |

`TestKeyButton` optionally takes a model id for `openai-compatible` providers; the test calls `testProviderKey` which makes a real provider call.

**Computer provider actions** (`src/lib/actions/computer-providers.ts`):

- `saveComputerProviderAction({ orgSlug, provider: "boat" | "e2b" | "vps", token?, clear?, address?, alias?, privateKey?, clearKey?, startAutomatically? })` — admin only; builds the row with `computerProviderUpdate` ([computers-remote-ui.md](./computers-remote-ui.md#-sealed-provider-keys-libcomputer-settingsts)), upserts `org_computer_settings` on `org_id`, then clears stale readiness on the workspace's bots (`vpsReady` after a VPS change; `e2bId`/`e2bReady` after an E2B change) so the next `select_computer` opens a fresh container or sandbox. Audit `computers.provider_changed` with the provider, whether a key was given and the VPS host — never a key. Revalidates `/settings/keys` and `/settings/computers`.
- `checkComputerProviderAction({ orgSlug, provider })` — VPS: `POST /internal/computers/vps/check` on the orchestrator (runs `docker version` over SSH from the machine that will run the bots); E2B: `GET https://api.e2b.dev/v2/sandboxes?limit=1` with the saved (or server) key, 401/403 → "E2B refused this key"; Boat keys are checked on first use.
- `getComputerProvidersAction(orgSlug)` — any member; the secret-free `ComputerProvidersView` (`boat`/`e2b`: `last4`, `included`; `vps`: `address`, `alias`, `hasKey`, `startAutomatically`) used by the Works on picker.

## 🧰 Tools & MCP (`tools`, admin)

The largest page. Sections:

- **MCP servers** — lists `listMcpServers()` with transport/URL/scope (workspace-wide or room)/enabled/dangerous-tools lines. Each row has "inspect tools" (`McpInspector`) and "edit" (an `ActionForm` over `updateMcpServer`: url, enabled, comma-separated dangerous tools, and replacement headers JSON — "Header values are sealed before insert and never shown again").
- **Add an MCP server** — `addMcpServer`: name (tool namespace), transport `http|sse`, URL, optional room scope, dangerous tools, headers JSON.
- **`McpInspector`** (`mcp-inspector.tsx`) — "list tools" calls `listMcpTools`, then pick a tool, edit JSON args, "invoke" via `invokeMcpTool`, with a copyable result block — a live harness against the server. Both actions share `lib/mcp-client.ts`; `stdio` rows answer "This program runs when an agent uses it." because a local program only runs inside an agent turn.
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

`ConnectorAddForm` (`connector-add-form.tsx`) adds a new connector through `saveWorkspaceConnector` (`src/lib/actions/connectors.ts`): per-source token labels/placeholders and setup help (Slack scopes, GitHub PAT scopes, Discord Message Content Intent, WhatsApp Cloud API phone-number ID), plus conditional fields — Google Drive domain/root folder, Slack default channel, Discord guild ID, GitHub default org, WhatsApp phone number ID, 1Password Connect URL, Bitwarden region, and "Use the app signed in on a computer, instead of an API" for the password-manager sources. `composio` asks only for the API key, with optional API base URL and workspace user id (the help text warns that changing the user id disconnects the apps connected under the old one). Its grant form adds "Apps this agent may use" (`allowedApps`), the per-agent app allow-list.

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

## 🔎 Search Providers (`search`, admin)

A dedicated search engine configuration page (`apps/web/src/app/(workspace)/[org]/settings/search/page.tsx` rendering `WebSearchConfig`):

- **12 Search Providers**: DuckDuckGo (zero-config, keyless), TinyFish, Context.dev, Tavily, Brave Search (2,000 free queries/mo), SearXNG, Whoogle Search (local Docker proxy via `benbusby/whoogle-search`), Serper (Google), Exa, Firecrawl, Perplexity Sonar, and Microsoft Bing.
- **Credit & Quota Checker**: "Check Available Credits" button calling `fetchSearchProviderCreditsAction` to query real balances from Serper, Firecrawl, Brave rate-limits, Context.dev, etc., or verify reachability of local Whoogle and SearXNG instances.
- **Live Search Tester**: Test queries with latency measurement, synthesized answers, and formatted result cards.
- **Per-Agent Search Selector**: In the room chat agent sidebar (`agent-config-panel.tsx`), users can pick an agent's preferred search provider or inherit workspace default.

## 🧠 Memory & RAG (`vector`, admin)

A short status page. Memory already uses the workspace database and keyword matching; this screen adds an optional vector store and an optional embedding model. A three-cell strip states how each provider authenticates:

- **No credential** — built-in Postgres and on-device embeddings (`pglite`, `fastembed_local`).
- **API key** — Pinecone, Qdrant, Cloudflare, Gemini, Voyage, OpenAI, Cohere. Gemini’s embedding API and OpenAI’s embeddings API refuse Google / ChatGPT sign-in tokens.
- **OAuth** — Neon only (`oauth2.neon.tech`). Neon’s authorization-code flow returns a connection string. This screen does not start that flow (no Neon OAuth client is registered); the admin pastes the URL Neon shows after approval. Pinecone’s OAuth is admin-API only and cannot read or write vectors. Qdrant console SSO does not authorize the database API.

Two lanes, **Storage** and **Embeddings**, each show the active provider (or the built-in fallback), saved rows from `listVectorProviders`, and a `VectorAddForm`. Rows keep `SetActiveVectorButton` / `TestVectorButton` / `DeleteVectorButton` (`vector-actions.tsx` → `setActiveVectorProvider` / `testVectorProvider` / `deleteVectorProvider`).

**`VectorAddForm`** (`vector-add-form.tsx`) takes a fixed `kind`. The admin picks one provider card; the form then renders only that provider’s fields (API key, database URL, endpoint, index). Label, dimension, and “make active” are submitted as hidden values (`vectorProviderName` supplies the display name). Local providers submit no secret. Saved through `saveVectorProvider`.

## 👥 General & Members (`workspace`, admin)

- **Workspace** — rename via `renameWorkspaceAction` (`src/lib/actions/orgs.ts`).
- **Members** — list with role; per-member `MemberRoleForm` (`src/components/admin/member-role-form.tsx`) and `RemoveMemberButton` (self excluded); `allowOwner` only for the owner role.
- **`InvitePeopleCard`** (`invite-people-card.tsx`) — two tabs, **Invite link** (single-use, 24 hours) and **Perma link**, both via `createInviteLinkAction` / `revokeInviteAction`. Role select is member or admin. Optional room checkboxes are copied onto the link and applied when an admin approves. There is no email field. **Waiting for approval** lists `loadJoinRequests` with Approve / Decline (`decideJoinRequestAction`). **Shared links** lists `loadPendingInvites` with copy and revoke, including any older email invites that were never used.
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
