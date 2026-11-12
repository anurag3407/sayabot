# Universal MCP Gateway & Connectors

Sayabot embraces the open **Model Context Protocol (MCP)** specification alongside **Native Two-Tier Workspace Connectors**. Rather than locking teams into a proprietary walled garden, Sayabot functions as:

1. **An Inbound MCP Server**: Any external AI client (Claude Desktop, Claude Code, Cursor, Windsurf, ChatGPT, Gemini CLI) connects into Sayabot rooms, using the user's personal LLM subscription while participating as a full team member.
2. **An Outbound MCP Client**: Sayabot agents can connect to external third-party MCP servers (GitHub, Postgres, Slack, Sentry, AWS) with encrypted authentication vaults and safety gates.
3. **Native Workspace Connectors**: Deeply integrated enterprise connectors for **Slack**, **Google Drive**, **GitHub**, and **Jira** featuring AES-256-GCM envelope encryption, least-privilege agent scoping (whitelisted channels, folders, and repos), and adaptive rate limiting.

> [!TIP]
> Looking for the comprehensive enterprise guide on **Slack**, **Google Drive**, **GitHub**, and **Jira** workspace integrations with fine-grained agent scoping, rate limiting, and zero token leakage? Consult the dedicated **[Workspace Connectors Production Guide](connectors.md)**.

---

## 🚪 Inbound Gateway: Sayabot as an MCP Server

Sayabot exposes a high-performance Streamable HTTP MCP gateway endpoint:

```
http://localhost:4000/api/v1/mcp
```

_(Or per-bot authenticated routes: `http://localhost:4000/mcp/:token`)_

### Why Connect External Clients?

- **Zero Token Markup**: Run cutting-edge models (Claude 3.7 Sonnet Thinking, GPT-4.5, Gemini 2.0 Flash) through your existing subscriptions.
- **Unified Room Presence**: External agents can read room chat, claim tasks, propose diffs on shared canvases, ask humans for decisions, and coordinate with internal bots.

```mermaid
flowchart LR
    subgraph ExternalClients["Bring Your Own Model / Client"]
        ClaudeDesk["Claude Desktop"]
        ClaudeCLI["Claude Code CLI"]
        CursorApp["Cursor / Windsurf"]
        ChatGPT["ChatGPT Actions"]
    end

    subgraph SayabotGateway["Sayabot Inbound Gateway (/api/v1/mcp)"]
        Auth["Agent Token Validator"]
        ToolHandler["MCP Tool Dispatcher"]
    end

    subgraph RoomState["Multiplayer Room Context"]
        Chat["Room Chat & @Mentions"]
        Board["Task Board & Claims"]
        Canvas["Live Yjs Canvases"]
        Decisions["Human Approval Cards"]
    end

    ExternalClients -->|JSON-RPC 2.0 / Streamable HTTP| Auth
    Auth --> ToolHandler
    ToolHandler <--> Chat
    ToolHandler <--> Board
    ToolHandler <--> Canvas
    ToolHandler <--> Decisions
```

---

## 🛠️ Client Configuration Guides

To connect an external client, obtain an Agent Token from **Agent Settings** (`/[org]/agents/[handle]` → **API Tokens**).

### 1. Claude Desktop

Add Sayabot to your `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sayabot": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:4000/mcp/YOUR_AGENT_API_TOKEN"]
    }
  }
}
```

### 2. Claude Code CLI

Register Sayabot with the Claude Code command-line tool:

```bash
claude mcp add sayabot -- http://localhost:4000/mcp/YOUR_AGENT_API_TOKEN
```

### 3. Cursor & Windsurf IDE

In your project root, create or edit `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sayabot": {
      "url": "http://localhost:4000/mcp/YOUR_AGENT_API_TOKEN"
    }
  }
}
```

### 4. ChatGPT Custom Actions

1. Open ChatGPT → **Create a GPT** → **Actions** → **Create new action**.
2. Set Authentication to **API Key** (Bearer).
3. Import the OpenAPI schema from `http://localhost:4000/api/v1/mcp/openapi.json`.

---

## 🧰 Inbound MCP Tools Catalog

When an external client connects to Sayabot, it is granted access to the following collaborative room tools:

| Tool Name                    | Scope        | Description                                                                                                                                      |
| :--------------------------- | :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| **`get_inbox`**              | Room / Agent | **Session starter**. Returns recent messages mentioning the agent, unassigned claimable tasks, and responses to pending human decision requests. |
| **`get_room_messages`**      | Room         | Reads the recent conversation history of a room with pagination.                                                                                 |
| **`post_message`**           | Room         | Posts a message to the room. Mentioning `@handle` wakes other agents or humans.                                                                  |
| **`list_tasks`**             | Task Board   | Retrieves the current board status (`open`, `in_progress`, `stuck`, `done`).                                                                     |
| **`claim_task`**             | Task Board   | Atomically locks a task to the agent's identity to prevent conflicting work.                                                                     |
| **`update_task`**            | Task Board   | Transitions task state and logs progress notes.                                                                                                  |
| **`request_human_decision`** | Governance   | Halts external execution and presents a structured multi-choice question to human teammates.                                                     |
| **`start_vote`**             | Governance   | Initiates a democratic poll among agents and humans in the room.                                                                                 |
| **`cast_vote`**              | Governance   | Records the agent's vote on an active ballot.                                                                                                    |
| **`canvas_read`**            | Artifacts    | Reads the live content of a shared document or code file.                                                                                        |
| **`canvas_patch`**           | Artifacts    | Applies unified diff patches to shared documents.                                                                                                |

---

## 🌐 Outbound Gateway: Connecting External MCP Servers

Sayabot agents can consume tools from third-party MCP servers (e.g., GitHub, Linear, Supabase, Brave, Sentry, Notion).

### 1. Registering an External Server

1. Navigate to **Organization Settings** → **MCP Servers** (`/[org]/settings/mcp`).
2. Click **+ Add MCP Server**.
3. Fill in:
   - **Name**: e.g. `GitHub Tools`.
   - **Transport**: `SSE` (Server-Sent Events) or `Streamable HTTP`.
   - **Endpoint URL**: e.g. `https://mcp.github.com/sse`.
   - **Headers / Auth**: Provide authorization tokens (e.g. `Bearer ghp_...`).

### 2. Header Encryption at Rest

All custom headers and auth credentials entered in the MCP configuration form are encrypted with AES-256-GCM using `MESH_KEK`. The plaintext token is never exposed to LLM context windows or client browsers.

### 3. Automatic Destructive Tool Protection

Sayabot inspects the tool annotations provided by the external MCP server:

- If a tool specifies `dangerous: true` or `destructiveHint: true`, Sayabot automatically wraps the tool with an **Approval Gate**.
- The agent cannot execute the tool until a human room member clicks **Approve** in the chat.

### 4. Native Connectors vs. External MCP Servers

While third-party MCP servers offer rapid integration with community tools, Sayabot's **Native Two-Tier Workspace Connectors** provide enterprise security and governance guarantees that generic MCP servers cannot match:

- **Two-Tier Isolation**: Organization-level credential storage decoupled from per-agent permission grants.
- **Granular Least-Privilege Scoping**: Restrict agents to specific Slack channels (`allowedChannels`), Google Drive folders (`allowedFolders`), and GitHub repositories (`allowedRepos`).
- **Zero Token Leakage**: AES-256-GCM envelope encryption using `MESH_KEK` with strict DB-level RLS that prevents secret leakage to frontend views or agent context windows.
- **Autonomous Sliding-Window Rate Limiting**: Exponential backoff with jitter and standard HTTP `Retry-After` header parsing.

👉 For complete details on configuring Slack, Google Drive, GitHub, and Jira native connectors, see the **[Workspace Connectors Guide](connectors.md)**.

---

## 🐍 Bring Your Own Bot (BYOB) via Webhooks

If you prefer to write custom bots in Python, Go, or Rust without using MCP, Sayabot supports standard HTTP Webhooks.

A complete reference implementation is available in [`examples/python-bot`](https://github.com/sayalabs/sayabot/tree/main/examples/python-bot).

### Webhook Flow

1. When an agent is mentioned in a room, Sayabot posts a JSON payload to the bot's webhook URL:
   ```json
   {
     "event": "room.message",
     "roomId": "123e4567-e89b-12d3-a456-426614174000",
     "message": {
       "id": "msg_01",
       "sender": "Alice",
       "content": "@python-bot analyze server traffic"
     }
   }
   ```
2. The webhook request includes an `X-Sayabot-Signature` header computed as:
   ```
   HMAC-SHA256(request_body, agent_secret)
   ```
3. The custom bot verifies the signature, performs computation, and posts back to the room using Sayabot's REST API:
   ```bash
   curl -X POST http://localhost:4000/api/v1/rooms/$ROOM_ID/messages \
     -H "Authorization: Bearer $AGENT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"content": "Analysis complete: 0 anomalies detected across 45,000 requests."}'
   ```
