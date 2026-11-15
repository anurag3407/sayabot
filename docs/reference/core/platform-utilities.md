# Platform Utilities: Cloud Handoff, Editions, Saya AI & Server Helpers

This reference covers the platform-level plumbing in `@sayabot/core`: the one-time desktop→Cloud workspace handoff (`cloud-handoff.ts`, `workspace-copy.ts`), the operator-provided shared model provider (`saya-ai.ts`), the edition and plan machinery (`edition.ts`), and the server-only crypto/guard helpers under `server/` (agent keys, webhook signatures, SSRF guard). Everything here either runs on the trusted side of the boundary (server, desktop app) or produces data that is safe to cross it.

Source files: `packages/core/src/cloud-handoff.ts`, `packages/core/src/workspace-copy.ts`, `packages/core/src/saya-ai.ts`, `packages/core/src/edition.ts`, `packages/core/src/server/index.ts`, `packages/core/src/server/agent-key.ts`, `packages/core/src/server/webhook.ts`, `packages/core/src/server/ssrf.ts` (tests: `cloud-handoff.test.ts`, `workspace-copy.test.ts`, `saya-ai.test.ts`, `edition.test.ts`, `server/agent-key.test.ts`, `server/webhook.test.ts`, `server/ssrf.test.ts`)

---

## ☁️ Cloud Handoff Planning (`cloud-handoff.ts`)

> "The first time Cloud is ready, this Mac's bots, chats, routines, and keys move there once. When the plan ends they come back. A later resubscribe can copy again." — module header, `cloud-handoff.ts:1`

### `planCloudHandoff(input)` (`cloud-handoff.ts:20`)

The state machine deciding the next migration step from three booleans — `cloudReady`, `copied` (a copy is sitting on Cloud and not restored), `planActive`:

| State | Result |
| :--- | :--- |
| Cloud ready + plan active + not yet copied | `"copy_to_cloud"` |
| Copy exists but the plan lapsed | `"copy_back"` |
| Everything else (including already-copied-and-active) | `"none"` |

Because `copied` is cleared on restore, a resubscribe later produces a fresh `"copy_to_cloud"`.

### `mergeRecords(destination, incoming)` and `applyHandoff`

`mergeRecords` (`cloud-handoff.ts:40`) merges one list by `id` with a **destination-wins** rule: rows the destination already has are left untouched, only new ids are added. `applyHandoff` applies that to the four lists of a `LocalWorkspaceSnapshot` — `bots`, `chats`, `routines`, `keys` (each a `HandoffRecord`, i.e. `{ id }` plus arbitrary fields). So a Cloud that already had its own bots keeps them. `cloud-handoff.test.ts` verifies both the step matrix and the destination-wins merge.

---

## 📦 Workspace Copy Validation (`workspace-copy.ts`)

> "What the desktop sends the first time Cloud is ready, and what comes back when the plan ends. Keys stay sealed. A row that already exists on the destination is left as it is." — module header, `workspace-copy.ts:1`

### The payload shapes

`WorkspaceCopy` bundles `BotCopy[]` (handle, kind `llm`|`external`, model, system prompt ≤ 20 000 chars, params, bio, `providerKeyId`), `ChatCopy[]` (each with up to 30 `ChatMessageCopy` entries), `RoutineCopy[]` (cron expression, prompt, timezone, enabled), `KeyCopy[]` — **provider API keys as AES-256-GCM envelopes only** (`ciphertext`/`iv`/`tag`/`last4`, never plaintext) — and optional `ComputerSettingsCopy` (the app-level Boat key sealed the same way, plus the VPS SSH alias and auto-start flag).

### `parseWorkspaceCopy(value)` — the sanitizer (`workspace-copy.ts:100`)

Takes untrusted JSON and rebuilds a clean payload, dropping anything malformed:

- Every list is capped at **200 rows** (chats' messages at 30).
- Bots: UUID id, handle matching `^[a-z0-9][a-z0-9-]{0,39}$` (lowercased, ≤ 40 chars), non-empty display name; everything else length-clamped (`text(value, max)`).
- Chats: unknown `kind` coerces to `"private"`; message `senderType` must be one of `human | agent | system`.
- Routines: id, `agentId`, name, `scheduleExpr`, and prompt are all required; timezone defaults `"UTC"`; `enabled` defaults true.
- Keys: provider must be one of `openai | anthropic | google | groq | cerebras | openai-compatible` **and** all four envelope fields (`ciphertext`, `iv`, `tag`, `last4`) must be present — a plaintext-looking key (no envelope) is dropped outright, which `workspace-copy.test.ts` asserts.
- Computers: rejected entirely if it smells like a raw token (`boatToken`/`token` keys present); the Boat key is kept only when the full envelope is present; the SSH alias must match `^[A-Za-z0-9_.:@-]+$`.

### `materializeCopy(existing, incoming)` — the insert filter (`workspace-copy.ts:219`)

Given what the destination already has (`ExistingWorkspace`: existing bot ids **and handles**, chat/routine/key ids, `computerSettings?`), it returns only the rows to insert:

- Bots whose id **or handle** already exists are skipped (so Cloud keeps its own copy of that bot).
- Keys and chats are skipped by id.
- Routines must reference a **surviving** bot (`agentId` in the kept set) and, when they have a `roomId`, a surviving chat.
- A bot whose `providerKeyId` didn't survive the key filter gets it nulled out.
- Computer settings only materialize when the destination has none — the destination's own Boat key/VPS wins.

---

## 🧠 Saya AI Provider Config (`saya-ai.ts`)

Saya AI is the model provider the **server operator** runs for everyone on a Sayabot instance. Agents never store a real model id — only a stable alias like `saya/pro`, resolved against the server environment on every turn, so swapping the endpoint, key, or backing model in `.env` silently switches every agent on web, phone, and Mac.

### Environment contract

```
SAYA_AI_BASE_URL=https://llm.example.com/v1
SAYA_AI_API_KEY=sk-...
SAYA_AI_MODELS=pro=gpt-5.1|Saya Pro,fast=gpt-5.1-mini|Saya Fast
SAYA_AI_DEFAULT=pro          # what "Automatic" and new agents use (default: first model)
SAYA_AI_FAST=fast            # background work: titles, memory, summaries (default: default)
SAYA_AI_PROTOCOL=openai-compatible   # or openai | anthropic
SAYA_AI_NAME=Saya AI
```

`SAYA_AI_MODEL=<id>` is shorthand for one model with alias `default`. Without any `SAYA_AI_*` values the legacy `DEV_OPENAI_COMPAT_*` shared model is adopted so existing servers keep working.

### Parsing and resolution

- **`parseSayaModels(raw, name?)`** (`saya-ai.ts:67`) — splits on commas/newlines; each entry is `alias=<id>|<label>` (label optional). Entries without `alias=` use the lowercased model id. Aliases must match `^[a-z0-9][a-z0-9._-]{0,39}$` after slugification; bad or **duplicate** aliases are skipped rather than failing the server. A missing label becomes `"<name> <Title Case Alias>"` for alias-prefixed entries or the raw id otherwise.
- **`readSayaAiConfig(env)`** (`saya-ai.ts:92`) — server-side reader returning `SayaAiConfig | null` (null when no base URL or no models resolve — the feature is simply off). Handles the single-model shorthand (label becomes the provider name) and the `DEV_OPENAI_COMPAT_*` fallback, where that legacy model *wins over* `SAYA_AI_MODELS` since the latter would point at an unconfigured endpoint. Protocol defaults to `openai-compatible` unless the env value is one of the three known protocols; trailing slashes are stripped from the base URL. `defaultAlias` is `SAYA_AI_DEFAULT` when that alias exists, else the first model; `fastAlias` is `SAYA_AI_FAST`, else an existing `"fast"` alias, else the default.
- **`resolveSayaModel(config, stored)`** (`saya-ai.ts:144`) — what an agent's stored value means *right now*: `saya/<alias>` → that alias; `null` or an alias the operator has since removed → the current default, so a config change never breaks an agent (three-level fallback ending at `models[0]`).
- **`resolveSayaFastModel(config)`** — resolves the configured fast alias for background work.

### Public surface (what leaves the server)

`publicSayaAi(config)` produces `SayaAiPublic { name, models: [{ value: "saya/<alias>", label }], defaultLabel }` — **no key, no endpoint, no real model ids**. `sayaModelLabel(config, stored)` renders `"Saya Pro"` for an explicit pick or `"Saya AI · Automatic (Saya Pro)"` for agents following the default; `sayaPublicLabel(view, stored)` is the same for clients holding only the public view; `agentModelText(agent, saya)` renders the one-line model description for lists/profiles (`"external agent"` for external kinds, public label when the agent has no provider key of its own). `saya-ai.test.ts` covers all of this, including the "follows the operator when the model behind an alias changes" and "public view hides the real ids, key and endpoint" cases.

---

## 🏷️ Edition & Plans (`edition.ts`)

### Edition detection

```typescript
export type Edition = "self-hosted" | "cloud"
export function readEdition(env): Edition            // SAYABOT_EDITION ?? NEXT_PUBLIC_SAYABOT_EDITION
export function publicEdition(): Edition             // build-time NEXT_PUBLIC_SAYABOT_EDITION only
```

The value is trimmed, lowercased, and compared to `"cloud"` — anything else (unset, `"enterprise"`, garbage) is **`self-hosted`**, the default: no plans, no limits, no billing, nothing talking to Sayabot Cloud. `publicEdition` exists for the browser, where the value is baked into the build so Next can inline it.

### Plans

`PLANS` (`edition.ts:55`) defines the three Sayabot Cloud plans (per workspace per month):

| Plan | Price | `serverTurnsPerMonth` | `agents` | `computers` | `members` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `free` | $0 | 300 | 3 | 0 | 3 |
| `pro` | $12 | 3 000 | 20 | 2 | 5 |
| `team` | $39 | 15 000 | `null` (unlimited) | 10 | 50 |

`serverTurnsPerMonth` counts agent replies that run **on the server** (server models, your keys, agent computers); replies on the person's own Mac don't count. Each plan carries marketing `highlights` and a `priceLabel` that should match the Stripe prices in `STRIPE_PRICE_PRO` / `STRIPE_PRICE_TEAM`.

### Limit helpers

- **`effectivePlan(plan, status)`** — a paid plan only counts while the subscription is `active`, `trialing`, or `past_due`; `canceled` or anything else falls back to `"free"`.
- **`checkLimit(edition, plan, kind, used)`** — returns `{ allowed, used, limit }`. Self-hosted servers **never** hit a limit (`limit: null`, always allowed); on Cloud, `null` limits are unlimited and otherwise `used < limit`.
- **`upgradeFor(plan, kind, needed)`** — the smallest next plan whose limit is `null` or `>= needed`, or `null` when none fits (drives "upgrade to …" prompts; `team` for 51 members has no upgrade).
- **`usageMonth(date?)`** — `"2026-11"`-style UTC month key for usage counters.
- **`limitMessage(kind, plan, limit)`** — plain-words rejection text, e.g. `"This workspace has used its 300 server replies for this month on the Free plan."`; `computers` at 0 gets the special line `"Agent computers are part of the paid plans."`

---

## 🔐 Server Helpers (`server/`)

`server/index.ts` is the barrel that re-exports the three modules below. Everything here imports `node:crypto`/`node:dns`/`node:net` and is therefore **server-only** (never ship to the browser or React Native).

### Agent & device keys (`server/agent-key.ts`)

All token generation in one place; hashes are **SHA-256 hex** (`hashAgentApiKey`), so the DB stores only hashes:

| Export | Format | Purpose |
| :--- | :--- | :--- |
| `generateAgentApiKey()` | `mesh_ak_<32-byte base64url>` + `{ prefix: token.slice(0,16), hash, last4 }` | The agent's API key (the `mesh_ak_` family also matched by the redactor) |
| `generateBotInviteCode()` | `bi_<18-byte base64url>` | Public-ish code in an "Add an agent" link — explicitly **not a credential**; joining still needs approval |
| `generatePollToken()` | `bp_<32-byte base64url>` + hash | Handed to the bot that asked to join; proves it is the same bot when it collects its key (see [invites-pairing-and-remote.md](./invites-pairing-and-remote.md)) |
| `generatePairingCode(alphabet?, length?)` | 8 chars from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` | Phone pairing; rejection-sampled (`byte >= 256 - 256 % len` skipped) so there is **no modulo bias** |
| `generateDeviceToken()` | `sd_<32-byte base64url>` + hash | Long-lived secret a paired phone keeps to check it hasn't been removed |
| `generateJoinCode()` | `j_<18-byte base64url>` | Workspace invite link (`/join/<code>`) — holding it grants membership, so it is long |

`agentKeyPrefix(token)` returns the first 16 characters (the lookup/display prefix stored alongside the hash).

### Webhook signatures (`server/webhook.ts`)

Standard Webhooks-style HMAC signing for outbound webhooks:

```typescript
export const WEBHOOK_TOLERANCE_SECONDS = 300

export function generateWebhookSecret(): string   // 32 random bytes, base64 — the HMAC key
export function signWebhook({ secret, id, timestamp, body }): string
// → "v1,<base64 HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)>"

export function verifyWebhook(input): { valid: boolean; reason?: string }
```

`verifyWebhook` (`server/webhook.ts:41`) rejects, in order: missing `id`/`timestamp`/`signature` headers (`"missing signature headers"`), a non-numeric timestamp, timestamps more than 300 s (default, configurable via `toleranceSeconds`, with `nowSeconds` injectable for tests) from now (`"timestamp outside tolerance"`), and finally signature mismatch. Multiple signatures in a space-separated header are supported — any matching `v1,` candidate wins — and comparison is `timingSafeEqual` with a length pre-check. Reasons are returned rather than thrown so routes can log them.

### SSRF guard (`server/ssrf.ts`)

The last line of defence before the server fetches an agent-supplied URL.

**`isPrivateIp(rawIp)`** (`server/ssrf.ts:62`) — classifies an address as unsafe. Brackets are stripped; the literal strings `127.0.0.1`, `::1`, `localhost`, `::` are always private. IPv4 checks: loopback `127/8`, RFC 1918 (`10/8`, `172.16/12`, `192.168/16`), link-local + cloud metadata `169.254/16` (i.e. `169.254.169.254`), CGNAT `100.64/10`, `0.0.0.0/8`, RFC 2544 benchmarking `198.18/15`, TEST-NET-1/2/3, multicast + reserved `224/4` and `240/4`, and the broadcast address. IPv6 (decoded by the internal `parseIpv6Words`, which also converts IPv4-embedded forms like `::ffff:192.168.1.1`): multicast `ff00::/8`, unspecified/loopback, **IPv4-mapped** (`::ffff:a.b.c.d`), IPv4-compatible (`::a.b.c.d`), NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) embedded addresses are recursively re-checked against the IPv4 rules, plus link-local `fe80::/10`, ULA `fc00::/7`, the discard prefix `100::/64`, and documentation `2001:db8::/32`. **Unparseable IPv6 is treated as unsafe** (`return true`), as is any input that is neither valid IPv4 nor IPv6.

**`assertSafeEgressHost(hostname)`** (`server/ssrf.ts:158`) — async gate returning the resolved addresses (the caller can pin the connection to them):

1. Empty host → throw `"SSRF blocked: empty host"`.
2. Without touching DNS: `localhost`, `*.localhost`, `*.local`, `*.internal`, and `*.onion` are rejected (`metadata.google.internal` and `kubernetes.default.svc.cluster.local` fall to the `.internal`/`.local` suffix rules).
3. Literal IPs (v4 or v6, bracketed or not) go straight through `isPrivateIp`.
4. Otherwise `dns.lookup(host, { all: true })` resolves — DNS failure or an empty answer throws — and **every** resolved address must pass `isPrivateIp`, else `SSRF blocked: <host> resolved to restricted IP <ip>`.

`ssrf.test.ts` covers the full IPv4/IPv6 matrix including the adjacent-public-IP negatives (`192.0.1.1` is *not* private) and the bracketed/IPv4-mapped metadata addresses.

---

## How they fit together

The desktop app builds a `WorkspaceCopy`, sanitizes it with `parseWorkspaceCopy`, and ships it when `planCloudHandoff` says `"copy_to_cloud"`; Cloud validates again and uses `materializeCopy` to decide what to insert. Whether that migration is worth anything depends on the plan, which `edition.ts` gates (`checkLimit` / `effectivePlan` / `upgradeFor`) and which the UI prices out of `PLANS`. On the model side, `saya-ai.ts` is the operator's shared provider that agents reference by `saya/<alias>` instead of picking models. All server-adjacent crypto — agent keys, pairing/invite/join codes, webhook signatures, and the SSRF gate — lives behind `server/index.ts` so the runtime can import one barrel and the client bundle never imports `node:crypto`.

Related docs: [./invites-pairing-and-remote.md](./invites-pairing-and-remote.md), [./redact-and-breakers.md](./redact-and-breakers.md), [./scanner.md](./scanner.md)
