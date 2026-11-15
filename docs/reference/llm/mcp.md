# MCP Client Gateway

`src/mcp.ts` is Sayabot's gateway to external MCP (Model Context Protocol) servers. One call — `connectMcpServers(configs)` — connects every configured server (over HTTP, SSE or stdio), discovers their tool catalogs, renames the tools into a single collision-free namespace, and returns an AI SDK-compatible `ToolSet` the agent loop can execute, plus the metadata the approval gate needs. The design goals are determinism (same configs → same tool names), fail-closed isolation (a broken server never disturbs the healthy ones), and hard timeouts on every operation.

Source files: `packages/llm/src/mcp.ts` (367 lines), `packages/llm/src/mcp.test.ts`

---

## 🧾 Server configuration

```typescript
export interface McpServerConfig {
  id: string                          // unique per connect call
  name: string
  transport: "http" | "sse" | "stdio"
  url: string                         // non-stdio
  headers?: Record<string, string>    // e.g. a bearer token for "static"-auth servers
  command?: string                    // stdio: local programs only
  args?: string[]
  env?: Record<string, string>
  authProvider?: OAuthClientProvider  // sign-in servers: bearer token + 401 refresh (see mcp-oauth.md)
  dangerousTools: string[]            // tool names that wait for a person's OK
}
```

(`packages/llm/src/mcp.ts:7-25`.) `dangerousTools` patterns:

- An exact tool name gates that tool.
- `"*"` gates **every** tool on the server.
- `"@writes"` gates every tool whose name does not start with a read verb — for catalog apps whose tool names are not known ahead of time. The read-verb regex (`mcp.ts:27`) is `^(get|list|search|read|fetch|find|lookup|view|describe|retrieve|show|whoami|count|preview|download)(_|-|$|[A-Z])`.

```typescript
export function isDangerousMcpTool(dangerousTools: string[], toolName: string): boolean
```

(`mcp.ts:30-34`.) Tested in `mcp-oauth.test.ts`: `@writes` lets `search`, `get_page`, `list-issues`, `getIssue`, `fetch_doc`, `read_file` through and gates `create_page`, `update_issue`, `delete_doc`, `send_email`, `execute_sql` (and even `listen`, `getaway`).

---

## 🔌 Connecting: `connectMcpServers`

```typescript
export async function connectMcpServers(
  servers: McpServerConfig[],
  options: McpConnectionOptions = {},
): Promise<McpToolsResult>
```

Timeout budgets (`McpConnectionOptions`, `mcp.ts:61-67`; defaults at `mcp.ts:167-169`): `timeoutMs` = **15 s** per-server startup (DNS, initialization, all tool-list pages), `callTimeoutMs` = **30 s** per tool call, `closeTimeoutMs` = **2 s** per client close. Values must be integers in `[1, 60000]` or `budget()` throws "Invalid MCP timeout budget". Every operation runs inside `bounded()`, which races the SDK call against an abort timer — so even a transport that never settles after cancellation is bounded (`mcp.ts:90-109`).

### Validation, before any client is created

Per server (`mcp.ts:217-231`):

- **Duplicate or empty `id`s are rejected** ("Duplicate or empty MCP server ID") — same transport strings outside `http|sse|stdio` are rejected too.
- **URL protocol**: HTTPS required; plain HTTP only when `ALLOW_LOCAL_MCP=true` (env). `ftp:`, `file:`, non-URLs all fail.
- **No credentials or fragment in the URL** (`user:pass@`, `#fragment`).
- **SSRF check**: unless `ALLOW_LOCAL_MCP`, `assertSafeEgressHost(url.hostname)` from `@sayabot/core/server` must pass (the egress allowlist blocks private/metadata addresses; mocked in tests to pin that it is checked even under `NODE_ENV=test`).

### stdio transport is catalog-only

