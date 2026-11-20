# GitHub Copilot Provider & Local MCP Apps

Two smaller modules round out the provider layer: `src/copilot.ts` is the GitHub Copilot token broker — Sayabot's `copilot` provider is GitHub Copilot's chat API reached with a saved GitHub sign-in — and `src/local-apps.ts` is the fixed catalog of MCP apps that are local programs rather than websites. Both exist to keep credentials and process launch constrained: only the GitHub token (sealed like any key) is stored, and only the seven catalog programs can ever be started.

Source files: `packages/llm/src/copilot.ts` (117 lines), `packages/llm/src/copilot.test.ts`, `packages/llm/src/local-apps.ts` (130 lines), `packages/llm/src/local-apps.test.ts`

---

## 🤖 `src/copilot.ts` — the Copilot token broker

The Copilot chat API does not accept the GitHub token itself: each call needs a short-lived Copilot token (about 30 minutes) that GitHub hands out for an account with an active Copilot plan (`packages/llm/src/copilot.ts:1-9`). Sayabot stores only the GitHub token — sealed, like any key — and swaps it for a Copilot token here, just before a call, reusing it until a minute before expiry.

### Constants

| Export              | Value                                                                                                                                                        | Purpose                                                                                   |
| :------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| `COPILOT_TOKEN_URL` | `https://api.github.com/copilot_internal/v2/token`                                                                                                           | Where the exchange happens (`copilot.ts:11`)                                              |
| `COPILOT_API_BASE`  | `https://api.githubcopilot.com`                                                                                                                              | The chat API base the registry uses as the provider's default base URL (`copilot.ts:12`)  |
| `COPILOT_HEADERS`   | `Copilot-Integration-Id: vscode-chat`, `Editor-Version: vscode/1.96.2`, `Editor-Plugin-Version: copilot-chat/0.22.4`, `User-Agent: GitHubCopilotChat/0.22.4` | "The client identity Copilot's chat API expects alongside the token" (`copilot.ts:15-20`) |

Timing constants: `REFRESH_MARGIN_MS = 60_000` (reuse the cached token until 1 minute before it expires) and `TIMEOUT_MS = 10_000` for the token request.

### Helpers

- `isGitHubToken(value)` (`copilot.ts:34-36`) — true for GitHub OAuth (`gho_`), app user (`ghu_`), personal (`ghp_`) and fine-grained (`github_pat_`) tokens. Anything else is passed through as-is, so a key that is _already_ a Copilot token works without an exchange.
- `isCopilotBaseUrl(baseUrl)` (`copilot.ts:39-46`) — true when the URL's hostname **ends with** `githubcopilot.com` (covers `api.individual.githubcopilot.com` too). The registry uses this to turn a stored `openai-compatible` row pointing at Copilot's API into a proper Copilot client with the custom fetch.
- `CopilotAuthError extends Error` (`copilot.ts:48`) — thrown when GitHub refuses the token or the account has no Copilot plan; the message never includes the token.
- `clearCopilotSessions()` (`copilot.ts:113-116`) — empties the caches (tests, or after a key is removed).

### `copilotSessionToken(githubToken, options?)`

(`copilot.ts:54-96`.) The exchange, cached:

```mermaid
flowchart TD
    A[githubToken] -->|not a gh* token| B[return as-is, no fetch]
    A -->|gho_/ghu_/ghp_/github_pat_| C[cache key = SHA-256 of token]
    C --> D{cached and expires at<br/>more than 60s away?}
    D -->|yes| E[return cached token]
    D -->|no| F{exchange already in flight?}
    F -->|yes| G[share that promise]
    F -->|no| H[POST-less GET COPILOT_TOKEN_URL<br/>authorization: token &lt;gh token&gt;<br/>+ COPILOT_HEADERS, 10s timeout]
    H -->|401/403/404| I[drop cache, throw CopilotAuthError<br/>"Check that its Copilot plan is active, then connect it again."]
    H -->|other non-OK| J[throw CopilotAuthError "GitHub answered HTTP …"]
    H -->|ok| K[cache token until expires_at<br/>default 20 min when absent]
```

Caching is keyed by the **SHA-256 hash of the GitHub token** — "By a hash of the GitHub token, so the token itself is never a map key" (`copilot.ts:30`). Concurrent requests for the same token share one in-flight promise (`inflight` map, `copilot.ts:66-95`). `expires_at` is epoch **seconds** and converted to ms; when GitHub omits it, a 20-minute lifetime is assumed.

### `copilotFetch(githubToken, baseFetch?)`

