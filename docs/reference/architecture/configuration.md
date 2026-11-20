# Configuration

Sayabot is configured through environment variables, validated at boot by Zod schemas per service. There are three tiers: developer `.env` (repo root, loaded by turbo as a global dependency), production `deploy/.env.production` (consumed by docker-compose), and `NEXT_PUBLIC_*` build args baked into the web bundle. This page documents every variable the code actually reads, its default and its consumer.

Source files: `apps/orchestrator/src/env.ts`, `apps/web/src/lib/env.ts`, `.env.example`, `deploy/.env.production.example`, `apps/egress/src/index.ts`, `apps/computerd/src/identity.ts`, `apps/web/src/lib/env.ts`

---

## ✅ Validation model

The orchestrator validates its whole environment once at first use and throws with a formatted issue list if anything is missing (`apps/orchestrator/src/env.ts:45-63`):

```typescript
const rawKek = process.env.SAYABOT_KEK || process.env.MESH_KEK
const rawAllowPrivate =
  process.env.SAYABOT_ALLOW_PRIVATE_WEBHOOKS ?? process.env.MESH_ALLOW_PRIVATE_WEBHOOKS
```

Legacy aliases are resolved here — the rest of the code sees only `MESH_KEK`-style names. `resetEnvCache()` exists for tests. The web app instead uses small `requireEnv(name)` / `getXxx()` accessors that throw on first missing read (`apps/web/src/lib/env.ts:11-15`), and booleans accept `"true"` or `"1"` (`envBool`).

Required (no default, boot fails without them):

| Variable                                                    | Consumer                                  | Notes                                                                                                                                                                                |
| :---------------------------------------------------------- | :---------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                              | orchestrator (Drizzle pool, pg-boss), web | Must be a **session pooler / direct** connection (port 5432), not the transaction pooler — advisory locks, `LISTEN/NOTIFY` and pg-boss need session connections (`.env.example:5-7`) |
| `SAYABOT_KEK` (or `MESH_KEK`)                               | orchestrator, web                         | base64 32 bytes; checked by `parseKek` at first encrypt/decrypt                                                                                                                      |
| `SUPABASE_URL`                                              | orchestrator                              | falls back to `NEXT_PUBLIC_SUPABASE_URL`                                                                                                                                             |
| `SUPABASE_SERVICE_ROLE_KEY`                                 | orchestrator, web                         | service-role access; server-only                                                                                                                                                     |
| `ORCHESTRATOR_INTERNAL_SECRET`                              | orchestrator, web, egress                 | min 16 chars (`env.ts:9`); web-to-orchestrator auth                                                                                                                                  |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web                                       | also passed as web Docker build args                                                                                                                                                 |

---

## 🌐 URLs & networking

| Variable                                       | Default                                                    | Consumer                                                                                                  |
| :--------------------------------------------- | :--------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| `PORT`                                         | `4000`                                                     | orchestrator HTTP + `/collab`                                                                             |
| `ORCHESTRATOR_URL`                             | `http://localhost:4000` (prod: `http://orchestrator:4000`) | web → orchestrator calls; egress → orchestrator `/internal/egress/*`                                      |
| `COMPUTERD_URL`                                | `http://localhost:4100` (prod: `http://computerd:4100`)    | orchestrator & web → computerd                                                                            |
| `EGRESS_URL`                                   | `http://localhost:8081`                                    | orchestrator → egress admin                                                                               |
| `EGRESS_PROXY_URL`                             | `http://localhost:8080`                                    | orchestrator → egress proxy                                                                               |
| `NEXT_PUBLIC_COLLAB_URL`                       | `ws://localhost:4000/collab`                               | browser Yjs socket; prod `wss://<domain>/collab`                                                          |
| `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` | `http://localhost:3000`                                    | web origin for redirects/emails; **derived from `SAYABOT_DOMAIN` in docker-compose — do not set by hand** |
| `SAYABOT_DOMAIN` (legacy `MESH_DOMAIN`)        | —                                                          | prod hostname; drives nginx, Let's Encrypt, derived URLs                                                  |
| `PROXY_PORT` / `ADMIN_PORT`                    | `8080` / `8081`                                            | egress listeners (read directly from `process.env` in `apps/egress/src/index.ts:12-14`)                   |

