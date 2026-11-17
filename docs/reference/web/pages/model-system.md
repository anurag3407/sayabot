# Model System (Pickers, Catalog, Accounts)

Every agent answers through a "provider account" (a saved API key, a subscription app signed in on a computer, a local model server, or the server's own Saya AI models) plus a model id and an optional thinking-effort level. The web app builds that choice space once per request in `lib/model-catalog.ts`, renders it through one shared picker body (`components/agents/model-picker-panel.tsx`) used by both the room title-bar picker and the agent-card picker, and persists choices through checked server actions. Keys are stored encrypted (AES-GCM via the KEK) in `provider_keys` and never returned to the browser.

Source files: `apps/web/src/components/room/model-picker/*`, `apps/web/src/components/agents/agent-model-picker.tsx`, `model-picker-panel.tsx`, `apps/web/src/components/providers/providers-view.tsx`, `apps/web/src/lib/model-catalog.ts`, `model-choice.ts`, `model-options.ts`, `ai-accounts.ts`, `provider-key-store.ts`

---

## 🏗️ Catalog Construction (`lib/model-catalog.ts`)

`buildModelCatalog(orgId, keys, inUse, hosts, serverApps)` is the core: it assembles `PickerGroup[]` — one rail entry per provider account — in six sections:

| Section | `keyId` shape | Content |
| :--- | :--- | :--- |
| `server` | `null` | Saya AI: the server operator's models from `sayaAiPublic()` ("Provided by this server · no key needed"). Agents store the **alias**, never the real id, so `.env` changes follow on the next turn. Model id `""` means Automatic. |
| `subscription` | `cli:<app>` | Claude Code / Codex / Cursor signed in **on the server**. Models from the engine's own catalog (`engineModelCatalog` — Codex asks the CLI, Claude Code/Cursor read the manifest), with `PickerPlan` showing plan name + 5-hour/weekly usage windows (`loadEnginePlanUsage`). |
| `key` | `<providerKeyId>` | Each saved `provider_keys` row. Models come from the provider's **live** `/models` endpoint using the decrypted key (`keySecrets` decrypts only for the request, `model-catalog.ts:263`); fallback to `MODEL_SUGGESTIONS`/models.dev. Detail shows `•••• <last4>`. |
| `mac` | `host:<hostId>:<app>` | Apps signed in on the user's own Macs (from `desktop_hosts.local_agents`, reported by Sayabot for Mac): Claude, Codex, Gemini, OpenCode, Cursor. Model list = what the app reported (`source: "live"`), else engine manifest (`"manifest"`), else static suggestions. |
| `local` | `host:<hostId>:<app>` | Ollama / LM Studio on those Macs — all models marked `free: true`. |
| `computer` | `host:<hostId>` | A Mac with nothing signed in yet ("No signed-in app found on this computer yet"). |

Key behaviours:

- **Timeouts** — every live call is raced with `within(promise, ms, fallback)` (8 s engines, 9 s plan usage, 10 s provider lists) so one slow provider never holds up the page (`model-catalog.ts:219`).
- **Background refresh** — `modelCatalog().refresh()` and `modelManifest().refreshOnDemand()` fire-and-forget: the page uses the on-disk cache now, and the next open sees the update.
- **Listings** — `withListings` (via `modelListings` from `@sayabot/llm/models`, backed by models.dev) stamps subscription/key models with `listing: "new" | "older"`, release dates, prices, context windows and org-block/CLI-update flags, so new models lead and replaced ones fold away.
- **In-use merge** — models already assigned to any agent (`inUse`, computed by `agentModelUse`/`agentRunner`) are always injected into their group's list even if the provider no longer lists them.
- **`loadWorkspaceModels({ access, host, keys?, agents? })`** — the shared entry point used by both the agents page and the title-bar picker API: loads keys, agents and `desktop_hosts` (non-revoked, owned by the user), and detects CLI apps on the server only when the request host is local and the caller is an org admin (`localDetectionAllowed`, `model-catalog.ts:585`).

`agentRunner(agent)` reads `agent.params.runner` (`{ where: "server", app }` or `{ hostId, app, model }`) and returns the synthetic keyId (`cli:*` / `host:*:*`), falling back to `{ keyId: agent.providerKeyId, model: agent.model }`.

### App registries

Three module-level tables map CLI/app ids to picker groups (kept in sync with `model-choice.ts`):

| Registry | Entries | Used for |
| :--- | :--- | :--- |
| `RUNNER_APPS` / `APP_NAME` | `claude-code` → "Claude Code", `codex` → "Codex", `gemini` → "Gemini CLI", `opencode` → "OpenCode", `cursor` → "Cursor" | Detail lines and version badges |
| `MAC_APPS` (`model-catalog.ts:130`) | each app → `{ provider, label, engine?, suggestions? }` — e.g. `claude-code` maps to provider `anthropic` with engine `claude-code`; `gemini` maps to provider `google` with `MODEL_SUGGESTIONS.google` as fallback | Mac subscription groups |
| `LOCAL_MODEL_APPS` | `ollama`, `lmstudio` | Local model groups (models reported live by the Mac heartbeat) |
| `CLI_ENGINES` / `PLAN_ENGINES` | server-side apps with a CLI; plan usage is loaded only for `claude-code` and `codex` | Server subscription groups |

`macAppModels()` (`model-catalog.ts:158`) decides the group's `source`: models **reported by the app itself** (`ReportedModel[]`, with per-model effort lists and `isDefault`) → `"live"`; else the engine manifest via `engineCatalogFromManifest(engine, version)` → `"manifest"`; else static `MODEL_SUGGESTIONS` → `"static"`. A first row `<App> default` (named after the app's current default model when known) always leads. Model lists are deduped through `addModel` (trimmed ids, `Set`-guarded).

