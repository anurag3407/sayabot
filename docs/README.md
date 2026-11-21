# Sayabot Documentation Hub

Welcome to the **Sayabot** documentation. Sayabot is an open-source, full-stack autonomous remote agent platform and real-time collaboration workspace where human teams and AI agents share rooms, execute deterministic turns, collaborate on live canvases, and operate persistent Linux computers.

Whether you are setting up Sayabot for the first time, designing custom autonomous agents, connecting external tools via MCP, or deploying to production, this hub provides comprehensive, step-by-step guides — plus a **per-feature reference library** (`docs/reference/`, 170+ docs) generated from a full read of the codebase.

Project policies live at the repository root: [Code of Conduct](../CODE_OF_CONDUCT.md), [Security policy](../SECURITY.md), [Contributing](../CONTRIBUTING.md), and [Licensing](../LICENSING.md). Vulnerability reports go to sayalabs.studio@gmail.com.

---

## 📚 Documentation Index

```
docs/
├── README.md                                 # This documentation hub
├── PROJECT_DOCUMENTATION.md                  # Comprehensive master architectural & technical documentation
├── AI_Pillars_RAG_MCP_GenAI_Agents_Guide.pdf # RAG, MCP, Gen AI & AI Agents guide with usage & architecture
├── Sayabot_A_Simple_Guide.pdf                # Single-page non-technical introduction (book page style)
├── Sayabot_Executive_Summary.pdf             # Publication-grade one-page executive summary PDF
├── getting-started.md             # Complete step-by-step setup from scratch
├── self-hosting.md                # Complete self-hosting manual (VPS, Cloudflare, Tailscale, Homelab)
├── architecture.md                # Monorepo anatomy, turn coordinator & data flow
├── cron-and-automations.md        # Hermes cron engine & n8n-style visual canvas
├── rooms-and-collaboration.md     # Multiplayer rooms, live canvas, memory & tasks
├── tools-and-sandboxes.md         # 40+ built-in tools, Linux sandboxes & browser CDP
├── models-and-pricing.md         # Model picker: live models, prices, effort, plan usage
├── connectors.md                  # Two-tier workspace connectors (Slack, Drive, GitHub, Jira)
├── mcp-and-connectors.md          # Universal MCP gateway & bring-your-own-bot
├── deployment.md                  # Production deployment (VPS, Docker, Supabase)
├── cloudflare-integration.md      # Cloudflare platform integration & edge architecture
├── auto-updates.md                # Multi-platform auto-updates (Web, Mac PWA, Android APK)
├── self-hosting-quickstart.md     # Self-host in 10 minutes: install.sh, apps, backups
├── sayabot-cloud.md               # Sayabot Cloud: plans, limits, Stripe billing (SAYABOT_EDITION=cloud)
├── agents-on-your-mac.md          # Agents run on your Mac: tools, live steps, approvals
├── desktop-guest-mode.md          # Mac app without sign-in (Supabase anonymous users)
├── macos-signing-and-notarization.md # Developer ID signing & notarization checklist
└── testing.md                     # Test suites (unit, integration, e2e Playwright)
```

---

## 🔬 Per-Feature Reference Library (`docs/reference/`)

Task-oriented guides live at the top level of `docs/`. The **reference library** below documents every feature in depth, one doc per feature, written against the actual source code (real function names, schemas, defaults, env vars, events). **Agents: any code change must update the matching reference doc — see [AGENTS.md §9 Documentation Maintenance](../AGENTS.md).**

### Architecture & Platform — `docs/reference/architecture/`

| Doc                                                                        | Covers                                                                     |
| :------------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| [system-overview](reference/architecture/system-overview.md)               | Service map, orchestrator boot, request flow, package graph, failure modes |
| [monorepo-and-build](reference/architecture/monorepo-and-build.md)         | Workspace members, turbo pipeline, scripts, Docker images, CI              |
| [turn-lifecycle](reference/architecture/turn-lifecycle.md)                 | Message → queue planning → coordination loop → engine run → reply          |
| [realtime-and-events](reference/architecture/realtime-and-events.md)       | Supabase Realtime broadcast, 15-event catalogue, Hocuspocus, LISTEN/NOTIFY |
| [auth-and-authorization](reference/architecture/auth-and-authorization.md) | Sessions, agent API keys/OAuth, org roles, internal auth, RLS split        |
| [security-model](reference/architecture/security-model.md)                 | KEK envelope crypto, secret broker, SSRF walls, approvals, redaction       |
| [threat-model](reference/architecture/threat-model.md)                     | Assets, trust boundaries, adversaries, controls, invariants, known gaps    |
| [configuration](reference/architecture/configuration.md)                   | Every env var across all services, with defaults from code                 |
| [editions-and-licensing](reference/architecture/editions-and-licensing.md) | AGPL vs `ee/`, plans, `effectivePlan`, turn admission, Stripe              |

### `@sayabot/core` — `docs/reference/core/`