---

## 🔐 Secrets & crypto

| Variable                                                                              | Purpose                                                                                                                                                                                                                                                                              |
| :------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SAYABOT_KEK` / `MESH_KEK`                                                            | AES-256-GCM master key (`openssl rand -base64 32`). Losing it makes all stored credentials unrecoverable                                                                                                                                                                             |
| `ORCHESTRATOR_INTERNAL_SECRET`                                                        | `openssl rand -hex 32`; shared between web, orchestrator and egress admin                                                                                                                                                                                                            |
| `COMPUTERD_PROXY_KEY`                                                                 | optional; HMAC key for per-agent egress proxy credentials. **Default: `ORCHESTRATOR_INTERNAL_SECRET`** — but if neither is set, computerd falls back to a random per-process key (`apps/computerd/src/identity.ts:11-14`), meaning credentials only work for that process's lifetime |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM` | Sayabot Cloud billing only (`SAYABOT_EDITION=cloud`)                                                                                                                                                                                                                                 |

---

## 🧠 Saya AI (server-wide default model)

The operator's own provider, offered to every user with no key. Configured in `.env` / `.env.production`, read per request by the web server and never exposed to clients except names/aliases (`apps/web/src/lib/env.ts:59-73`):

| Variable                                     | Meaning                                                                                                               |
| :------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| `SAYA_AI_NAME`                               | display name (default "Saya AI")                                                                                      |
| `SAYA_AI_BASE_URL`                           | any OpenAI-compatible `/v1` endpoint; empty ⇒ falls back to the legacy single-model vars                              |
| `SAYA_AI_API_KEY`                            | provider key                                                                                                          |
| `SAYA_AI_PROTOCOL`                           | `openai-compatible` (default) or `openai` / `anthropic`                                                               |
| `SAYA_AI_MODELS`                             | `alias=real-model-id                                                                                                  | Label`, comma separated (e.g. `pro=gpt-5.1 | Saya Pro,fast=gpt-5.1-mini | Saya Fast`). Agents store aliases, so real ids can change freely; removing an alias moves its agents to `SAYA_AI_DEFAULT` |
| `SAYA_AI_DEFAULT`                            | used by "Automatic" and new agents                                                                                    |
| `SAYA_AI_FAST`                               | background work (titles, memory, summaries, critics); default: "fast" if listed, else default                         |
| `DEV_OPENAI_COMPAT_BASE_URL/_API_KEY/_MODEL` | legacy single fallback model (Ollama, vLLM, LM Studio); becomes Saya AI's only model when `SAYA_AI_BASE_URL` is empty |

Apply changes in prod with `./deploy/deploy.sh reload` (no rebuild) — a plain `restart` keeps old values.

---

## 💻 Agent computers (computerd)

| Variable                           | Default       | Meaning                                                   |
| :--------------------------------- | :------------ | :-------------------------------------------------------- |
| `COMPUTER_BACKEND`                 | `auto`        | `auto` → smolvm (KVM / Apple silicon) → docker → e2b      |
| `COMPUTER_DOCKER_RUNTIME`          | `runc`        | `runsc` enables gVisor without KVM                        |
| `COMPUTER_MAX_RUNNING`             | `auto`        | concurrency cap; `auto` derives from host memory          |
| `COMPUTER_IDLE_MS`                 | `600000`      | idle computers sleep after 10 min                         |
| `COMPUTER_MEM_MB`                  | `1024`        | per-computer memory (doubled for elastic smolvm guests)   |
| `SMOLVM_IMAGE`                     | —             | registry ref or `docker save` tarball of `saaya/computer` |
| `E2B_TEMPLATE` / `E2B_MAX_RUNNING` | `base` / `20` | cloud-computer backend settings                           |
| `E2B_API_KEY`                      | —             | enables the e2b backend                                   |

Cloud desktops picked per bot under Works on (orchestrator; the keys themselves are normally saved per workspace in Settings → AI providers):

