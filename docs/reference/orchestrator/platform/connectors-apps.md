# Connected Apps (Composio)

The connected-apps connector reaches the whole Composio catalog — Gmail, Google Calendar, Slack, Notion, Linear, HubSpot, Jira, Stripe and the thousand-odd toolkits Composio maintains — through one workspace API key. This is how Sayabot offers the long tail of integrations without shipping a client per vendor: the person connects their own account once, and an agent runs that vendor's tools as them, under a grant that limits which apps and whether writes are allowed. The architecture pairs Composio toolkits with per-agent app scopes on top of Sayabot's tier-1/tier-2 security model.

Source files: `apps/orchestrator/src/connectors/composio.ts`, `apps/orchestrator/src/connectors/service.ts`, `apps/orchestrator/src/tools/builtins/connectors.ts`, `apps/web/src/lib/connectors/probe.ts`, `apps/web/src/lib/actions/connectors.ts`

---

## 🔑 Credential and configuration (`composio.ts`)

One `workspace_connectors` row with `source: "composio"`:

| Field            | Meaning                                                                                                   |
| :--------------- | :-------------------------------------------------------------------------------------------------------- |
| token (sealed)   | Composio project API key, sent as `x-api-key`                                                             |
| `config.baseUrl` | Optional API origin for a self-hosted Composio project; defaults to `https://backend.composio.dev/api/v3` |
| `config.userId`  | Optional Composio user id; defaults to `org:<orgId>`                                                      |

`userId` is what ties connected accounts to a workspace: the default keeps every org's Gmail/Calendar connections separate with no extra table, and changing it disconnects everything connected before. The settings form warns about that.

`ComposioConnector` (`composio.ts`) wraps five endpoints:

| Method                                                          | Endpoint                             | Returns                                                     |
| :-------------------------------------------------------------- | :----------------------------------- | :---------------------------------------------------------- |
| `toolkits({ limit, search })`                                   | `GET /toolkits`                      | `{ slug, name, description }` per app                       |
| `tools({ toolkit, search, limit })`                             | `GET /tools?toolkit_slug=…`          | `{ slug, name, description }` per tool                      |
| `connectedAccounts({ userId })`                                 | `GET /connected_accounts?user_ids=…` | `{ id, toolkit, status }`                                   |
| `execute({ toolSlug, userId, arguments, connectedAccountId? })` | `POST /tools/execute/{tool_slug}`    | the tool's `data`; `successful: false` or an `error` throws |
| `connectLink({ toolkit, userId })`                              | `POST /connected_accounts/link`      | the sign-in URL a person opens                              |

Failures surface as `Composio <path> failed (<status>): <first 200 chars>` — the API key is only ever in a header, so the message is safe to show.

## 🎫 Scopes

`ConnectorScopeConfig.allowedApps` is the per-agent allow-list of toolkit slugs (`["gmail", "googlecalendar"]`); empty means every app. `readOnly` blocks writes.

Read/write classification is derived from the tool slug, because Composio names tools `<TOOLKIT>_<VERB>_<OBJECT>` and a toolkit can be several words (`GOOGLE_ANALYTICS_BATCH_RUN_REPORTS`): a tool counts as a read when any segment after the first is a read verb (`GET`, `LIST`, `SEARCH`, `READ`, `FETCH`, `FIND`, `LOOKUP`, `VIEW`, `DESCRIBE`, `RETRIEVE`, `SHOW`, `WHOAMI`, `COUNT`, `PREVIEW`, `DOWNLOAD`, `QUERY`). Everything else is a write. `isReadOnlyComposioTool()` in `composio.ts` owns that rule.

App matching for execution treats the granted app as a slug prefix: with `allowedApps: ["gmail"]`, `GMAIL_FETCH_EMAILS` passes and `NOTION_CREATE_PAGE` is refused before any request is made.

## 🛠️ Tools