`stdioTransport()` (`mcp.ts:143-163`) refuses anything that is not the fixed catalog pattern: `command` must be exactly `npx`, `args` must start with `["-y", <package>]` where the package matches `/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/`, and extra args may not be flags or contain whitespace — "This local app isn't one Sayabot can start". The child env inherits only `PATH` and `HOME` plus `server.env` entries whose keys match `/^[A-Z][A-Z0-9_]{0,40}$/`. stderr is ignored. The transport is loaded dynamically from `@ai-sdk/mcp/mcp-stdio`.

### Discovery

Servers connect **concurrently** so startup costs the slowest server, not the sum (pinned by a test measuring peak concurrency). For each connected client (`mcp.ts:259-286`):

- Tools are listed **page by page** (`nextCursor`), with dedupe: duplicate or empty tool names throw "MCP returned duplicate or empty tool names"; more than **1,000** tools throw "MCP tool catalog exceeds limit"; a repeated cursor or more than **100** pages throws "MCP tool pagination exceeds limit".
- Definitions are sorted by name; `client.toolsFromDefinitions()` builds SDK tool objects.
- Initialization passes `maxRetries: 0` and an initialization signal; `onUncaughtError` marks the server failed, removes its tools and closes the client.

Any per-server failure is recorded in `errors` (`{ serverName, message }`) and that server is closed — healthy servers remain available ("Fail individual servers closed", `mcp.ts:165`).

### Tool naming

```typescript
export function mcpToolName(serverName: string, toolName: string): string
// slug(server) + "__" + sanitized(tool), max 64 chars
```

(`mcp.ts:77-81`.) `"GitHub" + "list_issues"` → `github__list_issues`; `"My Server" + "Get-Item"` → `my_server__Get-Item`; non-ASCII or overlong names are sanitized/truncated to `/^[a-zA-Z0-9_-]{1,64}$/`.

Collisions (two servers with the same slug, or tools that sanitize to the same name, including `__proto__`/`constructor`) are resolved deterministically: candidates are ordered preferring an *unchanged legacy* name, then by server name, id, and original tool name; each subsequent collision gets a deterministic 12-char SHA-256 suffix (`mcp.ts:333-352`). A test pins that reordering the input configs yields identical `tools` keys and `meta`, and that a server advertising a tool literally named like a generated suffix cannot steal the reserved name.

### Result

```typescript
export interface McpToolsResult {
  tools: ToolSet                 // AI SDK tools; execute() routes to the owning server
  meta: Record<string, McpToolMeta>
  errors: { serverName: string; message: string }[]
  call: (serverId, toolName, args, signal?) => Promise<unknown>  // raw-text convenience path
  close: () => Promise<void>
}

export interface McpToolMeta {
  serverId: string
  serverName: string
  originalName: string
  dangerous: boolean             // from server.dangerousTools via isDangerousMcpTool
  annotations?: McpToolAnnotations  // display-only server claims
}
```