| Doc                                                                        | Covers                                                                 |
| :------------------------------------------------------------------------- | :--------------------------------------------------------------------- |
| [overview-and-types](reference/core/overview-and-types.md)                 | Package export surface, `types.ts` vocabulary, dependency map          |
| [turns](reference/core/turns.md)                                           | Turn planning state machine: mentions / debate / moderated, sessions   |
| [harness-and-persona](reference/core/harness-and-persona.md)               | Harness system prompt every bot runs under, owner persona, Saya guide  |
| [capabilities-and-mentions](reference/core/capabilities-and-mentions.md)   | 14 capability flags, tool gating, mention parsing                      |
| [speech-text](reference/core/speech-text.md)                               | Spoken normalization, markdown stripping, TTFB utterance chunking      |
| [asks](reference/core/asks.md)                                             | Ask/response protocol, fact keys, answer application                   |
| [thinking](reference/core/thinking.md)                                     | Fold model reasoning into a click-to-open chat line                    |
| [commands](reference/core/commands.md)                                     | Destructive-command classifier feeding the approval gate               |
| [cron-and-schedule](reference/core/cron-and-schedule.md)                   | Cron parsing, natural-language shorthands, schedule windows            |
| [cost-and-plan-limits](reference/core/cost-and-plan-limits.md)             | Cost math, model pricing tables, provider plan-limit parsers           |
| [patch-and-fold-key](reference/core/patch-and-fold-key.md)                 | Canvas patch planner, message fold keys                                |
| [redact-and-breakers](reference/core/redact-and-breakers.md)               | 14-pattern secret redaction, pre-turn quota breakers, repetition guard |
| [engine-and-computers](reference/core/engine-and-computers.md)             | Engine budget/compaction helpers, computer placement types             |
| [invites-pairing-and-remote](reference/core/invites-pairing-and-remote.md) | Invite codes, bot invites, device pairing, remote hosts, clients       |
| [scanner](reference/core/scanner.md)                                       | Read-only scanning of local Claude Code / Codex / Antigravity installs |
| [platform-utilities](reference/core/platform-utilities.md)                 | Cloud handoff, workspace copy, Saya AI, editions, server helpers       |
| [mascot](reference/core/mascot.md)                                         | Saya mascot geometry shared by web, landing, mobile and brand exports  |

### Database — `docs/reference/database/`

| Doc                                                                                        | Covers                                                                                   |
| :----------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| [overview](reference/database/overview.md)                                                 | `createDb`, two-phase migrator, drizzle config, all 33 enums                             |
| [schema-identity-and-invites](reference/database/schema-identity-and-invites.md)           | Profiles, orgs, members, room/workspace/bot invites, OAuth clients, merge tickets        |
| [schema-agents-and-templates](reference/database/schema-agents-and-templates.md)           | Agents, provider keys, API keys, tool configs, agent templates                           |
| [schema-rooms-messages-canvas](reference/database/schema-rooms-messages-canvas.md)         | Rooms, members, messages, turn sessions, agent runs, canvases                            |
| [schema-tasks-and-facts](reference/database/schema-tasks-and-facts.md)                     | Tasks, task events/comments, owner facts                                                 |
| [schema-memory](reference/database/schema-memory.md)                                       | Memories, embeddings, sources, open loops, links, vector providers                       |
| [schema-routines-and-meetings](reference/database/schema-routines-and-meetings.md)         | Routines, routine runs, room schedules, meetings                                         |
| [schema-connectors-and-vault](reference/database/schema-connectors-and-vault.md)           | Workspace connectors (AES envelope), grants, vault secrets, quotas                       |
| [schema-computers-devices-desktop](reference/database/schema-computers-devices-desktop.md) | Agent computers, org settings, device pairings, desktop hosts, jobs                      |
| [schema-engine-tools-ops](reference/database/schema-engine-tools-ops.md)                   | Run steps/transcripts, skills, MCP servers, audited `tool_calls`, webhooks, usage, audit |
| [schema-billing](reference/database/schema-billing.md)                                     | Org plans, monthly usage rollup, `bump_server_turns`                                     |
| [migrations-catalog](reference/database/migrations-catalog.md)                             | Every migration (4 Drizzle + 35 SQL): objects created, ordering                          |
| [rls-and-realtime](reference/database/rls-and-realtime.md)                                 | RLS helper functions, policy inventory, realtime publication, RPCs, pitfalls             |
| [seed](reference/database/seed.md)                                                         | Model pricing seed + 9 curated agent templates, idempotency                              |

### `@sayabot/llm` — `docs/reference/llm/`

| Doc                                                               | Covers                                                                                      |
| :---------------------------------------------------------------- | :------------------------------------------------------------------------------------------ |
| [overview](reference/llm/overview.md)                             | Package role, 17-provider abstraction, model-resolution paths                               |
| [tts](reference/llm/tts.md)                                       | Multi-provider TTS (ElevenLabs, Fish Audio, OpenAI, Gemini, Grok, Chatterbox, System) & STT |
| [crypto](reference/llm/crypto.md)                                 | `encryptSecret`/`sealSecret` envelope format, KEK validation                                |
| [registry-and-models](reference/llm/registry-and-models.md)       | Provider adapters, model catalog pipeline, effort ladders, snapshots                        |
| [plan-usage](reference/llm/plan-usage.md)                         | Claude/Codex quota windows, credential reading, caches                                      |
| [mcp](reference/llm/mcp.md)                                       | MCP client gateway: transports, tool bridging, dangerous-tool patterns                      |
| [mcp-oauth](reference/llm/mcp-oauth.md)                           | OAuth for MCP servers: discovery, PKCE, sealed state, refresh                               |
| [langfuse](reference/llm/langfuse.md)                             | Tracing mirror: traces, generations, spans, env gating                                      |
| [copilot-and-local-apps](reference/llm/copilot-and-local-apps.md) | Copilot token exchange, local app catalog                                                   |
| [connector-secret](reference/llm/connector-secret.md)             | Connector credential packing/unpacking                                                      |