(`copilot.ts:102-110`.) The fetch factory the registry injects into `createOpenAICompatible` for the `copilot` provider (and for `openai-compatible` rows whose base URL is Copilot's). For every API call it:

1. Obtains (or reuses) a Copilot session token via `copilotSessionToken`.
2. Overwrites `authorization` with `Bearer <copilotToken>` — "whatever Authorization the SDK set from the saved key".
3. Sets all four `COPILOT_HEADERS`.
4. Delegates to the base fetch.

So the stored GitHub credential never reaches Copilot's API, and the Copilot token never reaches Sayabot's database.

### Test coverage (`copilot.test.ts`)

| Test                                                                             | Pins                                                                                                                                                                    |
| :------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `swaps a GitHub token for a Copilot token and reuses it until it nearly expires` | Two calls share one fetch; request carries `authorization: "token gho_secret"`; after advancing the clock 29.5 minutes (past the 60 s margin) a second exchange happens |
| `passes a token that is not a GitHub token through untouched`                    | `"tid=already-copilot"` returned with zero fetches                                                                                                                      |
| `explains a refused account without echoing the token`                           | 404 → `CopilotAuthError`; the rejection message does not contain `topsecret`                                                                                            |
| `signs each API call with the Copilot token and Copilot's client headers`        | After `copilotFetch("ghu_secret")`, the chat call carries `authorization: Bearer tid=xyz` and `copilot-integration-id: vscode-chat`                                     |
| `recognises Copilot base URLs`                                                   | `api.githubcopilot.com` and `api.individual.githubcopilot.com/` true; `openrouter.ai` and `null` false                                                                  |

---

## 📦 `src/local-apps.ts` — local MCP app catalog

MCP apps that are a program rather than a website. The module header states the security model plainly (`local-apps.ts:1-6`): **the command list is fixed — a saved row never gets to choose what runs**. `server` apps start next to the orchestrator; `desktop` apps run on a computer where the Sayabot desktop app is open (they need local files or an account signed in there).

### The catalog

`LOCAL_APPS` is a `readonly LocalApp[]` with exactly seven entries (`local-apps.ts:27-117`):

| id                | Name          | Category     | Where   | Command                                 | Env required                               | dangerousTools |
| :---------------- | :------------ | :----------- | :------ | :-------------------------------------- | :----------------------------------------- | :------------- |
| `airtable`        | Airtable      | data         | server  | `npx -y airtable-mcp-server`            | `AIRTABLE_API_KEY`                         | `["@writes"]`  |
| `brave-search`    | Brave Search  | search       | server  | `npx -y @brave/brave-search-mcp-server` | `BRAVE_API_KEY`                            | `[]`           |
| `resend`          | Resend        | automation   | server  | `npx -y resend-mcp`                     | `RESEND_API_KEY`                           | `["@writes"]`  |
| `firecrawl-local` | Firecrawl CLI | search       | server  | `npx -y firecrawl-mcp`                  | `FIRECRAWL_API_KEY`                        | `["@writes"]`  |
| `obsidian`        | Obsidian      | knowledge    | desktop | `npx -y obsidian-mcp-server`            | `OBSIDIAN_API_KEY` (Local REST API plugin) | `["@writes"]`  |
| `paper`           | Paper         | design       | desktop | `paper mcp`                             | —                                          | `["@writes"]`  |
| `apple-apps`      | Apple apps    | productivity | desktop | `npx -y mcp-icloud`                     | —                                          | `["@writes"]`  |

Each row also carries `tagline`, `docs` (a documentation URL), `color` (a hex for the marketplace card) and, where present, an `env` descriptor `{ name, label, help }` that tells the person where to get the key (e.g. Airtable: "Include the bases this workspace may use"; Obsidian: "Leave the Sayabot app open on that computer").

### Lookup and launch

```typescript
export function findLocalApp(id: string | null | undefined): LocalApp | null // BY_ID map
export function localAppArgv(app: LocalApp): string // "npx -y <pkg>" or "paper mcp"
```

(`local-apps.ts:119-129`.) `localAppArgv` is described as "What the desktop app is willing to start. Anything else is refused, even if the server asked." The desktop app parses this string and nothing else — a database row cannot inject a different binary or flags.

The `dangerousTools: ["@writes"]` values flow into `McpServerConfig.dangerousTools`, where `isDangerousMcpTool` ([mcp.md](./mcp.md)) turns every non-read tool into a human-approval-gated one. Brave Search is the only app whose tools are all considered reads.

### Integration points

- The web marketplace renders the catalog from `LOCAL_APPS` (`apps/web/src/lib/marketplace.ts`, imported via the `@sayabot/llm/local-apps` subpath so the browser bundle gets the pure data module).
- The orchestrator's tool builder calls `findLocalApp(catalogApp)` for `mcp_servers` rows created from the marketplace, converts the row into a `McpServerConfig` with `transport: "stdio"`, `command`/`args` from the catalog entry, and `dangerousTools` from the catalog — `apps/orchestrator/src/tools/index.ts:3-13`. Desktop apps are proxied through the user's desktop host (`runMcpOnDesktop`).
- The stdio launcher in `mcp.ts` double-checks the same `npx -y <package>` shape, so even a hand-edited row cannot start anything else.

### Test coverage (`local-apps.test.ts`)

One test, `only starts the seven fixed programs` (`local-apps.test.ts:5-19`):

- The ids must be exactly `["airtable", "brave-search", "resend", "firecrawl-local", "obsidian", "paper", "apple-apps"]` — adding or reordering the catalog fails the test loudly.
- Every `localAppArgv` line must start with `npx -y ` or equal `paper mcp`, and must contain none of `;&|` $` — no shell metacharacters can ever reach a spawn.

---

## Related docs

- [mcp.md](./mcp.md) — how local-app stdio configs are validated and connected
- [registry-and-models.md](./registry-and-models.md) — where `copilotFetch` and `isCopilotBaseUrl` plug into the provider registry
- [crypto.md](./crypto.md) — how the stored GitHub token is sealed at rest
- [overview.md](./overview.md) — package map