Key decryption for live provider lists is contained to one request:

```typescript
// apps/web/src/lib/model-catalog.ts:262
/** Decrypts each key only to read its model list; the key never leaves this function's request. */
async function keySecrets(orgId: string): Promise<Map<string, string>> {
  // ... select from provider_keys, decrypt with providerKeyToApiKey(row, kek)
  // a key sealed with another KEK just gets the models.dev list
}
```

## ✅ Choice Validation (`lib/model-choice.ts`)

`resolveModelChoice({ orgId, userId, requestHost, keyId, model, effort })` turns a pick into what an agent stores. Every path validates server-side:

- **`host:<id>:<app>`** — parses the id, verifies the `desktop_hosts` row belongs to the picker (`host.user_id === userId`, not revoked) — "You can only pick a computer you set up yourself" —, requires a known Mac app or local model app, validates the model id against `MODEL_ID = /^[\w.:/@+[\]~-]{1,160}$/` (ids reach command lines, so only plain ids pass), and requires local servers to pick a concrete model. Returns `runner: { hostId, app, model? }` and `macOwnerUserId: userId` (the Mac runs only its owner's bots).
- **`cli:<app>`** — only `claude-code|codex|cursor`, only when `localDetectionAllowed(requestHost)` (Sayabot running on your own machine). Returns `runner: { where: "server", app, model? }`.
- **Saved key** — verifies the `provider_keys` row belongs to this org; requires a model. Returns `{ providerKeyId, agentModel: model, runner: null }`.
- **Saya AI** (`keyId: null`) — model aliases checked against `sayaAi()` config (`isSayaModel`); `null` model means "follow the server default". Returns `{ providerKeyId: null, agentModel: model|null, runner: null }`.

`effort` must be in `EFFORT_LEVELS`. The resolved `label` (e.g. "Claude Opus 5.5 on Anurag's MacBook") is for confirmation UI.

## 🧭 Shared Picker Body (`components/agents/model-picker-panel.tsx`)

`ModelPickerPanel` is a two-pane dialog body: a 64px **rail** of provider icons grouped by section (Cloud / Server / Mac / API keys / Local / Computers, `SECTION_ORDER`), and a right pane listing the active group's models.

- **Rail icons** — `RailIcon` renders `SayabotMark` for the server group, `Cpu` for local, `Monitor` for computers, otherwise `ProviderIcon`. Dots: green "in use", amber "near its limit" (plan window ≥ 80%). A dashed "+" links to `/settings/keys`.
- **Model rows** — radio, label, context window ("200K"/"1M"), price (`$in / $out` per million tokens, `money()`), Free chip, "Default", "Blocked by org", "Update app" badges. Search filters by id/label; without a query the first 6 are "Suggested" and the rest fold under "Show all N models" (`SUGGESTED = 6`, `model-picker-panel.tsx:53`).
- **Header info** — group label + detail, account line, source badge (`Live models` / `Saved list` / `Sayabot list` / `models.dev list`), app version badge, a refresh button (`onRefresh`), and a warning banner when a Mac group has `runnerEnabled === false` ("Turn on 'Run agents on this computer' in Settings → Computers").
- **PlanPanel** — subscription groups show plan name and up to 4 usage windows with percent bars (ok/warn/danger at 70/90%) and "resets in 3d/5h/20m".
- **Custom model id** — key and subscription groups get an "Other model id…" form (`pick(active.keyId, custom)`), keeping the field free-text so any id works.
- **Effort footer** — a select of the levels the picked model accepts (`effortOptions`: model-specific list overrides the group's; `[]` = Default only). Switching models runs `fitEffort` — an effort the new model doesn't take silently resets to Default instead of failing its first turn (`model-picker-panel.tsx:92`).
- **Mac plan limits** — inside the Mac app, `usePlanLimits()` + `withMacPlans` overlay this computer's Claude/Codex usage onto their groups.
- The panel only reports picks via `onPick(ModelValue)`; **callers save them**.

## 💬 Room Picker (`components/room/model-picker/room-model-picker.tsx`)

`RoomModelPicker` — rendered in the composer's toolbar (`placement="up"` opens the panel above the button; the default `"down"` opens below; `"inline"` opens inside the bot settings sidebar, full width, and does not listen for `MODEL_PICKER_EVENT`) — manages **per-chat** model overrides for each bot in the room:

- Data comes from two endpoints (cached per `org/room` in a module-level `lastLists` map with a timestamp; mounting or reopening within `FRESH_MS = 60_000` reuses the lists without a request, while the refresh button and the Mac rescan reloads always refetch): `GET /api/connectors/models?org=…` (PickerGroups + `canManage`) and `GET /api/connectors/models/room?org=…&room=…` (room bots with their `bot` and `chat` model values + `canEdit`).
- The button label shows the effective model (`bot.chat ?? bot.bot`) with a " · Mac" suffix when the group section is `mac`/`local`, and a small accent dot when this chat has its own pick.
- Header inside the dialog: bot tabs (when several editable bots), "Use <bot>'s model" (clears the chat override), and a scope radio: **Only this chat** vs **Chat + bot default** ("Changes <bot>'s model everywhere, and this chat follows it").
- Saving is **optimistic**: the bot's `chat`/`bot` value is patched locally and the panel closes at once, then `setRoomAgentModelAction({ orgSlug, roomId, agentId, scope, clear, keyId, model, effort })` (in `src/lib/actions/agents.ts`) runs in a transition. Failure restores the previous lists and shows a danger toast; success drops the cache entry so the next open reads the server's normalised pick. The action no longer re-renders the whole workspace (see [agents/bots actions](../actions/actions-agents-bots.md)). Non-admins see "Only workspace admins can change models."
- Listens for `MODEL_PICKER_EVENT` (dispatched by the failure-recovery UI in `message-actions.tsx`) to open itself, unless `listen` is false. The sidebar copy sets `listen={false}` so a failed reply still opens only the composer picker.

The barrel `components/room/model-picker/index.ts` exports `ManageAccountsModal`; `model-list.tsx` provides `useModelList(orgSlug)` (workspace-wide groups from the same `/api/connectors/models` endpoint, cached per org) and `GroupIcon`.

The phone uses the same catalog and the same writes. `GET /api/mobile/models` returns `groups` from `loadWorkspaceModels` plus `bots` from `loadRoomBotModels` (a chat) or `loadAgentPickerModel` (an agent page). `POST /api/mobile/models` calls `writeRoomAgentModel` / `writeAgentModel` in `lib/room-models.ts` — the functions behind `setRoomAgentModelAction` and `setAgentModelAction`. See [Mobile App API](../api/api-mobile.md).

## 🤖 Agent Picker (`components/agents/agent-model-picker.tsx`)

`AgentModelPicker` is the compact pill on each agent's card showing `choiceLabel(groups, value)` + effort label. It opens the same `ModelPickerPanel` in a 540px dialog and saves on every pick through `setAgentModelAction({ orgSlug, agentId, providerKeyId, model, effort })` with optimistic state (rollback + danger toast on failure). Its refresh button calls `refreshModelListsAction(orgSlug)` then `router.refresh()`.

## 🔑 Connecting Accounts

### `ManageAccountsModal` (`components/room/model-picker/manage-accounts-modal.tsx`)

A full dialog ("Manage AI accounts") with a left nav of all `ACCOUNT_PROVIDERS` (green dot when connected). Per provider kind:

- **`app`** (ChatGPT plan / Claude plan / Cursor plan) → `AppPlan`: shows "Ready" when the app is signed in on the server (`cli:<app>` group), lists the user's Macs where the app is signed in with per-Mac "Use it from <host>" buttons that call `updateHostSettingsAction({ hostId, runnerEnabled: true })`, or a setup card with the terminal command (`codex login`, `claude`, `cursor-agent login`).
- **`openrouter`** → `OpenRouterSignIn` (popup OAuth via `GET /api/connectors/openrouter/oauth`, listening for a same-origin `OPENROUTER_AUTH_SUCCESS` postMessage carrying only label + freeTier flag — the key never returns to the browser) plus a paste-key form.
- **`copilot`** → `CopilotSignIn`: GitHub device flow (`GET /api/connectors/copilot` returns `DeviceCodeFlow`), showing the user code with copy + "Open GitHub" and polling `POST /api/connectors/copilot` respecting `slow_down` interval adjustments until `complete`/`expired`/`denied`.
- **`key` / `custom`** → `KeyForm` calling `connectAccountAction({ orgSlug, provider, apiKey, label, baseUrl })` — for custom servers the address defaults to `http://localhost:11434/v1` with the note that "localhost means the computer running Sayabot".
- **`ConnectedList`** — connected groups with two-step Disconnect (`deleteProviderKey`) and the warning "Agents set to this account stop answering until they get another model."

### Account registry (`lib/ai-accounts.ts`)

`ACCOUNT_PROVIDERS` defines 17 connectable accounts with `kind` (`key` | `openrouter` | `copilot` | `custom` | `app`), base URLs, key hints/URLs and blurbs (OpenRouter, Copilot, Codex/Claude/Cursor plans, Anthropic, OpenAI, Google, DeepSeek, Grok, Kimi, Qwen, MiniMax, Groq, Cerebras, Cloudflare, custom). Because the DB `provider` column accepts only six values (`DB_PROVIDERS`), `storedProvider()` maps everything else to `openai-compatible` rows carrying the provider's address, and `providerForBaseUrl()` maps an address hostname back to the logical provider (used by `effectiveProvider` in `lib/format.ts`).

### Key persistence (`lib/provider-key-store.ts`)

`storeProviderKey({ access, provider, secret, label?, baseUrl?, verify? })` is **the one place keys are written** (Settings → AI providers, the Manage dialog, and the OpenRouter/Copilot sign-ins all end here):

1. Resolves the account spec, validates `http(s)` base URLs, maps to the stored provider row, and treats keyless local servers as `"no-key-needed"`.
2. Encrypts with `encryptSecret(secret, getKek())` and inserts into `provider_keys` (`org_id`, `owner_user_id`, `provider`, `base_url`, `label`, `ciphertext`, `iv`, `tag`, `last4`).
3. With `verify`, immediately reads the provider's live model list with the new key (warming the picker cache). A key the provider **refuses** (regex `REFUSED` at `provider-key-store.ts:15`) is deleted again and its error returned; unreachable providers keep the key with a note.
4. Audits `provider_key.created` (metadata: provider + last4) and revalidates the org.

## 🏠 Providers View (`components/providers/providers-view.tsx`)

Rendered on `/settings/keys`; receives `keys` (ProviderKeyView[]), `agentCounts` and `rooms`:

- **On this computer** — `LocalAgents` fetches `/api/providers/local` (no-store): agent apps found on the user's Mac or server (Claude Code, Codex, Gemini CLI…) with status chips (`ready`/`signed_out`/`installed`/`not_installed`), account email, version, model count, and "Add to a room" (opens `InviteBotDialog` pre-filled via `initialApp`/`initialName`, with a room selector when several rooms exist). Staleness: the Mac heartbeats every few seconds; >10 minutes shows "open the Mac app to refresh this list". When unavailable it promotes the Sayabot Mac app download.
- **Sign in with a plan you pay for** — a button opening `ManageAccountsModal`.
- **Connected / Other providers** — `ProviderRow` per provider (grouped by `effectiveProvider`), each expandable to list its keys (`•••• last4`, base URL, agent count, `TestKeyButton` + `DeleteKeyButton` from `src/components/settings/key-actions.tsx`) and an `ActionForm` over `saveProviderKey` (the thin server-action wrapper in `src/lib/actions/keys.ts` around `storeProviderKey`).

## 💡 Suggestions (`lib/model-options.ts`)

`MODEL_SUGGESTIONS` maps provider → starter model ids (the field stays free text; used by the create-agent datalist, key-less fallback lists and `defaultModel(provider)`), covering openai, anthropic, google, groq, cerebras, openrouter (with `:free` ids), copilot, cloudflare and `openai-compatible` (empty).

Provider marks (`provider-icons.tsx`) are inline SVG components — `OpenAIMark`, `ClaudeMark` (Claude's spark, used for `claude` / `claude-code` / `anthropic`), `AnthropicMark` (the company monogram, not shown for Claude), `GoogleMark`, `CopilotMark`, `OpenRouterMark`, `OpenCodeMark`, `MiniMaxMark`, `QwenMark`, `KimiMark`, `GrokMark`, and more — selected by string id.

## 🧩 Effort helpers (`model-picker-panel.tsx`)

Three exported helpers keep the picker and its callers consistent:

- `effortOptions(group, model)` — the levels a model takes: the model-specific list wins over the group's; `[]` means "Default only".
- `fitEffort(groups, keyId, model, effort)` — "A level the new model does not take falls back to Default instead of failing its first turn" (`model-picker-panel.tsx:92`): returns the effort only if the target model accepts it, else `null`.
- `choiceLabel(groups, value)` — the button text: `"Claude Opus 5.5 · Claude"` / `"llama3.2 · Ollama"` / `"Saya AI · Automatic"` / `"Choose a model"` / `"Sayabot default"`.

`ModelValue { keyId, model, effort }` is the single pick shape passed between the panel and every caller.

---

## Related docs

- [Room chat UI](./room-chat-ui.md) — where the title-bar picker mounts and `MODEL_PICKER_EVENT` fires
- [Agents UI](./agents-ui.md) — `setAgentModelAction` / `refreshModelListsAction` in context
- [Settings UI](./settings-ui.md) — the `/settings/keys` page hosting `ProvidersView`
- [App overview](./app-overview.md) — where signed-in users land after onboarding
- ../../architecture/security-model.md — KEK envelope encryption for `provider_keys`
- ../../database/schema-connectors-and-vault.md — the `provider_keys` table
- The model API routes (`/api/connectors/models`, `/api/connectors/models/room`, `/api/providers/local`) are documented under `docs/reference/web/api/`; the key actions in `docs/reference/web/actions/`.