### Orchestrator — `docs/reference/orchestrator/`

**Engine & runners — `engine/`**

| Doc                                                                                                   | Covers                                                                  |
| :---------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| [service-overview](reference/orchestrator/engine/service-overview.md)                                 | Boot, HTTP route inventory, env vars, `withRoomLock`, authz             |
| [coordinator](reference/orchestrator/engine/coordinator.md)                                           | pg-boss queues, turn loop, queue planners, interrupts, active runs      |
| [engine-loop](reference/orchestrator/engine/engine-loop.md)                                           | The agent loop: context assembly, passes, step preparation, persistence |
| [engine-budget-and-compaction](reference/orchestrator/engine/engine-budget-and-compaction.md)         | Token budgets, cache metrics, compaction ladder, summarization          |
| [engine-interrupts-and-recovery](reference/orchestrator/engine/engine-interrupts-and-recovery.md)     | Steering, park/resume, stale-run recovery, error classification         |
| [engine-planning](reference/orchestrator/engine/engine-planning.md)                                   | `update_plan`, model fitting, skills lifecycle                          |
| [engine-subagents-and-tool-search](reference/orchestrator/engine/engine-subagents-and-tool-search.md) | Subagent spawning, BM25 tool index, `find_tools`                        |
| [engine-verify](reference/orchestrator/engine/engine-verify.md)                                       | Verify modes (self/critic), verification gate                           |
| [runner-llm](reference/orchestrator/engine/runner-llm.md)                                             | Model resolution ladders, streaming runner, Mac approval pipeline       |
| [runner-external-and-local](reference/orchestrator/engine/runner-external-and-local.md)               | External bots, CLI runners (Claude Code/Codex), local Mac runner                        |
| [engine-takeover](reference/orchestrator/engine/engine-takeover.md)                                   | Quota takeover: fallback model, holds, failed-attempt cleanup                            |
| [engine-watchdog](reference/orchestrator/engine/engine-watchdog.md)                                   | Stall watchdog: activity tracking, turn vs tool limits, in-process abort                 |

**Tools — `tools/`**

| Doc                                                                    | Covers                                                                   |
| :--------------------------------------------------------------------- | :----------------------------------------------------------------------- |
| [tool-system](reference/orchestrator/tools/tool-system.md)             | `buildTools` registry, `ToolSpec`, audit pipeline, 60+ tool inventory    |
| [approvals](reference/orchestrator/tools/approvals.md)                 | `pending_approval` lifecycle, 5-min timeout, push fan-out                |
| [standing-grants](reference/orchestrator/tools/standing-grants.md)     | Exact-call grants: digest, exclusions, 24h TTL, create/revoke             |
| [secrets-broker](reference/orchestrator/tools/secrets-broker.md)       | `use_secret`, placeholder swap, grant tiers, egress resolve gateway      |
| [tool-computer](reference/orchestrator/tools/tool-computer.md)         | `select_computer` + 17 computer tools + 10 browser tools                 |
| [tool-sandbox](reference/orchestrator/tools/tool-sandbox.md)           | `code_sandbox`/`terminal_exec`, 6-backend catalog                        |
| [tool-connectors](reference/orchestrator/tools/tool-connectors.md)     | 19 connector tools with grant-scope enforcement                          |
| [tool-cronjob](reference/orchestrator/tools/tool-cronjob.md)           | Agent self-scheduling of routines                                        |
| [tool-document](reference/orchestrator/tools/tool-document.md)         | Document extraction providers                                            |
| [tool-github](reference/orchestrator/tools/tool-github.md)             | `github_bridge` read/commit tools                                        |
| [tool-postgres](reference/orchestrator/tools/tool-postgres.md)         | Read-only SQL inspector with hard caps                                   |
| [tool-tasks](reference/orchestrator/tools/tool-tasks.md)               | 11 task-board tools and their invariants                                 |
| [tool-verification](reference/orchestrator/tools/tool-verification.md) | `verify_workspace`, `workspace_detect`, `report_findings`                |
| [tool-web](reference/orchestrator/tools/tool-web.md)                   | `web_search` (10 providers) + `web_fetch` SSRF pipeline                  |
| [tool-workspace](reference/orchestrator/tools/tool-workspace.md)       | `workspace_fork`/`workspace_inspect`                                     |
| [tool-voice-note](reference/orchestrator/tools/tool-voice-note.md)     | `send_voice_note` audio synthesis and interactive voice bubble generator |

**Platform services — `platform/`**