(`mcp.ts:36-59`.) Annotations (`title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are sanitized — strings truncated to 200 chars, only those five keys kept, unrecognized keys like `approval` dropped — and **never** used to grant permissions or waive approval: `dangerous` comes only from the configured `dangerousTools` (`mcp.ts:111-120`, and the test "propagates only recognized annotations without changing configured dangerousTools").

---

## ▶️ Calling tools

`callRaw` (`mcp.ts:305-331`) is the single execution path (both `tools[name].execute` and the `call()` helper route through it):

- The tool must be currently **discovered** on a connected server, otherwise "MCP server/tool is not connected".
- The call runs under `bounded(...)` with `callTimeoutMs`, combined with the caller's abort signal.
- The result's `content` array is flattened by `textContent()` (`mcp.ts:122-141`): `text` parts join with `\n`; `resource` parts contribute their `resource.text` or `[resource <uri>]`; unknown parts become `[<type>]`. Malformed responses throw "Invalid MCP tool response".
- `isError: true` → `McpToolError` with the flattened text ("A tool reported failure via `isError`; the server connection is still healthy").

Fail-closed vs. keep-alive (`mcp.ts:322-330`):

| Outcome | Connection |
| :-- | :-- |
| `McpToolError` (tool-level `isError`) | **Kept** — a failed operation says nothing about the transport |
| Caller cancelled only (`callSignal.aborted && !signal.aborted`) | **Kept** — cancelling one request says nothing about the server |
| Transport rejection, malformed response, timeout | **Removed and closed**; later calls throw "not connected" |

Lifecycle: `close()` aborts the lifetime signal (ending all in-flight calls), closes every client within `closeTimeoutMs`, and is idempotent (returns the same promise). An external `options.signal` close triggers the same path (`mcp.ts:196-210`). Tests pin: closing twice closes the client once; closing aborts an active call; a pre-aborted external signal never starts SDK work or egress checks.

---

## 🧪 Test coverage (`mcp.test.ts`)

The suite mocks `@ai-sdk/mcp` (`createMCPClient`) and `assertSafeEgressHost`:

| Suite | Pins |
| :-- | :-- |
| Naming | `mcpToolName` slugification; deterministic sorted tool order regardless of input order; collision suffixes stable across runs and reorderings; suffix names cannot steal reserved common names; annotations sanitized without touching `dangerousTools` |
| Discovery | Paged listing carries `params.cursor` and `options: { timeout, maxTotalTimeout }` matching the budget; initialization signal + `maxRetries: 0`; duplicate / repeated-cursor / >1000-tool catalogs fail closed with the client closed exactly once |
| Network validation | `http://`, `ftp://`, `file://`, `user:pass@`, `#fragment`, `not-a-url` all rejected before `createMCPClient`; SSRF checked (even in tests); transport `redirect: "error"`; `ALLOW_LOCAL_MCP=true` permits `http://localhost` only — never non-HTTP protocols; unsupported transports and duplicate ids rejected |
| Lifecycle | Discovery failures close the bad client and keep good ones; raw args forwarded, text/resource results joined (`"one\ntwo\n[image]"`); undiscovered tool names refused without touching the SDK; `isError` keeps the server connected; concurrent connection (peak 3); rejection/malformed closes the client; direct SDK `execute` guarded with cancellation propagation without dropping the server; `onUncaughtError` closes; startup/listing/call/close all bounded under fake timers; close aborts active calls; pre-cancelled signal does no work |

---

## 🔗 Where the orchestrator plugs in

`apps/orchestrator/src/tools/index.ts:1-13` imports `connectMcpServers`, `findLocalApp`, `isDangerousMcpTool`, `mcpToolName`, plus the OAuth helpers, and at turn time:

1. Loads enabled `mcp_servers` rows for the org/room, decrypts `headers_enc` for static-auth servers or builds a `StoredMcpOAuthProvider` from `oauth_enc` for sign-in servers (refreshing tokens on 401 and re-sealing the state).
2. For desktop-type catalog apps, routes the connection through the user's desktop app instead of connecting directly.
3. Calls `connectMcpServers(configs)`; for each `meta` entry marks the tool dangerous (`dangerous: true` in the ToolSpec sense) when `meta.dangerous` is set, so destructive MCP tools pass the human approval gate (Golden Rule 4).

The `mcp_servers` table (`packages/db/src/schema/tools.ts:16-47`) stores `transport`, `url`, `headers_enc`, `auth_kind` ("static" | "oauth"), `oauth_enc`, `auth_status` ("ok" | "pending" | "signed_out"), `dangerous_tools` (text array), and a `tool_cache` of the last tools/list.

---

## Related docs

- [mcp-oauth.md](./mcp-oauth.md) — the `authProvider` passed into these configs
- [copilot-and-local-apps.md](./copilot-and-local-apps.md) — the fixed local-app catalog stdio configs come from
- [crypto.md](./crypto.md) — sealing `headers_enc` / `oauth_enc`
- [overview.md](./overview.md) — package map