| Variable                                  | Default                       | Meaning                                                                                                                  |
| :---------------------------------------- | :---------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `E2B_API_KEY`                             | —                             | Also the fallback key for the E2B cloud desktop when a workspace saved none; web shows it as "Included with this server" |
| `SAYABOT_E2B_TEMPLATE`                    | `desktop`                     | E2B template for a bot's cloud sandbox                                                                                   |
| `SAYABOT_BOAT_TOKEN` / `SAYABOT_BOAT_API` | — / `https://boat.dev/api/v1` | Cloud relay Boat token (used when a workspace has no key) and API base                                                   |
| `SAYABOT_VPS_IMAGE`                       | `ubuntu:24.04`                | Image for each bot's container on a self-hosted VPS                                                                      |
| `SAYABOT_SSH_DIR`                         | `~/.sayabot`                  | Where the orchestrator keeps `known_hosts` for VPS hosts saved by address (host keys pinned on first use)                |
| `COMPUTE_ENABLED`                         | unset                         | orchestrator env flag (`v === "true"` transform)                                                                         |
| `COMPUTERD_PROXY_KEY`                     | internal secret               | see Secrets above                                                                                                        |

On Linux servers, `deploy/scripts/setup-computers.sh` prepares the host (smolvm or gVisor) and prints the settings to paste.

---

## 🔎 Tools, push and misc

| Variable                                                                                                                                     | Purpose                                                                                                                                                                                                           |
| :------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BRAVE_SEARCH_API_KEY`                                                                                                                       | optional web-search provider                                                                                                                                                                                      |
| `RESEND_API_KEY`                                                                                                                             | transactional email                                                                                                                                                                                               |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                                                                         | web-push for approvals/asks (`npx web-push generate-vapid-keys`; subject is a `mailto:`/`https:` contact)                                                                                                         |
| `MESH_ALLOW_PRIVATE_WEBHOOKS` / `SAYABOT_ALLOW_PRIVATE_WEBHOOKS`                                                                             | `"true"` allows webhook targets on private/loopback addresses — local bot development only                                                                                                                        |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_GATEWAY_ID`, `CLOUDFLARE_BROWSER_RENDERING_ENDPOINT`, `CLOUDFLARE_R2_BUCKET` | optional Cloudflare AI Gateway / Browser Rendering integrations; parsed by the orchestrator env schema (`apps/orchestrator/src/env.ts:31-35`) and consumed by the model registry (`packages/llm/src/registry.ts`) |
| `CLOUDFLARE_R2_ACCESS_KEY_ID`, `CLOUDFLARE_R2_SECRET_ACCESS_KEY`                                                                             | declared in `.env.example` only — no service code reads them today (reserved for direct R2 access)                                                                                                                |
| `DEV_OPENAI_COMPAT_*`                                                                                                                        | see Saya AI above                                                                                                                                                                                                 |
| `DATABASE_POOL_MAX`                                                                                                                          | pg-boss connection cap; orchestrator clamps to `Math.min(poolMax, 3)` (`apps/orchestrator/src/jobs/index.ts:16-21`)                                                                                               |
| `SAYABOT_LOCAL_USAGE_SCAN`                                                                                                                   | usage page reads local Claude Code/Codex logs; auto-on for localhost, never set on shared servers                                                                                                                 |
| `DESKTOP_GUEST_MODE`                                                                                                                         | web-side flag; guest mode is **on** unless set to `false`/`0`/`off` (`apps/web/src/lib/env.ts:94-98`)                                                                                                             |

---

## 🔑 Auth provider flags

Each flag has a server-side value and a `NEXT_PUBLIC_` build-time mirror; the server helper ORs both (`apps/web/src/lib/env.ts:86-102`):