| Doc                                                                               | Covers                                                                        |
| :-------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| [connector-platform](reference/orchestrator/platform/connector-platform.md)       | ConnectorService, scope grants, retry/backoff, inbound intake                 |
| [connectors-chat](reference/orchestrator/platform/connectors-chat.md)             | Slack, Discord gateway, Telegram/WhatsApp clients                             |
| [agent-gateways](reference/orchestrator/platform/agent-gateways.md)               | Per-agent Telegram/Discord account, one bound chat, reply delivery           |
| [connectors-content](reference/orchestrator/platform/connectors-content.md)       | GitHub, Google Drive, password managers, desktop bridge                       |
| [connectors-storage](reference/orchestrator/platform/connectors-storage.md)       | `CloudStorageClient`: Supabase, R2, B2, S3/MinIO, Hugging Face object storage |
| [connectors-apps](reference/orchestrator/platform/connectors-apps.md)             | Composio connected apps: Gmail, Calendar, Notion and the rest of the catalog  |
| [bot-platform](reference/orchestrator/platform/bot-platform.md)                   | Bring-your-own-bot auth, streaming endpoints, reply correlation               |
| [mcp-server](reference/orchestrator/platform/mcp-server.md)                       | Exposed MCP JSON-RPC surface, 27 tools, activity long-poll                    |
| [orchestrator-agent](reference/orchestrator/platform/orchestrator-agent.md)       | Built-in `saya` agent: provisioning, `sayabot_*` admin tools, MCP/CLI surface |
| [canvas-server](reference/orchestrator/platform/canvas-server.md)                 | Hocuspocus server, canvas persistence, canvas tools                           |
| [collab-tasks](reference/orchestrator/platform/collab-tasks.md)                   | Agent message posting, task service invariants, wake, check-ins               |
| [internal-api-and-jobs](reference/orchestrator/platform/internal-api-and-jobs.md) | `/internal/*` routes, egress resolve/approval gateway, job queues, webhooks   |
| [scheduler-routines](reference/orchestrator/platform/scheduler-routines.md)       | Distributed cron scan, routine claiming, result delivery                      |
| [scheduler-meetings](reference/orchestrator/platform/scheduler-meetings.md)       | Meeting lifecycle, morning/evening windows, check-ins                         |
| [ssrf-and-realtime](reference/orchestrator/platform/ssrf-and-realtime.md)         | Webhook SSRF checks, realtime broadcast, event catalogue                      |
| [push-usage-plans](reference/orchestrator/platform/push-usage-plans.md)           | Web push/APNs/Expo, usage funnel, plan admission                              |

**Memory — `memory/`** and **Computers — `computers/`**

| Doc                                                                                  | Covers                                                                                                  |
| :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| [memory/overview](reference/orchestrator/memory/overview.md)                         | Cognitive memory architecture, scopes, extraction triggers                                              |
| [memory/scheduler-and-mirror](reference/orchestrator/memory/scheduler-and-mirror.md) | Dream-cycle scheduler, `/home/bot/.saaya/memory/` mirror                                                |
| [memory/tools](reference/orchestrator/memory/tools.md)                               | `remember`/`recall`/`open_loop`/`reflect`/`graph_walk`/`forget`                                         |
| [memory/modules](reference/orchestrator/memory/modules.md)                           | 9 memory modules: beliefs, dream, graph, retrieval, salience, …                                         |
| [computers/boat](reference/orchestrator/computers/boat.md)                           | Boat-hosted Linux desktops: client, provisioning, shell layer                                           |
| [computers/vps-and-client](reference/orchestrator/computers/vps-and-client.md)       | Docker-over-SSH VPS (alias or host + sealed key, one container per bot), sleep policy, computerd client |
| [computers/e2b](reference/orchestrator/computers/e2b.md)                             | E2B cloud sandbox per bot: key, create/resume, shell, screen                                            |

### Landing Site — `docs/reference/landing/`

| Doc                                       | Covers                                                                      |
| :---------------------------------------- | :-------------------------------------------------------------------------- |
| [overview](reference/landing/overview.md) | `apps/landing`: static public site, sections, motion system, download links |

### Web App — `docs/reference/web/`

**Pages & features — `pages/`**

