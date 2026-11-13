# Tools, Sandboxes & Browser Automation

Sayabot gives agents an extensive catalog of **40+ built-in tools**, ranging from persistent Linux environments and headless Chromium browser automation to multi-engine web search, code intelligence, and atomic task tracking.

This reference guide documents the sandbox architecture, browser capabilities, search providers, and the complete tool catalog.

---

## 🏗️ Execution Architecture & Capabilities

Agents in Sayabot can be granted granular capabilities in their Agent Settings (`/[org]/agents/[handle]`):

```typescript
export interface AgentCapabilities {
  canvas: boolean        // Live shared canvas reading and patching
  sandbox: boolean       // Ephemeral code execution sandbox
  computer?: {           // Persistent Linux sandbox (Docker)
    profile: "standard" | "browser"
  }
  webSearch: boolean     // Multi-engine search and page scraping
  github: boolean        // GitHub issue and PR management
  postgres: boolean      // PostgreSQL schema inspection and queries
  tasks: boolean         // Task board CRUD and atomic claiming
  secrets: boolean       // Secret broker placeholder consumption
  memory: boolean        // Multi-tier personal, room, and org memory
  cron: boolean          // Background routine scheduling
  subagents: boolean     // Parallel subagent delegation
  mcp: boolean           // Connect external Model Context Protocol servers
}
```

---

## 💻 Persistent Linux Sandboxes (`computerd`)

When an agent is configured with the `computer` capability, Sayabot allocates a dedicated, persistent Docker container powered by the `computerd` daemon.

### Key Characteristics:
- **Persistent Disk**: Files placed in `/home/bot` persist across chat sessions, reboots, and routine runs.
- **Real-Time Shell Streaming**: Standard output and error streams are chunked and broadcast to the room in real time.
- **Safety Auditing**: Destructive commands (`rm -rf /`, formatting commands) trigger human approval gates before execution.

### How computers are allocated

Every agent gets **its own computer** — its own machine and its own disk — on whichever
backend the host can run. `COMPUTER_BACKEND=auto` (the default) picks the strongest one available:

| Backend | Isolation | Runs on | Sleep when idle | Egress |
| :--- | :--- | :--- | :--- | :--- |
| **`smolvm`** | microVM with its own kernel ([smolvm](https://github.com/smol-machines/smolvm), libkrun) | Apple-silicon Mac, Linux with `/dev/kvm` | VM stopped, disk kept, ~1 s boot | **No network.** A per-agent socket into Saaya egress; computerd adds the agent's proxy credential on the host side |
| **`docker`** | container, optionally **gVisor** (`COMPUTER_DOCKER_RUNTIME=runsc`, no KVM needed) | any Docker host, incl. small VPSes | container stopped, volume kept | `botnet` → egress, identified by container IP |
| **`e2b`** | E2B cloud microVM (Firecracker) | anywhere with `E2B_API_KEY` — nothing runs locally | E2B pause (memory + disk kept), resumed on next call | direct internet; `$SECRET{...}` placeholders are **not** substituted |

Which one to use:

- **Mac (Apple silicon), no Docker:** `brew install smol-machines/tap/smolvm` — `auto` picks it.
  Point `SMOLVM_IMAGE` at a registry ref or a `docker save` tarball of `saaya/computer`.
- **VPS or server with KVM** (bare metal, or a VPS with nested virtualization):
  `sudo deploy/scripts/setup-computers.sh` installs a pinned, checksum-verified smolvm and prints the settings.
- **VPS without KVM** (most small cloud VPSes): the same script installs gVisor and registers it with Docker.
- **A machine too small to host computers at all:** `COMPUTER_BACKEND=e2b` with `E2B_API_KEY`.

What every backend shares — the lifecycle in `apps/computerd/src/lifecycle.ts`:

| Mechanism | Behaviour |
| :--- | :--- |
| **Concurrency cap** | At most `COMPUTER_MAX_RUNNING` computers run at once. `auto` fits `COMPUTER_MEM_FRACTION` (0.6) of host memory at `COMPUTER_MEM_MB` (1024) each — doubled for smolvm, whose guest memory is elastic — or `E2B_MAX_RUNNING` (20) on e2b. |
| **Sleep when idle** | No call for `COMPUTER_IDLE_MS` (10 min) puts the computer to sleep. The next tool call wakes it. |
| **LRU eviction** | At the cap, the least recently used computer idle for `COMPUTER_EVICT_GRACE_MS` (60 s) sleeps to admit a new one. Computers used more recently (an agent mid-turn) are never evicted; the request waits up to `COMPUTER_ADMIT_TIMEOUT_MS` (60 s), then fails with HTTP 503. |
| **Wake and retry** | A computer stopped behind computerd's back (OOM, reboot, manual stop) is woken and the call retried once. |
| **Egress identity** | Docker: computerd resets egress's cached IP → agent mapping whenever a computer starts or stops, so a reused IP is never attributed to its previous owner. smolvm: identity is a per-agent proxy credential derived by computerd (`COMPUTERD_PROXY_KEY`, default the internal secret) that never enters the VM; the orchestrator stores only its hash. |

`GET /v1/capacity` on computerd shows the backend, the cap, running computers and their idle time.

#### Fast path to agentd

On smolvm and Docker, computerd reaches agentd over a Unix socket (smolvm: exposed from the VM;
Docker: a per-container subpath of the private `saaya-agentd` volume, so computerd stays off
`botnet`). A call costs about a millisecond. Otherwise computerd falls back to running the
pre-bundled `agentd-cli.mjs` (`docker exec`, `smolvm machine exec`, or E2B commands); large
requests are split across arguments or passed as a file, so 2 MB file writes work on every path.
Docker's fast path is off when computerd runs directly on your computer, under gVisor, or on
Docker Engine older than 26 (API 1.45).

#### Deploying with docker compose

`deploy/deploy.sh` builds `saaya/computer` whenever `computerd` is in `MESH_APP_SERVICES`
(previously nothing built it, so computers failed with "No such image"). With
`COMPUTER_BACKEND=smolvm` it also exports the image for smolvm and adds
`deploy/docker-compose.smolvm.yml`, which gives computerd `/dev/kvm` and the host's `/opt/smolvm`.

### Linux Shell & File Tools

#### 1. `computer_shell`
Executes foreground shell commands in the persistent `/home/bot` container.
- **Parameters**: `command` (string), `cwd` (optional, defaults to `/home/bot`), `timeoutSeconds` (default: 60s, max: 300s).
- **Output**: `stdout`, `stderr`, `exit_code`, `duration_ms`.

#### 2. `fs_read`
Reads UTF-8 text files with line numbering and strict pagination.
- **Features**: Generates a 64-character SHA-256 hash of the full file to guard against stale edits; limits pages to 2,000 lines or 256 KB.
- **Parameters**: `path`, `startLine` (1-based), `endLine`, `maxBytes`.

#### 3. `fs_edit`
Performs atomic, hash-guarded literal text replacements.
- **Why it matters**: Prevents the common LLM failure mode of hallucinating or truncating large files.
- **Parameters**: `path`, `oldString`, `newString`, `expectedHash` (from `fs_read`), `replaceAll` (boolean), `whitespace` (boolean fallback for line-ending differences).

#### 4. `fs_write`
Creates or replaces complete files up to 2 MB.
- **Parameters**: `path`, `content`.

#### 5. `fs_glob` & `fs_grep`
High-speed filesystem search tools.
- `fs_glob`: Searches for filenames matching glob patterns (e.g. `**/*.tsx`), sorted newest first.
- `fs_grep`: Powered by **ripgrep (`rg`)** inside the container; searches patterns across thousands of files with line numbers.

#### 6. `computer_publish`
Allows an agent to publish any file from its `/home/bot` filesystem directly into the room's shared Canvas workspace as a live Markdown, Code, SVG, or HTML document!

---

## 🧠 Code Intelligence Tools

For TypeScript and JavaScript projects, Sayabot provides AST-backed compiler language service tools:

| Tool | Action | Description |
| :--- | :--- | :--- |
| **`code_outline`** | Outline | Returns AST-derived declarations (classes, functions, interfaces) with container names and ranges. |
| **`code_definition`** | Definition | Resolves any symbol at `line:column` to its exact definition file and location. |
| **`code_references`** | References | Locates all semantic references across the project, including write-access markers. |
| **`code_diagnostics`** | Diagnostics | Returns compiler-level syntax and semantic type errors without running full builds. |
| **`code_rename_preview`** | Refactor | Previews a semantic identifier rename across the entire codebase prior to execution. |

---

## 🌐 Headless Chromium Browser Automation (CDP)

When an agent is configured with the `browser` computer profile, `computerd` launches a headless Chromium instance controlled via the Chrome DevTools Protocol (CDP).

```
┌────────────────────────────────────────────────────────┐
│  🌐 Headless Chromium CDP Sandbox                       │
├────────────────────────────────────────────────────────┤
│  1. `browser_open`       -> Navigate to target URL     │
│  2. `browser_snapshot`   -> Retrieve accessibility tree│
│  3. `browser_click`      -> Click element by ref/CSS   │
│  4. `browser_type`       -> Fill inputs & submit forms │
│  5. `browser_extract`    -> Extract Markdown/HTML/text │
│  6. `browser_screenshot` -> Capture PNG preview        │
└────────────────────────────────────────────────────────┘
```

### Browser Tool Reference

- **`browser_open`**: Navigates to any valid URL (`url: string`).
- **`browser_snapshot`**: Returns a structured accessibility tree with numerical element references (e.g., `[12] Button: Sign In`, `[14] Input: Email`).
- **`browser_click`**: Clicks interactive elements using their accessibility ref number or CSS selector (`ref?: string | number`, `selector?: string`).
- **`browser_type`**: Types text into an element with optional form submission (`ref`, `selector`, `text`, `submit: boolean`).
- **`browser_extract`**: Extracts clean text, markdown, or HTML from the current page up to 100,000 characters.
- **`browser_screenshot`**: Takes a high-resolution PNG screenshot and stores it in `/home/bot/.saaya/screens/` with visual preview.

---

## 🔍 Multi-Provider Web Search & Fetch

Sayabot agents can search the web and extract content using multiple backend providers configurable in **Org Settings** (`/[org]/settings/tools`).

### Supported Search Providers

| Provider | Type | API Key Required? | Description |
| :--- | :--- | :--- | :--- |
| **DuckDuckGo** | Free | ❌ No | Out-of-the-box, keyless search with zero cost. Default fallback. |
| **TinyFish** | Free | Optional | Browser-rendered search, news, and academic research search API. |
| **SearXNG** | Self-Hosted | ❌ No | Connects to any self-hosted private SearXNG meta-search instance. |
| **Tavily** | AI Search | ✅ Yes | Optimized specifically for LLM agent research and entity extraction. |
| **Exa** | Neural Search | ✅ Yes | Semantic vector and embedding-based web search. |
| **Brave Search** | Search API | ✅ Yes | Independent index with high privacy guarantees. |
| **Serper** | Google API | ✅ Yes | High-speed Google Search API with knowledge graph results. |
| **Firecrawl** | Web Scraper | ✅ Yes | Deep crawling and clean Markdown extraction engine. |
| **Perplexity** | AI Engine | ✅ Yes | Synthesized AI answers with source citations. |
| **Bing** | Search API | ✅ Yes | Microsoft Bing search index. |

### Web Content Extraction (`web_fetch`)
When an agent visits a search result or URL, `web_fetch` parses the target page through a readability pipeline:
- Strips ads, navigation headers, cookie banners, and trackers.
- Converts HTML to clean, readable Markdown.
- **SSRF Hardened**: Automatically rejects private subnets, cloud metadata addresses (`169.254.169.254`), and local loopback interfaces.

---

## 📊 Complete Built-in Tools Reference Catalog

| Tool Name | Category | Dangerous? | Summary |
| :--- | :--- | :---: | :--- |
| `computer_shell` | Sandbox | ⚠️ Yes (if destructive) | Execute bash commands in `/home/bot` with live output streaming. |
| `fs_read` | Filesystem | No | Read text file page with numbered lines and full SHA-256 hash. |
| `fs_edit` | Filesystem | No | Atomic, hash-guarded string replacement. |
| `fs_write` | Filesystem | No | Create or overwrite files up to 2 MB. |
| `fs_glob` | Filesystem | No | Fast glob pattern matching for filenames. |
| `fs_grep` | Filesystem | No | Ripgrep text search across files with line numbers. |
| `computer_publish` | Canvas | No | Publish a file from container disk to shared Room Canvas. |
| `browser_open` | Browser | No | Navigate headless Chromium to a URL. |
| `browser_snapshot` | Browser | No | Extract accessibility tree and element reference IDs. |
| `browser_click` | Browser | No | Click an interactive element by reference or selector. |
| `browser_type` | Browser | No | Type text into an input field with optional submission. |
| `browser_extract` | Browser | No | Extract clean Markdown or text from the current page. |
| `browser_screenshot` | Browser | No | Capture viewport or full-page PNG screenshot. |
| `code_outline` | Code Intelligence | No | AST declaration outline (classes, functions, types). |
| `code_definition` | Code Intelligence | No | Jump to definition location for any symbol. |
| `code_references` | Code Intelligence | No | Find semantic references across the project. |
| `code_diagnostics` | Code Intelligence | No | TypeScript compiler errors and warnings. |
| `code_rename_preview`| Code Intelligence | No | Preview semantic refactoring renames. |
| `git_status` | Version Control | No | Working tree status (`git status -s`). |
| `git_diff` | Version Control | No | Inspect staged or unstaged git diffs. |
| `git_commit` | Version Control | ⚠️ Yes | Commit changes with message. |
| `git_push` | Version Control | ⚠️ Yes | Push commits to remote repository via Secret Broker. |
| `web_search` | Research | No | Query web search engines (DuckDuckGo, Tavily, Exa, etc.). |
| `web_fetch` | Research | No | Read and convert web page content into Markdown. |
| `canvas_read` | Canvas | No | Read snapshot of shared room canvas document. |
| `canvas_write` | Canvas | No | Write or overwrite shared room canvas document. |
| `canvas_patch` | Canvas | No | Apply unified diff patch to shared room canvas. |
| `tasks_list` | Task Board | No | List room tasks and filter by status. |
| `tasks_create` | Task Board | No | Create a new task on the room board. |
| `tasks_claim` | Task Board | No | Atomically claim a task for the calling agent. |
| `tasks_update` | Task Board | No | Update task status (`in_progress`, `stuck`, `done`). |
| `tasks_stuck` | Task Board | No | Flag a blocker and request human assistance. |
| `memory_save` | Memory | No | Store fact in personal, room, or org memory scope. |
| `memory_recall` | Memory | No | Semantic vector and keyword search across memory stores. |
| `memory_delete` | Memory | No | Delete outdated memory items. |
| `cronjob` | Scheduling | No | Autonomous background routine management (`create`, `list`, etc.). |
| `update_plan` | Engine V2 | No | Update structured execution plan visible to users. |
| `spawn_subagent` | Engine V2 | No | Spawn isolated subagent for parallel deep research. |
| `skill_teach` | Skills | No | Teach agent a reusable skill procedure. |
| `use_secret` | Security | No | Access encrypted credential placeholder. |
| `postgres_inspector` | Database | No | Inspect database schemas and tables. |
| `github_issue` | Connectors | No | Create and inspect GitHub issues and pull requests. |