| Variable                                                           | Meaning                                                                       |
| :----------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| `GITHUB_AUTH_ENABLED` / `NEXT_PUBLIC_GITHUB_AUTH_ENABLED`          | expose "Sign in with GitHub" (provider must also be enabled in Supabase Auth) |
| `GOOGLE_AUTH_ENABLED` / `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`          | expose Google sign-in                                                         |
| `SSO_ENABLED` / `NEXT_PUBLIC_SSO_ENABLED`                          | admin toggle for SAML SSO (a Supabase Pro feature)                            |
| `GITHUB_OAUTH_CLIENT_ID/_SECRET`, `GOOGLE_OAUTH_CLIENT_ID/_SECRET` | provider credentials (kept in `.env`; production example lists only GitHub's) |

---

## 🏷️ Deployment tuning (`.env.production`)

| Variable                                                                         | Default            | Meaning                                                                                                                                                                                                                                                     |
| :------------------------------------------------------------------------------- | :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SAYABOT_EDITION` (legacy `NEXT_PUBLIC_SAYABOT_EDITION`)                         | `self-hosted`      | `cloud` enables plans/limits/billing and the `ee/` code (see [Editions & Licensing](./editions-and-licensing.md))                                                                                                                                           |
| `SAYABOT_INSTANCE_NAME`                                                          | `Sayabot`          | name shown in the Mac/phone apps ("Acme's Sayabot"), trimmed to 60 chars (`apps/web/src/lib/env.ts:109-112`)                                                                                                                                                |
| `SAYABOT_IMAGE_PREFIX` (legacy `MESH_IMAGE_PREFIX`)                              | `sayabot`          | image registry prefix                                                                                                                                                                                                                                       |
| `SAYABOT_APP_SERVICES` (legacy `MESH_APP_SERVICES`)                              | `orchestrator web` | services built/deployed; add `computerd egress` explicitly                                                                                                                                                                                                  |
| `SAYABOT_WEB_MEMORY` / `SAYABOT_ORCHESTRATOR_MEMORY`                             | `1g`               | container memory limits                                                                                                                                                                                                                                     |
| `SAYABOT_KEEP_RELEASES`                                                          | `3`                | previous releases kept for rollback                                                                                                                                                                                                                         |
| `SAYABOT_TAG` (legacy `MESH_TAG`)                                                | `latest`           | image tag; also used as `GIT_COMMIT_SHA` build arg                                                                                                                                                                                                          |
| `CLOUDFLARE_TUNNEL_TOKEN`                                                        | —                  | tunnel mode: no published ports, no Let's Encrypt                                                                                                                                                                                                           |
| `SAYABOT_SUPABASE`                                                               | `hosted`           | `bundled` runs Supabase on the same VPS (`docker-compose.supabase.yml`); `install.sh` generates the bundled secrets (`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `SECRET_KEY_BASE` 64 chars, `REALTIME_DB_ENC_KEY` exactly 16 chars) |
| `LETSENCRYPT_EMAIL`                                                              | —                  | cert expiry notices                                                                                                                                                                                                                                         |
| `E2E_*` (`E2E_BASE_URL`, `E2E_ORG_SLUG`, `E2E_USER_A_EMAIL`, `E2E_USER_B_EMAIL`) | —                  | Playwright only                                                                                                                                                                                                                                             |

---

## 🧪 Precedence & gotchas

1. **Session vs transaction pooler**: the single most common self-hosting failure. `DATABASE_URL` must hold a session connection; transaction-pooled URLs break advisory locks and LISTEN/NOTIFY silently.
2. **`NEXT_PUBLIC_*` are build-time** in production (baked by `deploy/docker/web.Dockerfile` build args from `deploy/.env.production`) but read at runtime in dev. That's why `deploy.sh reload` re-creates containers rather than restarting.
3. **Legacy aliases win by primary name**: `SAYABOT_KEK` beats `MESH_KEK`, `SAYABOT_DOMAIN` beats `MESH_DOMAIN`; when both are absent the orchestrator throws a Zod issue list naming the canonical variable.
4. **`.env` is a turbo global dependency** — editing it invalidates every task cache (`turbo.json:4`).
5. **Booleans**: orchestrator transforms are strict `=== "true"`; web's `envBool` also accepts `"1"`.

---

## Related docs

- [Monorepo & Build](./monorepo-and-build.md) — where these variables are consumed at build vs runtime.
- [Security Model](./security-model.md) — what `SAYABOT_KEK` and `COMPUTERD_PROXY_KEY` protect.
- [Editions & Licensing](./editions-and-licensing.md) — the `SAYABOT_EDITION` switch and Stripe vars.
- [System Overview](./system-overview.md) — which service owns each default.