| Doc                                                                       | Covers                                                                                                                      |
| :------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------- |
| [app-overview](reference/web/pages/app-overview.md)                       | Proxy middleware, layouts, workspace shell, PWA/service worker, updates                                                     |
| [auth-flows](reference/web/pages/auth-flows.md)                           | Login/signup/OTP, OAuth, guest→account merge, desktop/mobile handoff                                                        |
| [onboarding](reference/web/pages/onboarding.md)                           | Workspace name form, then the first room                                                                                    |
| [room-chat-ui](reference/web/pages/room-chat-ui.md)                       | Room page, chat panel, composer, messages, threads, approvals UI                                                            |
| [voice-ui](reference/web/pages/voice-ui.md)                               | Take-turns audio call, streaming TTS prefetch, voice notes, dictation                                                       |
| [room-settings-ui](reference/web/pages/room-settings-ui.md)               | Name-only room creation; room settings: agents (ready-made, existing, your app), where each runs, lead agent, tools, people |
| [canvas-ui](reference/web/pages/canvas-ui.md)                             | Yjs/Monaco collaborative canvas, presence, versions, restore                                                                |
| [model-system](reference/web/pages/model-system.md)                       | Model catalog, pickers, accounts, provider keys                                                                             |
| [agents-ui](reference/web/pages/agents-ui.md)                             | Agent roster, creation, profile, connector scopes, testing                                                                  |
| [settings-ui](reference/web/pages/settings-ui.md)                         | All 14 settings pages + settings components                                                                                 |
| [cron-ui](reference/web/pages/cron-ui.md)                                 | n8n-style visual routine canvas                                                                                             |
| [tasks-inbox-meetings-ui](reference/web/pages/tasks-inbox-meetings-ui.md) | Tasks kanban, decision inbox, ask cards, meetings, chats                                                                    |
| [marketplace](reference/web/pages/marketplace.md)                         | MCP app catalog + agent template marketplace                                                                                |
| [analytics-usage-ui](reference/web/pages/analytics-usage-ui.md)           | Usage dashboard, bars, plan rings, pricing                                                                                  |
| [computers-remote-ui](reference/web/pages/computers-remote-ui.md)         | Computer settings, WebRTC remote viewer                                                                                     |
| [search-files-storage](reference/web/pages/search-files-storage.md)       | Message search, files view, storage summary                                                                                 |
| [trace-observability](reference/web/pages/trace-observability.md)         | Run inspector drawer over `agent_runs`/`run_steps`                                                                          |
| [admin-public-pages](reference/web/pages/admin-public-pages.md)           | Admin redirect, member management, public/legal/download pages                                                              |
| [landing-page](reference/web/pages/landing-page.md)                       | Marketing site sections and motion system                                                                                   |
| [ui-shell-and-kit](reference/web/pages/ui-shell-and-kit.md)               | Sidebar, chat list, command palette, UI kit primitives                                                                      |
| [lib-reference](reference/web/pages/lib-reference.md)                     | Remaining `lib/` modules: notify, outbox, bridges, Supabase clients, …                                                      |

**Server actions — `actions/`**

| Doc                                                                               | Covers                                                   |
| :-------------------------------------------------------------------------------- | :------------------------------------------------------- |
| [server-actions-overview](reference/web/actions/server-actions-overview.md)       | Action pattern, `ActionResult`, orchestrator client      |
| [actions-agents-bots](reference/web/actions/actions-agents-bots.md)               | Agent/bot CRUD, bot invites, templates                   |
| [actions-rooms-messages](reference/web/actions/actions-rooms-messages.md)         | Rooms, memberships, message sending, outbox              |
| [actions-connectors-keys](reference/web/actions/actions-connectors-keys.md)       | Connectors, provider keys, vault, vector, MCP servers    |
| [actions-org-computers-misc](reference/web/actions/actions-org-computers-misc.md) | Orgs, invites, profile, facts, memory, computers, phones |
| [billing-and-pricing](reference/web/actions/billing-and-pricing.md)               | Stripe integration, plan gating, pricing                 |
| [email-system](reference/web/actions/email-system.md)                             | Resend client, auth/invite templates                     |

**API routes — `api/`**

| Doc                                                           | Covers                                                                 |
| :------------------------------------------------------------ | :--------------------------------------------------------------------- |
| [api-mobile](reference/web/api/api-mobile.md)                 | `/api/mobile/*`: pairing, push, inbox, upload, usage, models, version  |
| [api-desktop](reference/web/api/api-desktop.md)               | `/api/desktop/*`: host registration, job queue, secrets/MCP delegation |
| [api-webhooks-oauth](reference/web/api/api-webhooks-oauth.md) | Messaging webhooks, billing webhook, OAuth 2.1 server, bot invites     |
| [api-proxy-files](reference/web/api/api-proxy-files.md)       | `/api/v1` proxy, files, providers, sessions, health/version            |
| [api-guard-and-auth](reference/web/api/api-guard-and-auth.md) | Credential classes, `PUBLIC_PATHS`, route guards                       |

### computerd — `docs/reference/computerd/`

| Doc                                                                         | Covers                                                      |
| :-------------------------------------------------------------------------- | :---------------------------------------------------------- |
| [overview](reference/computerd/overview.md)                                 | HTTP surface, NDJSON transport, orchestrator wiring         |
| [lifecycle](reference/computerd/lifecycle.md)                               | Computer state machine, ensure/boot/admit, sleep/sweep      |
| [capacity-and-identity](reference/computerd/capacity-and-identity.md)       | Capacity policy, eviction, proxy-identity HMAC credentials  |
| [docker-runtime](reference/computerd/docker-runtime.md)                     | Docker client, stream demux, resource naming                |
| [backends](reference/computerd/backends.md)                                 | Backend interface, `auto` ranking, hardened Docker spec     |
| [backend-smolvm](reference/computerd/backend-smolvm.md)                     | libkrun microVM backend, socket bridges                     |
| [backend-e2b](reference/computerd/backend-e2b.md)                           | E2B cloud backend: pause/resume, constraints                |
| [agentd](reference/computerd/agentd.md)                                     | In-container daemon: exec, files, env, stats ops            |
| [agentd-files](reference/computerd/agentd-files.md)                         | `isSafePath` confinement, atomic writes, hash-guarded edits |
| [agentd-code-intelligence](reference/computerd/agentd-code-intelligence.md) | In-sandbox code search/definition/rename services           |
| [egress-bridge](reference/computerd/egress-bridge.md)                       | Per-agent egress socket bridging, credential injection      |

