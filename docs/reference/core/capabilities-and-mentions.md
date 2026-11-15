# Capabilities & Mention Extraction

These two small modules answer the two questions the orchestrator asks about every message: **what is this agent allowed to do** (`capabilities.ts`) and **which agents is this message talking to** (`mentions.ts`). Both are pure: capabilities parsing turns untrusted JSON from the `agents.capabilities` column into a validated flag set, and mention extraction turns raw message text into an ordered list of `AgentRef`s that the turn planner consumes.

Source files: `packages/core/src/capabilities.ts` (95 lines), `packages/core/src/mentions.ts` (45 lines); tests: `packages/core/src/capabilities.test.ts`, `packages/core/src/mentions.test.ts`

---

## 🧩 `AgentCapabilities` and defaults

The interface has 14 flags (`capabilities.ts:3-18`) — 13 booleans plus the `computer` slot, which is either `false` or an object naming the sandbox profile:

```typescript
export interface AgentCapabilities {
  canvas: boolean      // live shared canvas read/patch tools
  tasks: boolean       // task board CRUD & atomic claiming
  sandbox: boolean     // ephemeral code-execution sandbox
  webSearch: boolean   // multi-engine search & page scraping
  document: boolean    // document tools
  github: boolean      // GitHub issue/PR tools
  postgres: boolean    // PostgreSQL schema inspection & queries
  mcp: boolean         // external MCP servers
  computer: false | { profile: "standard" | "browser" }
  secrets: boolean     // secret broker (`use_secret`)
  memory: boolean      // personal/room/org memory
  subagents: boolean   // parallel subagent delegation
  cron: boolean        // background routine scheduling
  connectors: boolean  // workspace connectors (Drive/Slack/GitHub/Jira/Notion)
}
```

**`DEFAULT_CAPABILITIES`** (`capabilities.ts:20-35`) enables everything **except** `computer` and `secrets` — those two are the high-privilege toggles an operator must switch on deliberately. This default set is also the single source of truth for `packages/db/src/schema/agents.ts` and the seed script, which import the type and the constant, so a fresh agent row in PostgreSQL stores exactly this shape as JSON.

## 🛡️ Two validation paths

### 1. `agentCapabilitiesSchema` (Zod)

`capabilities.ts:37-59` builds a strict-ish Zod object where every boolean **defaults to the default value** and `computer` is `z.union([z.literal(false), z.object({ profile: z.enum(["standard", "browser"]) })]).default(false)`. Parsing a partial object fills in the rest; unknown keys are stripped by default Zod object behaviour. Use this when you want schema-validated input (forms, API bodies).

### 2. `parseCapabilities(input: unknown): AgentCapabilities` (lenient)

The workhorse used by the orchestrator (`apps/orchestrator/src/tools/index.ts:225`, both context builders, and `engine/run.ts`). It never throws:

| Input | Result |
| :--- | :--- |
| `null`, `undefined`, non-object (`"string"`, numbers, arrays) | a fresh copy of `DEFAULT_CAPABILITIES` |
| Object | per-key copy: `typeof raw.key === "boolean" ? raw.key : DEFAULT_CAPABILITIES.key` |
| `raw.computer` an object with `profile` exactly `"standard"` or `"browser"` | `{ profile }` |
| Anything else for `computer` (including truthy junk) | `false` |

Unknown keys are ignored (the test asserts `parsed.unknownKey === undefined`), and an invalid `computer` silently degrades to `false` rather than disabling the whole agent. Note the asymmetry with the Zod schema: `parseCapabilities` treats *missing* keys as defaults and *invalid* keys as defaults too, whereas Zod would fail on a bad type unless you call `.safeParse`.

The web app reuses the same interface for the agent settings page (`apps/web/src/app/(workspace)/[org]/agents/[agentId]/page.tsx`) and the server actions that save agents and templates (`apps/web/src/lib/actions/agents.ts`, `actions/templates.ts`), so the UI, the API, and the tool builder all validate through one module.

### Where capabilities live at rest

`packages/db` types the `capabilities` jsonb column with `AgentCapabilities` and uses `DEFAULT_CAPABILITIES` as the **column default** (`packages/db/src/schema/agents.ts:61`: `jsonb("capabilities").$type<AgentCapabilities>().notNull().default(DEFAULT_CAPABILITIES)`); the templates schema and the seed script do the same. The stored JSON is exactly the interface's shape, which is why the lenient parser exists: older rows written before a new flag was added are missing keys, and `parseCapabilities` back-fills them from the current defaults without a migration.

A typical consumer round-trip:

```typescript
import { parseCapabilities } from "@sayabot/core"

// agent.capabilities is `unknown` jsonb straight from PostgreSQL
const caps = parseCapabilities(agent.capabilities)
// caps is a complete AgentCapabilities — every key present, unknown keys dropped,
// computer downgraded to `false` unless profile is "standard" | "browser"
```

## 🚪 How capabilities gate tools downstream

`buildTools()` in `apps/orchestrator/src/tools/index.ts` first runs `const caps = parseCapabilities(args.agent.capabilities)` (`tools/index.ts:225`) and then conditionally spreads each tool factory into the spec list. The mapping:

| Capability | Gates |
| :--- | :--- |
| `connectors` | the connector tool bundle (`tools/index.ts:232`) |
| `canvas` | `canvas_read` / `canvas_write` / `canvas_patch` (`:331`) |
| `sandbox && !computer` | ephemeral sandbox tools (`:338`) — the sandbox tools are *replaced* by the computer bundle when a persistent sandbox is granted |
| `webSearch` | `web_search` / `web_fetch` (`:344`) |
| `document` | document tools (`:350`) |
| `github`, `postgres`, `tasks`, `secrets`, `memory`, `cron` | the correspondingly named builtin tools (`:353-389`) |
| `computer` | the `computer_*` / `fs_*` bundle plus, on engine V2, verification and workspace tools carrying the chosen `profile` (`:363-378`) |
| `subagents` | `spawn_subagent`, and only in combination with the V2 engine check at `:405` |
| `mcp` | MCP server tools (`:423`) |

Two details worth knowing:

- **Dynamic danger**, not capability, drives approval: the `ToolSpec.dangerous` flag decides the human-approval gate (see the top-level docs), while capabilities decide *inclusion*. A capability never bypasses the approval gate.
- The `document !== false` check at `:350` means the document tool appears unless the flag is explicitly `false` — a distinction `parseCapabilities` makes moot by filling defaults, but which shows the defensive style used.

The web app reads the same interface for the agent settings UI, and `@sayabot/db` stores the JSON column typed as `AgentCapabilities` — change the interface here and both sides compile-fail until updated.

## 📝 Mention extraction (`mentions.ts`)

### `extractHandles(text: string): string[]`

Scans text for `@handle` tokens and returns them **lowercased and de-duplicated in order of first appearance** (`mentions.ts:8-21`). The regex is:

```typescript
const MENTION_RE = /(^|[^\w@])@([a-zA-Z][\w-]{0,38})/g
```

Anatomy of the pattern:

| Piece | Purpose |
| :--- | :--- |
| `(^|[^\w@])` | The char before `@` must be line start, or a non-word char that is **not** another `@` — this is what rejects emails (`a@b.com`) and double-`@` escapes (`@@nope`) |
| `@` | The literal mention sigil |
| `[a-zA-Z]` | Handles must start with a letter (no `@1`, `@_x`) |
| `[\w-]{0,38}` | Word chars and hyphens after, capped so the handle is at most 39 chars |

Before matching, the text has fenced code blocks (```` ```…``` ```` → stripped via ```` /```[\s\S]*?```/g ````) and inline code (`` `…` ``) removed, so code samples never summon bots — the test pins `"ping @alice\n```\n@bob …\n```\nand `@carol` inline"` resolving to only `alice`.

### `resolveMentions(text, roomAgents): AgentRef[]`

Maps raw handles onto the room roster (`mentions.ts:27-45`):

- Lookup is case-insensitive against `agent.handle.toLowerCase()`.
- `@all_bots` (the `ALL_BOTS_HANDLE` constant) expands to **every room agent in room order** at the position it appears.
- Unresolved handles are silently dropped — `@dave` when no `dave` is in the room queues nobody.
- Dedup is by agent `id`, so `@alice and @all_bots` yields alice once then the rest of the roster.

### Worked example

Given a room roster `alice`/`bob` (both `kind: "llm"`) and `carol` (`kind: "external"`) — the exact roster the tests use — external webhook bots resolve identically to LLM agents; only `AgentRef.kind` differs:

| Message text | `resolveMentions` result |
| :--- | :--- |
| `"@carol @alice"` | `[carol, alice]` — mention order preserved, external kind irrelevant |
| `"@alice and @all_bots"` | `[alice, bob, carol]` — `@all_bots` expands in roster order, alice already queued |
| `"@dave @bob"` | `[bob]` — dave is not a room agent and is dropped |
| `"mail a@b.com or @@nope"` | `[]` — not mentions |

The result feeds `planMentionsTurn`/`planDebateTurns` directly (see [./turns.md](./turns.md)), and the web app calls `extractHandles` when persisting a message to fill its `mentions` array (`apps/web/src/lib/message-send.ts:59`) — the same array the external-bot webhook payload carries.

## ✅ What the tests cover

`capabilities.test.ts`:

- `DEFAULT_CAPABILITIES` equals the exact expected 14-key object (all true except `computer: false`, `secrets: false`).
- `parseCapabilities(null | undefined | "string" | {})` all fall back to defaults.
- Valid overrides are preserved (`webSearch: false`, `secrets: true`, `computer: { profile: "browser" }`) while unknown keys are dropped.
- `agentCapabilitiesSchema.safeParse({ canvas: false, computer: { profile: "standard" } })` succeeds and fills `github: true` by default.

`mentions.test.ts`:

- Order + dedupe + lowercase: `"@Bob then @alice then @BOB"` → `["bob", "alice"]`.
- Mentions inside fenced and inline code are ignored.
- Emails and `@@nope` are not mentions.
- `resolveMentions` preserves mention order, expands `@all_bots` without duplicates, and ignores handles that are not room agents.

Related docs: [./turns.md](./turns.md), [./commands.md](./commands.md), [./overview-and-types.md](./overview-and-types.md), [./patch-and-fold-key.md](./patch-and-fold-key.md), [./asks.md](./asks.md)