| Tool                    | Dangerous | Behavior                                                                                                                     |
| :---------------------- | :-------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `composio_list_apps`    | no        | `listComposioApps` — catalog (filtered to the grant) with each app's `connected` flag and account status                     |
| `composio_search_tools` | no        | `searchComposioTools` — one app's tools, each flagged `write: true/false`                                                    |
| `composio_execute_tool` | **yes**   | `executeComposioTool` — runs the slug as the workspace Composio user; refused by `readOnly` for writes, and by `allowedApps` |
| `composio_connect_app`  | **yes**   | `connectComposioApp` — returns the sign-in link for an app that is not connected yet                                         |

`composio_connect_app` is dangerous because it hands the person a link that grants account access; `composio_execute_tool` is dangerous because every tool call acts on a real account, and reads are what `readOnly` grants are for.

### Curated convenience app mappings

Common convenience shortcuts for the two apps bots reach for most map directly to standard Composio slugs, available through `composio_execute_tool`:

| Convenience shortcut            | Composio slug                       |
| :------------------------------ | :---------------------------------- |
| `gmail.search_emails`           | `GMAIL_FETCH_EMAILS`                |
| `gmail.read_email`              | `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID` |
| `gmail.read_email_thread`       | `GMAIL_FETCH_MESSAGE_BY_THREAD_ID`  |
| `gmail.create_draft`            | `GMAIL_CREATE_EMAIL_DRAFT`          |
| `gmail.list_drafts`             | `GMAIL_LIST_DRAFTS`                 |
| `gmail.read_draft`              | `GMAIL_GET_DRAFT`                   |
| `gmail.update_draft`            | `GMAIL_UPDATE_DRAFT`                |
| `gmail.send_email`              | `GMAIL_SEND_EMAIL`                  |
| `googlecalendar.list_events`    | `GOOGLECALENDAR_EVENTS_LIST`        |
| `googlecalendar.list_calendars` | `GOOGLECALENDAR_LIST_CALENDARS`     |

They are not registered as separate Sayabot tools on purpose: `composio_search_tools` reports the live slugs and their arguments, so a renamed or newly added vendor tool cannot leave a stale wrapper behind, and every call still passes through one approval gate.

## 🧪 Tests

`tests/integration/connector-turn.test.ts` proves the same four tools inside a real engine turn: `composio_list_apps` appears in the provider's tool list, its result returns to the model, and `composio_execute_tool` / `composio_connect_app` only run after a `pending_approval` row is approved.

`tests/integration/connector-dispatch.test.ts` proves the four tools are actually reachable by the agent: they are registered by `buildTools` for a granted `composio` connector with the right `dangerous` flags, and `composio_execute_tool` / `composio_connect_app` run through `toAuditedTools` only after a `pending_approval` row is approved — with the stub still receiving `user_id: "org:<orgId>"`, `allowedApps` still refusing an ungranted app, and a `readOnly` grant still blocking `GMAIL_SEND_EMAIL`.

`tests/integration/connectors-stub.test.ts` drives the four tools against a stub Composio API through the real grant path: catalog + account status, tool search with write flags, an execution whose body carries `user_id: "org:<orgId>"`, a connect link, an `allowedApps` refusal that issues no request, and a `readOnly` grant that refuses `GMAIL_SEND_EMAIL` while `GMAIL_FETCH_EMAILS` still runs. `apps/web/tests/integration/connector-probe.test.ts` covers the settings "Check connection" call (`x-api-key` header, app count in the detail line).

---

Related docs:

- [Connector platform](./connector-platform.md) — `ConnectorService`, credential decryption, grant lookup
- [Connector tools](../tools/tool-connectors.md) — the full agent-facing tool surface and its danger flags
- [Content & knowledge connectors](./connectors-content.md) — the native GitHub/Drive/password-manager clients
- [Marketplace](../../web/pages/marketplace.md) — sign-in MCP apps, the other way to add third-party tools