### Egress Proxy — `docs/reference/egress/`

| Doc                                                        | Covers                                                               |
| :--------------------------------------------------------- | :------------------------------------------------------------------- |
| [overview](reference/egress/overview.md)                   | Hardened proxy: identity, 9-step pipeline, DNS pinning, IP deny-list |
| [scrub-and-swapper](reference/egress/scrub-and-swapper.md) | In-flight secret swapping, response scrubbing                        |

### Mobile App — `docs/reference/mobile/`

| Doc                                                                  | Covers                                                      |
| :------------------------------------------------------------------- | :---------------------------------------------------------- |
| [overview](reference/mobile/overview.md)                             | App entry, env config, build setup, navigation root         |
| [navigation-and-auth](reference/mobile/navigation-and-auth.md)       | Tab navigation, auth session, guest mode, app lock          |
| [pairing-and-onboarding](reference/mobile/pairing-and-onboarding.md) | QR/deep-link pairing, server checks, onboarding wizard      |
| [home-and-chat](reference/mobile/home-and-chat.md)                   | Home dashboard, room chat, realtime events, terminal drawer |
| [inbox-tasks-usage](reference/mobile/inbox-tasks-usage.md)           | Approval inbox (Allow/Deny/typed), tasks, usage             |
| [computers-and-share](reference/mobile/computers-and-share.md)       | Computers, web viewer, share-target, agent profiles         |
| [push-and-updates](reference/mobile/push-and-updates.md)             | Push registration, action routing, APK update checks        |
| [settings-and-ui-kit](reference/mobile/settings-and-ui-kit.md)       | Settings storage, theming, UI primitives                    |

### Desktop App — `docs/reference/desktop/`

| Doc                                                                         | Covers                                                                          |
| :-------------------------------------------------------------------------- | :------------------------------------------------------------------------------ |
| [overview](reference/desktop/overview.md)                                   | Electron lifecycle, IPC surface, storage, deep links, Mac and Windows packaging |
| [host](reference/desktop/host.md)                                           | Host registration, heartbeat, remote-desktop gating                             |
| [runner-and-stream](reference/desktop/runner-and-stream.md)                 | Local Mac agent runner: job claiming, CLI dispatch, approvals, streaming        |
| [local-agents-and-injector](reference/desktop/local-agents-and-injector.md) | 19 local AI CLI specs, session injection                                        |
| [local-mcp-and-models](reference/desktop/local-mcp-and-models.md)           | Local MCP servers, fail-closed approvals, model discovery                       |
| [install-and-updates](reference/desktop/install-and-updates.md)             | Mac DMG and Windows zip update state machine, verify→swap→rollback              |
| [vault-cli](reference/desktop/vault-cli.md)                                 | Password-manager job fulfillment                                                |
| [usage-and-cloud-handoff](reference/desktop/usage-and-cloud-handoff.md)     | Local plan-usage readers, cloud-home snapshot, copy_to_cloud                    |

### Operations — `docs/reference/operations/`

| Doc                                                                  | Covers                                                         |
| :------------------------------------------------------------------- | :------------------------------------------------------------- |
| [deployment](reference/operations/deployment.md)                     | Dockerfiles, compose services, rolling updates, rollback       |
| [changelog](reference/operations/changelog.md)                       | Release-note conventions, drafting script, tag loop            |
| [nginx-and-cloudflare](reference/operations/nginx-and-cloudflare.md) | Proxy routes, WSS/SSE tuning, Cloudflare tunnel/Workers        |
| [supabase-platform](reference/operations/supabase-platform.md)       | Bundled Supabase: roles, webhooks, realtime, pooler, JWT       |
| [scripts](reference/operations/scripts.md)                           | setup-vps.sh, setup-computers.sh, pinned versions, idempotency |
| [examples](reference/operations/examples.md)                         | `examples/python-bot` HMAC webhooks + streaming                |
| [troubleshooting](reference/operations/troubleshooting.md)           | 9 failure modes tied to exact code paths                       |

### Testing — `docs/reference/testing/`

| Doc                                                             | Covers                                                    |
| :-------------------------------------------------------------- | :-------------------------------------------------------- |
| [overview](reference/testing/overview.md)                       | Test lanes, turbo pipeline, CI jobs, per-workspace counts |
| [unit-testing](reference/testing/unit-testing.md)               | Vitest conventions, mocking patterns, worked examples     |
| [integration-testing](reference/testing/integration-testing.md) | Integration runner, aliases, cross-package suites         |
| [e2e-testing](reference/testing/e2e-testing.md)                 | Playwright config, fixtures, spec-by-spec coverage        |

### CLI — `docs/reference/cli/`

| Doc                                   | Covers                                                              |
| :------------------------------------ | :------------------------------------------------------------------ |
| [overview](reference/cli/overview.md) | `sayabot mcp` stdio bridge, one-shot commands, key and URL handling |

---

## 🧭 Which Guide Do You Need?

### 🚀 [Getting Started & Local Setup](getting-started.md)

Start here if you want to run Sayabot on your local machine. Covers:

- System prerequisites (Node 24, pnpm 10, Docker, Supabase).
- Generating encryption keys (`SAYABOT_KEK` [alias `MESH_KEK`], `ORCHESTRATOR_INTERNAL_SECRET`).
- Supabase project creation, session pooler connection, and authentication config.
- Applying database migrations.
- First sign-in and workspace onboarding wizard.
- Troubleshooting common setup pitfalls.

### 🌐 [Self-Hosting Guide (Definitive Production Manual)](self-hosting.md)

The comprehensive operational guide for hosting Sayabot on your own infrastructure:

- **Ingress pathways**: Automated Single VPS (`deploy/` with `setup-vps.sh` and `deploy.sh`), Cloudflare Zero Trust Tunnels, Tailscale Private Network, Split Cloud (Vercel + Fly.io), and Local Homelab.
- **Database configuration**: Supabase Session Pooler (port 5432) vs Transaction Pooler (6543), migrations, and RLS.
- **Secrets & encryption**: `SAYABOT_KEK` (AES-256-GCM envelope encryption with legacy `MESH_KEK` alias), `ORCHESTRATOR_INTERNAL_SECRET`, and full environment variable dictionary.
- **Networking & WebSockets**: Nginx proxy tuning, Hocuspocus WSS (`/collab`), and unbuffered SSE/NDJSON streaming.
- **Sandboxes & execution**: `computerd` persistent containers/microVMs, headless browser automation, and egress SSRF firewall.
- **Universal MCP Gateway**: Client connection guides for Claude Desktop, Claude Code, Cursor, Windsurf, and ChatGPT.
- **Operations & reliability**: Backups, zero-downtime rolling updates (`deploy.sh`), rollback mechanics, and troubleshooting matrix.

### 📱 [The Self-Hosted Flow: Ask Anywhere, Approve From the Lock Screen](self-hosted-flow.md)

End-to-end setup for running Sayabot as a 24/7 personal agent on your own server:

- **Ingress**: open ports + Let's Encrypt (`SAYABOT_DOMAIN`), or a Cloudflare Tunnel with no open ports (`CLOUDFLARE_TUNNEL_TOKEN`).
- **Phone**: QR pairing, Allow / Don't allow and typed answers from notifications; browser notifications with Allow / Don't allow.
- **Chat ingress**: Telegram, Discord and WhatsApp, with "waiting for your OK" notices in the chat.
- **Automations**: results sent to a chat, plus "routine is done" alerts.
- **Mac + cloud**: Mac tools are skipped when it sleeps, so agents carry on in their cloud computer.
- **Saya AI**: your own provider for every user, set in `.env`. Model changes reach web, phone and Mac with no update.

### 🏛 [Architecture & Monorepo Deep Dive](architecture.md)

Understand how Sayabot works under the hood:

- Complete monorepo directory map (`apps/` and `packages/`).
- The **Turn Coordinator**: how messages trigger agents, acquire room advisory locks, and serialize turns.
- Real-time communication stack: PostgreSQL `LISTEN/NOTIFY`, Supabase Realtime, and Yjs WebSockets.
- Security architecture: AES-256-GCM credential encryption and the Outbound Secret Broker.

### ⏱ [Hermes-Class Cron & Automations](cron-and-automations.md)

Master autonomous scheduling and visual workflows:

- The **n8n-Styled Visual Canvas** (`/[org]/cron`): Trigger Nodes, Agent Brains, and Delivery Nodes.
- Scheduling syntax: natural language shorthands (`daily at 9am`, `every 2h`) and 5-field cron.
- The `cronjob` agent tool: allowing agents to autonomously self-schedule routines.
- Distributed background execution engine with PostgreSQL advisory locks.

### 💬 [Multiplayer Rooms & Human-Agent Collaboration](rooms-and-collaboration.md)

Discover how human teams and autonomous agents co-exist:

- Room turn modes: `mentions` (default), `debate` (structured discussion), and `moderated`.
- **Live Collaborative Canvas**: real-time Yjs CRDT document editing (Markdown Monaco, Code, SVG, HTML).
- **Cognitive agent memory**: hybrid recall, beliefs, dream consolidation, open loops.
- **Task Board & Request Inbox**: task tracking, atomic claiming, blocker reporting (`stuck`), and human decision prompts.
- Danger tool approval gates: asynchronous human verification with push notifications.

### 💻 [Tools, Sandboxes & Browser Automation](tools-and-sandboxes.md)

Explore the execution capabilities of Sayabot agents:

- **Persistent Computer Sandboxes (`computerd`)**: per-agent containers/microVMs backed by smolvm, Docker (optionally gVisor), or E2B.
- **Browser Automation**: navigation, DOM snapshotting, clicking, typing, and screenshot extraction.
- **Multi-Provider Web Search & Fetch**: DuckDuckGo, Tavily, Exa, SearXNG, Brave, Serper, Firecrawl, Perplexity, Bing with SSRF hardening.
- Complete reference catalog of all built-in tools.

### 🔗 [Workspace Connectors & Enterprise Integrations](connectors.md)

Connect enterprise systems of record with zero-trust security:

- **Two-Tier Architecture**: Organization-level credential vaults (`workspace_connectors`) decoupled from agent grants (`agent_connector_grants`).
- **Cryptographic Security**: AES-256-GCM envelope encryption with `SAYABOT_KEK` (legacy alias `MESH_KEK`), zero token leakage, and PostgreSQL RLS.
- **Provider Guides**: Setup for **Slack**, **Google Drive**, **GitHub**, **Discord**, **Telegram**, **WhatsApp**, and password-manager vaults (1Password, Bitwarden, Proton Pass).
- **Fine-Grained Scopes**: Enforce channel, folder, repo, and read-only boundaries per agent.
- **Retry & Backoff**: `fetchWithRetry` with `Retry-After` parsing, exponential backoff, and jitter.
- **Complete Tool Catalog**: reference specs for connector agent tools.

### 🔌 [Universal MCP & Bring Your Own Bot](mcp-and-connectors.md)

Connect any AI tool or external client:

- Exposing Sayabot to **ChatGPT**, **Claude Desktop**, **Claude Code**, **Cursor**, **Windsurf**, and **Gemini CLI** via the MCP endpoint.
- Connecting external MCP servers to Sayabot rooms with encrypted header vaults.
- Reference Python external bot implementation with Standard Webhooks signature verification.

### 🚢 [Production Deployment](deployment.md)

Deploy Sayabot to high-availability environments:

- Single-node VPS deployment with Docker Compose, automated VPS setup (`setup-vps.sh`), Nginx, and Let's Encrypt (`init-letsencrypt.sh`).
- Managed cloud setups: Supabase hosted, AWS/GCP container services, and background workers.
- Environment variable configuration reference.

### 🧪 [Testing & Quality Verification](testing.md)

Run the automated test suites:

- 200+ test files across all packages (`Vitest`).
- End-to-end testing with Playwright (`pnpm e2e`).
- Monorepo typechecking with Turborepo (`pnpm typecheck`).

---

## 🛠 Developer & Contributor Manuals

### 🤖 [AI Coding Agent Operational Manual](../AGENTS.md)

Mandatory high-priority manual for AI coding assistants (Claude, Cursor, Copilot, Antigravity, Codex, Hermes):

- **Monorepo Directory Map**: In-depth anatomical breakdown of `apps/`, `packages/`, and `deploy/`.
- **Exact pnpm & Turbo Commands**: Filtered commands for dev, build, typecheck, migrations, and tests.
- **Five Golden Architectural Rules**:
  1. _Never hardcode or leak secrets_: AES-256-GCM envelope encryption with `SAYABOT_KEK` / `MESH_KEK` (`@sayabot/llm`).
  2. _Never bypass room PostgreSQL advisory locks_: Deterministic serialization with `withRoomLock()`.
  3. _Database changes MUST follow Drizzle schemas_: Table definitions in `packages/db/src/schema/` and SQL migrations.
  4. _Dangerous tools MUST pass human approval gates_: Asynchronous human-in-the-loop gates in `toAuditedTools`.
  5. _Persistent sandboxes run isolated and confined to `/home/bot`_: Confinement enforced via `isSafePath()`.
- **§9 Documentation Maintenance**: any code change MUST update the matching `docs/reference/` doc in the same change.
- **Adding a New Tool / Connector**: step-by-step tutorials.
- **Testing & Linting Conventions**: Strict Prettier, ESLint, and Vitest testing patterns.

### 🤝 [Human Contributor Guide](../CONTRIBUTING.md)

The complete guide for human developers contributing to Sayabot:

- **Local Machine Setup**: Node 24, pnpm 10, Docker, and Supabase configuration.
- **Branch Naming**: Conventional prefixes (`feat/`, `fix/`, `docs/`, `refactor/`, `test/`).
- **Conventional Commits**: Commit message format (`type(scope): description`) with recognized scopes.
- **Code Style & Formatting**: Prettier (`semi: false`, `singleQuote: false`, `printWidth: 100`) and ESLint guidelines.
- **Documentation Standards**: reference docs must be updated in the same PR as the code change.
- **Pull Request Lifecycle**: Pre-flight verification checklist and review process.
- **AI Agent Co-Authorship**: Transparent disclosure policy when using AI coding assistants.

### 📋 [GitHub Community & Issue Templates](../.github/)

Standardized GitHub issue forms and PR templates:

- **[Bug Report Form](../.github/ISSUE_TEMPLATE/bug_report.yml)**: Structured bug submission with component dropdowns, reproduction steps, and system logs.
- **[Feature Request Form](../.github/ISSUE_TEMPLATE/feature_request.yml)**: Feature proposals with architectural impact and user stories.
- **[Connector Request Form](../.github/ISSUE_TEMPLATE/connector_request.yml)**: Proposals for new enterprise connectors (API auth, scopes, danger ratings).
- **[Documentation Request Form](../.github/ISSUE_TEMPLATE/documentation.yml)**: Documentation fixes, improvements, and missing guides.
- **[Pull Request Template](../.github/pull_request_template.md)**: Comprehensive PR checklist covering migrations, tests, security audits, and AI disclosure.
