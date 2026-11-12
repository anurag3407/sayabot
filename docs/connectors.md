# Workspace Connectors & Enterprise Knowledge Integrations: The Definitive Production Guide

Sayabot provides a native, two-tier enterprise knowledge connector architecture that bridges autonomous AI agents with company systems of record—including **Slack**, **Google Drive**, **GitHub**, and **Jira**.

Rather than granting AI agents unfettered or direct access to organization-wide API keys, Sayabot enforces a strict **zero-trust separation of privileges**:

1. **Tier 1 (Workspace Level)**: Organization administrators authenticate corporate services once. Credentials are encrypted at rest with military-grade AES-256-GCM envelope encryption using the workspace Master Key (`MESH_KEK`).
2. **Tier 2 (Agent Scoping)**: Each individual agent must receive an explicit grant (`agent_connector_grants`) restricting its query visibility to whitelisted Slack channels, Google Drive folder hierarchies, or GitHub repositories.

Plaintext tokens are **never exposed to LLM context windows, client browsers, or database read replicas**. Outbound external API calls are protected by adaptive sliding-window rate limiters with jittered exponential backoff.

---

## Table of Contents

1. [Architecture & System Topology](#1-architecture--system-topology)
   - [The Two-Tier Least-Privilege Model](#the-two-tier-least-privilege-model)
   - [End-to-End System Flow](#end-to-end-system-flow)
2. [Cryptographic Security & Envelope Encryption](#2-cryptographic-security--envelope-encryption)
   - [AES-256-GCM with `MESH_KEK`](#aes-256-gcm-with-mesh_kek)
   - [Zero Token Leakage Guarantee](#zero-token-leakage-guarantee)
   - [PostgreSQL Row Level Security (RLS) & Sanitized Public Views](#postgresql-row-level-security-rls--sanitized-public-views)
   - [Outbound Secret Redaction & SSRF Hardening](#outbound-secret-redaction--ssrf-hardening)
3. [Step-by-Step Provider Setup Guides](#3-step-by-step-provider-setup-guides)
   - [Slack Connector](#slack-connector)
   - [Google Drive Connector](#google-drive-connector)
   - [GitHub Connector](#github-connector)
   - [Jira & Atlassian Cloud Connector](#jira--atlassian-cloud-connector)
4. [Fine-Grained Agent Scoping (Tier-2 Access Control)](#4-fine-grained-agent-scoping-tier-2-access-control)
   - [The Grant Resolution Engine](#the-grant-resolution-engine)
   - [Google Drive Folder Sub-tree Scoping](#google-drive-folder-sub-tree-scoping)
   - [Slack Channel Ingestion & Thread Boundaries](#slack-channel-ingestion--thread-boundaries)
   - [GitHub Repository Scoping](#github-repository-scoping)
   - [Read-Only Enforcement & Mutation Safeguards](#read-only-enforcement--mutation-safeguards)
5. [Sliding-Window Provider Rate Limiting & Backoff](#5-sliding-window-provider-rate-limiting--backoff)
   - [Resilience Strategy (`fetchWithRetry`)](#resilience-strategy-fetchwithretry)
   - [Parsing Standard `Retry-After` Headers](#parsing-standard-retry-after-headers)
   - [Preventing Thundering Herd via Randomized Jitter](#preventing-thundering-herd-via-randomized-jitter)
6. [Complete Connector Tool Catalog](#6-complete-connector-tool-catalog)
   - [`gdrive_search`](#gdrive_search)
   - [`gdrive_read_file`](#gdrive_read_file)
   - [`slack_search`](#slack_search)
   - [`slack_read_thread`](#slack_read_thread)
   - [`slack_send_message`](#slack_send_message)
   - [`github_search_code`](#github_search_code)
   - [`github_get_file`](#github_get_file)
   - [`github_get_issue_or_pr`](#github_get_issue_or_pr)
7. [UI Management & Database Schemas](#7-ui-management--database-schemas)
   - [PostgreSQL DDL & Drizzle Schemas](#postgresql-ddl--drizzle-schemas)
   - [Web UI Administration (`/[org]/settings/connectors`)](#web-ui-administration-orgsettingsconnectors)
   - [Agent Grant Wizard (`/[org]/agents/[handle]`)](#agent-grant-wizard-orgagentshandle)
   - [Live Diagnostics & Connection Health Testing](#live-diagnostics--connection-health-testing)
   - [Audit Logging & Compliance Ledger](#audit-logging--compliance-ledger)
8. [Extending Connectors: Developer Guide](#8-extending-connectors-developer-guide)
   - [Step 1: Update Supported Sources](#step-1-update-supported-sources)
   - [Step 2: Implement the Provider Client](#step-2-implement-the-provider-client)
   - [Step 3: Register in ConnectorService](#step-3-register-in-connectorservice)
   - [Step 4: Expose Built-in Tool](#step-4-expose-built-in-tool)
9. [Comprehensive Troubleshooting Matrix](#9-comprehensive-troubleshooting-matrix)
10. [Verification & Diagnostic Runbook](#10-verification--diagnostic-runbook)

---

## 1. Architecture & System Topology

### The Two-Tier Least-Privilege Model

Sayabot decouples **credential ownership** from **agent execution authority**:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          TIER 1: WORKSPACE CONNECTORS                            │
│                                                                                 │
│  • Configured once per organization by Admins in /[org]/settings/connectors     │
│  • Credentials encrypted via AES-256-GCM using MESH_KEK                         │
│  • Raw secrets stored as (ciphertext, iv, tag, last4) in PostgreSQL            │
│  • DB RLS revokes table access from all public/authenticated roles              │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        TIER 2: AGENT CONNECTOR GRANTS                           │
│                                                                                 │
│  • Assigned per agent in /[org]/agents/[handle] settings                        │
│  • Whitelists explicit resources:                                               │
│      - Google Drive: allowedFolders: ["1BxiMVs..."]                             │
│      - Slack:        allowedChannels: ["general", "engineering"]                │
│      - GitHub:       allowedRepos: ["sayalabs/saaya"]                           │
│      - Mutability:   readOnly: true | false                                     │
│  • Zero-Grant Default: Agents without explicit grants cannot invoke connectors  │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     ORCHESTRATOR RUNTIME EXECUTION GATE                         │
│                                                                                 │
│  1. Agent triggers tool: e.g. slack_search(query: "deployment status")         │
│  2. ConnectorService.getAgentScope(agentId, connectorId) verifies whitelist    │
│  3. In-flight token decryption using MESH_KEK                                  │
│  4. Outbound HTTP request dispatched via rate-limiter with exponential backoff  │
│  5. Sanitized ConnectorDoc returned to Agent context (Zero Token Exposure)      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### End-to-End System Flow

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Workspace Admin
    actor User as Room Member
    participant UI as Next.js Web App (:3000)
    participant DB as PostgreSQL (Supabase)
    participant Orch as Orchestrator (:4000)
    participant Agent as Autonomous Agent
    participant ExtAPI as External Provider (Slack/Drive/GitHub)

    Note over Admin,DB: 1. Setup Phase (Tier-1 & Tier-2)
    Admin->>UI: Configure Slack Connector (xoxb-...)
    UI->>UI: Encrypt token with MESH_KEK (AES-256-GCM)
    UI->>DB: INSERT into workspace_connectors (ciphertext, iv, tag, last4)
    Admin->>UI: Grant "Engineering Bot" access to #deployments
    UI->>DB: INSERT into agent_connector_grants (agent_id, allowedChannels)

    Note over User,ExtAPI: 2. Execution Phase
    User->>Orch: "@bot check deployment status in #deployments"
    Orch->>Agent: Run turn cycle
    Agent->>Orch: Call tool slack_search(query: "release v2.1")
    Orch->>DB: Query agent_connector_grants(agentId, connectorId)
    alt Unauthorized Channel or No Grant
        DB-->>Orch: Grant missing or channel not in allowedChannels
        Orch-->>Agent: Error: Access Denied (out of scope)
    else Authorized Scope
        DB-->>Orch: Return scope { allowedChannels: ["deployments"] }
        Orch->>DB: Fetch workspace_connectors record
        DB-->>Orch: Return (ciphertext, iv, tag)
        Orch->>Orch: Decrypt secret in memory using MESH_KEK
        Orch->>ExtAPI: GET https://slack.com/api/search.messages (Bearer xoxb-...)
        ExtAPI-->>Orch: 200 OK (messages payload)
        Orch->>Orch: Transform to ConnectorDoc & strip metadata
        Orch-->>Agent: Tool result: [{ title, content, author, url }]
        Agent-->>User: "Deployment v2.1 succeeded 12m ago (reported by @devops in #deployments)."
    end
```

---

## 2. Cryptographic Security & Envelope Encryption

### AES-256-GCM with `MESH_KEK`

Sayabot utilizes authenticated symmetric encryption with **Galois/Counter Mode (AES-256-GCM)**, providing both **confidentiality** and **ciphertext integrity**.

#### Cryptographic Specification

- **Algorithm**: `AES-256-GCM` (`node:crypto`)
- **Master Key (`MESH_KEK` or `SAYABOT_KEK`)**: 256-bit cryptographically secure pseudorandom key, Base64-encoded (exactly 32 bytes).
- **Initialization Vector (IV)**: 96-bit (12 bytes) cryptographically random IV generated uniquely for _every single encryption invocation_ via `randomBytes(12)`.
- **Authentication Tag**: 128-bit (16 bytes) GCM auth tag generated via `cipher.getAuthTag()`. Guarantees mathematical detection of any tampering, bit-flipping, or truncated ciphertext.
- **Key Identification (`last4`)**: The last 4 characters of the raw API token are stored unencrypted (`token.slice(-4)`), enabling human administrators to recognize rotated keys without decrypting the payload.

#### Implementation (`packages/llm/src/crypto.ts`)

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export interface EncryptedSecret {
  ciphertext: string
  iv: string
  tag: string
}

export function parseKek(kek: string): Buffer {
  const key = Buffer.from(kek, "base64")
  if (key.length !== 32) {
    throw new Error(
      "MESH_KEK must decode to exactly 32 bytes (generate with: openssl rand -base64 32)",
    )
  }
  return key
}

export function encryptSecret(plaintext: string, kek: string): EncryptedSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", parseKek(kek), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  }
}

export function decryptSecret(secret: EncryptedSecret, kek: string): string {
  const decipher = createDecipheriv("aes-256-gcm", parseKek(kek), Buffer.from(secret.iv, "base64"))
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")
}
```

### Zero Token Leakage Guarantee

Sayabot enforces a zero-trust credential lifecycle:

```
[Plaintext Token Input (Admin UI)]
               │
               ▼
   [In-Memory AES-256-GCM Encryption]  <-- MESH_KEK never sent to browser
               │
               ▼
    [PostgreSQL Storage (Ciphertext)]  <-- Raw token never touches disk
               │
               ▼
[Orchestrator Backend Service Node]     <-- Decrypted strictly in RAM
               │
               ▼
 [Outbound HTTPS to Provider API]      <-- Bearer header injected directly
               │
               ▼
  [Sanitized ConnectorDoc Payload]     <-- Token NEVER enters LLM prompt
```

1. **Context Window Isolation**: The LLM prompt and message context **never receive** the API token or authorization headers. The agent only receives the sanitized `ConnectorDoc` structure (`title`, `content`, `url`, `metadata`).
2. **Client-Side Sanitization**: Client web browsers, WebSocket streams, and Next.js React Server Components never receive `ciphertext`, `iv`, or `tag`.
3. **Log Stream Stripping**: Sayabot's core logging engine runs pattern-based redaction filters (`packages/core/src/redact.ts`) that match and replace tokens matching `xox[abposr]-*`, `ghp_*`, `github_pat_*`, and `ya29.*` with `[REDACTED:<token_type>]`.

### PostgreSQL Row Level Security (RLS) & Sanitized Public Views

Direct database access is locked down at the PostgreSQL engine level (`packages/db/sql/0018_workspace_connectors.sql`).

```sql
-- 1. Enable RLS on both connector tables
alter table public.workspace_connectors enable row level security;
alter table public.agent_connector_grants enable row level security;

-- 2. Revoke all access from standard roles to prevent secret extraction
revoke all on public.workspace_connectors from anon, authenticated, public;
grant all on public.workspace_connectors to service_role;

-- 3. Create a safe public view that omits ciphertext, iv, and tag entirely
create or replace view public.workspace_connectors_public as
select
  id,
  org_id,
  owner_user_id,
  source,
  name,
  status,
  auth_type,
  last4,
  config,
  last_synced_at,
  error_message,
  created_at,
  updated_at
from public.workspace_connectors
where public.is_org_member(org_id);

-- 4. Grant read access to the sanitized view only
grant select on public.workspace_connectors_public to authenticated;

-- 5. Scope agent grants by organization membership
create policy "agent_connector_grants_policy" on public.agent_connector_grants for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

grant select, insert, update, delete on public.agent_connector_grants to authenticated;
grant all on public.agent_connector_grants to service_role;
```

> [!IMPORTANT]
> Because `workspace_connectors` permissions are revoked from `authenticated`, any Supabase frontend query (`supabase.from('workspace_connectors').select('*')`) returns an HTTP 403 / zero rows. All UI inspection uses `workspace_connectors_public`. Only the backend orchestrator and Next.js Server Actions using the `service_role` Supabase client can decrypt secrets.

### Outbound Secret Redaction & SSRF Hardening

When agents execute shell commands in Docker sandboxes (`computerd`) or query external tools, all outbound network traffic routes through the `apps/egress` bastion proxy:

- **SSRF Firewall**: Blocks all attempts to route traffic to RFC-1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.1`), or cloud metadata services (`169.254.169.254`).
- **Header Injection**: Tokens for connected integrations are injected directly into outbound HTTP headers by the proxy without exposing them to the agent sandbox environment variables.

---

## 3. Step-by-Step Provider Setup Guides

### Slack Connector

The Slack connector allows agents to search historical channels, retrieve threaded discussions, resolve `@mention` user IDs into human names, and optionally post notifications.

```
                    ┌────────────────────────────┐
                    │      api.slack.com/apps    │
                    └─────────────┬──────────────┘
                                  │ Create Slack App
                                  ▼
                    ┌────────────────────────────┐
                    │ OAuth & Permissions (Bot)  │
                    │ • channels:history, read   │
                    │ • groups:history, read     │
                    │ • users:read               │
                    │ • search:read              │
                    │ • chat:write (mutations)   │
                    └─────────────┬──────────────┘
                                  │ Install to Workspace
                                  ▼
                    ┌────────────────────────────┐
                    │ Slack Bot Token (xoxb-...) │
                    └─────────────┬──────────────┘
                                  │ Paste into Sayabot
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Sayabot Workspace Connector: /[org]/settings/connectors         │
│ Source: Slack | Token: xoxb-... | Default Channel: #general    │
└─────────────────────────────────────────────────────────────────┘
```

#### Step 1: Create Slack App

1. Navigate to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**.
2. Select **From scratch**.
3. Name your app (e.g., `Sayabot Knowledge Connector`) and select your Slack workspace.

#### Step 2: Configure Bot Token Scopes

1. In the left sidebar, click **OAuth & Permissions**.
2. Scroll to **Scopes** → **Bot Token Scopes** and add:
   - `channels:history` – View messages in public channels.
   - `channels:read` – View public channel names and IDs.
   - `groups:history` – View messages in private channels the bot is invited to.
   - `groups:read` – View private channel names and IDs.
   - `users:read` – Resolve user IDs (`<@U12345>`) to display names (`@Alex`).
   - `search:read` – Execute workspace message searches (`search.messages`).
   - `chat:write` – Post messages or replies (required if using `slack_send_message`).

#### Step 3: Install App & Obtain Bot Token

1. Scroll to the top of **OAuth & Permissions** and click **Install to Workspace**.
2. Click **Allow** to approve the permission request.
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`).

#### Step 4: Invite Bot to Target Channels

In your Slack client, invite the bot to any public or private channels it should access:

```text
/invite @Sayabot Knowledge Connector
```

#### Step 5: Save in Sayabot

1. Navigate to `https://your-domain.com/[org]/settings/connectors`.
2. Click **Connect Workspace Service**.
3. Select **Slack** from the dropdown.
4. Paste the `xoxb-...` token and optionally provide a default channel (e.g. `general`).
5. Click **Connect Workspace Service** and run **Test Connection**.

---

### Google Drive Connector

The Google Drive connector allows agents to search Google Drive, read Docs (exported as plain text), inspect Sheets (exported as CSV), and read Slides or PDFs.

#### Step 1: Create Google Cloud Project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `Sayabot-Connectors-Prod`).
3. In the search bar, look for **Google Drive API** and click **Enable**.

#### Step 2: Choose Authentication Method

Sayabot supports both **User OAuth 2.0 Access Tokens** and **Service Account Delegation**:

| Method               | Best For                          | Token Format                              | Token Rotation                           |
| :------------------- | :-------------------------------- | :---------------------------------------- | :--------------------------------------- |
| **Service Account**  | Enterprise / Background Workflows | Service Account OAuth Token / Service Key | Automatically refreshed via Google OAuth |
| **User OAuth Token** | Personal / Single-User Workspaces | `ya29.a0A...` Bearer Token                | 1 hour expiry (requires refresh token)   |

#### Step 3: Configure Service Account

1. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **Service Account**.
2. Name the account (e.g., `sayabot-drive-reader`).
3. Click **Done**.
4. Click on the created service account → **Keys** tab → **Add Key** → **Create New Key (JSON)**.
5. Save the JSON key securely.

#### Step 4: Share Google Drive Folders

Share the target Google Drive folders or Shared Drives with the Service Account email address (`sayabot-drive-reader@your-project.iam.gserviceaccount.com`) with **Viewer** access.

#### Step 5: Save in Sayabot

1. Navigate to `/[org]/settings/connectors` → Select **Google Drive**.
2. Paste the OAuth token or service bearer token (`ya29...`).
3. In **Google Drive Domain / Root Folder**, optionally specify your domain or a specific folder ID (e.g., `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`).
4. Click **Connect Workspace Service**.

---

### GitHub Connector

The GitHub connector enables agents to search repository code, inspect raw files across git refs, and read Issue and Pull Request discussion threads with review comments.

#### Step 1: Generate Access Token

Sayabot supports **Fine-Grained Personal Access Tokens (PATs)**, **Classic PATs**, and **GitHub Apps**:

##### Option A: Fine-Grained Personal Access Token (Recommended)

1. Go to **GitHub Settings** → **Developer Settings** → **Personal Access Tokens** → **Fine-grained tokens**.
2. Click **Generate new token**.
3. Set **Resource owner** to your organization or user.
4. Under **Repository access**, select **Only select repositories** and pick the repositories your team needs.
5. Under **Repository permissions**, grant:
   - **Contents**: `Read-only`
   - **Issues**: `Read-only`
   - **Pull requests**: `Read-only`
   - **Metadata**: `Read-only` (automatically added)

##### Option B: Classic Personal Access Token

1. Go to **Personal Access Tokens** → **Tokens (classic)**.
2. Select `repo` (Full control of private repositories) or `repo:status`, `public_repo` for open source.

#### Step 2: Save in Sayabot

1. Navigate to `/[org]/settings/connectors` → Select **GitHub**.
2. Set display name (e.g., `Engineering GitHub`).
3. Paste the token (`ghp_...` or `github_pat_...`).
4. (Optional) Set the **Default GitHub Org / Owner** (e.g., `sayalabs`).
5. Click **Connect Workspace Service** and run **Test Connection**.

---

### Jira & Atlassian Cloud Connector

The Jira connector allows agents to search sprint backlogs, inspect issue tickets, and resolve bug reports.

#### Step 1: Generate Atlassian API Token

1. Log in to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Click **Create API token**.
3. Label the token `Sayabot Connector`.
4. Copy the generated token string.

#### Step 2: Configure Jira Scopes

Atlassian API requests require Basic Authentication composed of `email:api_token` encoded in Base64:

```bash
echo -n "user@example.com:ATATT3xFfGF0..." | base64
```

Required Atlassian Cloud scopes:

- `read:jira-work` – Search issues, sprint boards, and epics via JQL.
- `read:jira-user` – Resolve reporter and assignee email addresses and display names.
- `write:jira-work` – Add comments or transition ticket states (when mutations are enabled).

#### Step 3: Register in Sayabot

In `/[org]/settings/connectors`:

- **Source**: `jira`
- **Token**: Base64-encoded `email:api_token` string.
- **Config JSON**:
  ```json
  {
    "domain": "acme.atlassian.net",
    "defaultProject": "ENG",
    "apiVersion": "3"
  }
  ```

---

## 4. Fine-Grained Agent Scoping (Tier-2 Access Control)

Even after an organization connector is active, **no agent has access by default**. Access must be granted on a per-agent basis.

```
                   ┌──────────────────────────────────┐
                   │    Connector: "Company Slack"    │
                   │   All channels: #eng, #finance,  │
                   │   #exec, #general, #hr, #legal   │
                   └────────────────┬─────────────────┘
                                    │
               ┌────────────────────┴────────────────────┐
               │                                         │
               ▼                                         ▼
┌──────────────────────────────┐          ┌──────────────────────────────┐
│     Agent: "Support Bot"     │          │     Agent: "Finance Bot"     │
│  Grant: agentConnectorGrants │          │  Grant: agentConnectorGrants │
│  allowedChannels:            │          │  allowedChannels:            │
│  [ "customer-support",       │          │  [ "finance", "billing",     │
│    "general" ]               │          │    "invoices" ]              │
└──────────────────────────────┘          └──────────────────────────────┘
               │                                         │
               ▼                                         ▼
   BLOCKED: Access Denied                    BLOCKED: Access Denied
   Attempting to read #exec                  Attempting to read #customer-support
```

### The Grant Resolution Engine

Before executing any connector tool call, `ConnectorService` performs authorization enforcement:

```typescript
// apps/orchestrator/src/connectors/service.ts
async getAgentScope(agentId: string, connectorId: string): Promise<ConnectorScopeConfig> {
  const [grant] = await this.db
    .select()
    .from(agentConnectorGrants)
    .where(
      and(
        eq(agentConnectorGrants.agentId, agentId),
        eq(agentConnectorGrants.connectorId, connectorId),
      ),
    )
    .limit(1)

  if (!grant) {
    throw new Error("Access Denied: This agent is not granted access to this connector.")
  }

  return (grant.scopeConfig ?? {}) as ConnectorScopeConfig
}
```

### Google Drive Folder Sub-tree Scoping

When an agent searches Google Drive, Sayabot injects folder restriction clauses directly into the Google Drive v3 API `q` parameter:

```typescript
// apps/orchestrator/src/connectors/google-drive.ts
let q = `trashed = false and (name contains '${searchTerms}' or fullText contains '${searchTerms}')`

if (options.allowedFolders && options.allowedFolders.length > 0) {
  const folderClauses = options.allowedFolders.map((f) => `'${f}' in parents`).join(" or ")
  q += ` and (${folderClauses})`
}
```

If an agent attempts to pass an unauthorized folder or query global drive content without folder grants, files outside the whitelisted parents are excluded by Google's query engine.

### Slack Channel Ingestion & Thread Boundaries

Slack scoping enforces channel whitelist boundaries at two levels:

1. **Search Queries**: Injects `in:<channel>` filters for every whitelisted channel.
2. **Channel Argument Verification**: If an agent requests a specific channel, `ConnectorService` verifies that the channel exists in the agent's whitelist:

```typescript
// apps/orchestrator/src/connectors/service.ts
if (args.channel && scope.allowedChannels && scope.allowedChannels.length > 0) {
  const clean = args.channel.replace(/^#/, "")
  if (!scope.allowedChannels.includes(clean)) {
    throw new Error(
      `Channel '${args.channel}' is outside this agent's allowed channels (${scope.allowedChannels.join(", ")})`,
    )
  }
}
```

### GitHub Repository Scoping

When searching GitHub code, Sayabot appends explicit repository qualifiers:

```typescript
// apps/orchestrator/src/connectors/github.ts
if (options.allowedRepos && options.allowedRepos.length > 0) {
  const repoFilters = options.allowedRepos.map((r) => `repo:${r}`).join(" ")
  q = `${q} ${repoFilters}`
}
```

For direct file fetching (`github_get_file`) or issue inspection (`github_get_issue_or_pr`), `ConnectorService` verifies that `args.repo` matches the whitelist before dispatching the request:

```typescript
if (scope.allowedRepos && scope.allowedRepos.length > 0) {
  if (!scope.allowedRepos.includes(args.repo)) {
    throw new Error(`Access Denied: Agent is not granted access to repository ${args.repo}`)
  }
}
```

### Read-Only Enforcement & Mutation Safeguards

The `scopeConfig` object supports a `readOnly: boolean` flag:

- When `readOnly: true` (or when write permissions are absent), mutating operations such as `slack_send_message` throw an immediate `403 Forbidden` error.
- Even when `readOnly: false`, mutating actions trigger Sayabot's **Human Approval Gate** when room governance is enabled.

---

## 5. Sliding-Window Provider Rate Limiting & Backoff

Third-party APIs impose aggressive rate limits:

- **Slack**: Tier 2 (20 req/min) / Tier 3 (50 req/min).
- **GitHub**: 5,000 requests/hour for authenticated users; secondary search limit of 30 requests/minute.
- **Google Drive**: 12,000 requests per 100 seconds per project.

Sayabot protects integrations using an autonomous exponential backoff loop with randomized jitter (`apps/orchestrator/src/connectors/rate-limiter.ts`).

```mermaid
flowchart TD
    Start([Execute fetchWithRetry]) --> Attempt[Attempt HTTP Request]
    Attempt --> StatusCheck{HTTP Status?}

    StatusCheck -->|200-299 OK| ReturnResponse[Return Response]
    StatusCheck -->|400, 401, 403, 404| FatalError[Throw Permanent Error]

    StatusCheck -->|429 Rate Limited or 500-504 Transient| CanRetry{Attempt <= maxRetries?}

    CanRetry -->|No| MaxRetriesExceeded[Throw Rate Limit / Server Error]
    CanRetry -->|Yes| ParseHeader[Inspect Retry-After Header]

    ParseHeader --> HeaderFound{Retry-After present?}
    HeaderFound -->|Yes: Seconds or HTTP Date| UseHeader[Compute delay from header]
    HeaderFound -->|No| ExponentialCalc[delay = baseDelay * 2^attempt-1]

    UseHeader --> AddJitter[Add random jitter: 0 - 250ms]
    ExponentialCalc --> AddJitter

    AddJitter --> CapDelay[delay = min maxDelayMs, delay + jitter]
    CapDelay --> Sleep[Sleep delay ms]
    Sleep --> Attempt
```

### Resilience Strategy (`fetchWithRetry`)

```typescript
// apps/orchestrator/src/connectors/rate-limiter.ts
export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  timeoutMs?: number
  fetchFn?: typeof fetch
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3
  const baseDelayMs = options.baseDelayMs ?? 500
  const maxDelayMs = options.maxDelayMs ?? 8000
  const timeoutMs = options.timeoutMs ?? 25000
  const customFetch = options.fetchFn ?? fetch

  let attempt = 0

  while (true) {
    attempt++
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await customFetch(url, {
        ...init,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (response.ok) return response

      const isRateLimit = response.status === 429
      const isTransient = response.status >= 500 && response.status <= 504

      if ((isRateLimit || isTransient) && attempt <= maxRetries) {
        let delayMs = baseDelayMs * Math.pow(2, attempt - 1)

        // Parse standard Retry-After header
        const retryAfterHeader = response.headers.get("retry-after")
        if (retryAfterHeader) {
          const seconds = parseInt(retryAfterHeader, 10)
          if (!Number.isNaN(seconds)) {
            delayMs = seconds * 1000
          } else {
            const date = new Date(retryAfterHeader).getTime()
            if (!Number.isNaN(date)) {
              delayMs = Math.max(0, date - Date.now())
            }
          }
        }

        // Add random jitter to prevent thundering herd
        const jitter = Math.floor(Math.random() * 250)
        const finalDelay = Math.min(maxDelayMs, delayMs + jitter)

        await new Promise((resolve) => setTimeout(resolve, finalDelay))
        continue
      }

      return response
    } catch (error: any) {
      clearTimeout(timeout)
      if (attempt <= maxRetries && error?.name !== "AbortError") {
        const jitter = Math.floor(Math.random() * 250)
        const finalDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1) + jitter)
        await new Promise((resolve) => setTimeout(resolve, finalDelay))
        continue
      }
      throw error
    }
  }
}
```

### Parsing Standard `Retry-After` Headers

The rate limiter natively handles both standard HTTP `Retry-After` formats:

1. **Delta-Seconds**: `Retry-After: 120` (sleeps 120 seconds).
2. **HTTP-Date**: `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT` (computes exact millisecond delta against `Date.now()`).

### Preventing Thundering Herd via Randomized Jitter

When multiple concurrent agents wake during team discussions and query Slack or GitHub simultaneously, synchronized retries would overwhelm upstream APIs. By appending a randomized uniform jitter (`Math.random() * 250`), retry requests desynchronize cleanly.

---

## 6. Complete Connector Tool Catalog

Sayabot exposes built-in tools to agents registered with connector grants (`apps/orchestrator/src/tools/builtins/connectors.ts`).

### Summary Catalog

| Tool Name                    | Provider     | Dangerous | Mutating | Primary Purpose                                               |
| :--------------------------- | :----------- | :-------: | :------: | :------------------------------------------------------------ |
| **`gdrive_search`**          | Google Drive |  `false`  |    No    | Search Google Docs, Sheets, and files within allowed folders  |
| **`gdrive_read_file`**       | Google Drive |  `false`  |    No    | Read text from Google Docs or export Google Sheets to CSV     |
| **`slack_search`**           | Slack        |  `false`  |    No    | Search message discussions across allowed Slack channels      |
| **`slack_read_thread`**      | Slack        |  `false`  |    No    | Read chronological replies in a Slack conversation thread     |
| **`slack_send_message`**     | Slack        |  `true`   | **Yes**  | Post a message or reply into an authorized Slack channel      |
| **`github_search_code`**     | GitHub       |  `false`  |    No    | Search codebase source symbols across allowed repositories    |
| **`github_get_file`**        | GitHub       |  `false`  |    No    | Retrieve raw file contents from a specific repo and branch    |
| **`github_get_issue_or_pr`** | GitHub       |  `false`  |    No    | Inspect Issue or PR descriptions, review comments, and status |

---

### `gdrive_search`

Searches Google Drive metadata and text contents scoped to the agent's authorized folder IDs.

- **Dangerous**: `false`
- **Input Schema (Zod)**:
  ```typescript
  z.object({
    query: z.string().min(1).describe("Search keywords or document title"),
    limit: z.number().int().min(1).max(20).optional().default(8),
  })
  ```
- **Output Structure**:
  ```json
  {
    "query": "Q3 Financials",
    "count": 1,
    "files": [
      {
        "id": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
        "title": "Q3 Financial Plan.gdoc",
        "url": "https://docs.google.com/document/d/1BxiMVs.../view",
        "mime_type": "application/vnd.google-apps.document",
        "last_modified": "2026-10-15T14:32:00Z",
        "author": "CFO Team"
      }
    ]
  }
  ```

---

### `gdrive_read_file`

Reads full text content from a Google Drive file. Automatically handles document conversions:

- **Google Docs**: Converted to plain text via Google Drive export endpoint.
- **Google Sheets**: Converted to tabular **CSV** format for direct analysis by agents.
- **Google Slides**: Converted to structured outline text.
- **Raw Files**: Downloaded directly via `alt=media`.
- **Context Protection**: Output is safely truncated to 100,000 characters to prevent context window overflow.

- **Dangerous**: `false`
- **Input Schema (Zod)**:
  ```typescript
  z.object({
    file_id: z.string().min(1).describe("Google Drive file ID from search results"),
  })
  ```
- **Output Structure**:
  ```json
  {
    "id": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
    "title": "Q3 Financial Plan",
    "url": "https://docs.google.com/document/d/1BxiMVs.../view",
    "content": "Department,Spend,Budget\nEngineering,50000,60000\nMarketing,20000,25000",
    "metadata": {
      "mimeType": "application/vnd.google-apps.spreadsheet",
      "lastModified": "2026-10-15T14:32:00Z",
      "author": "sarah@sayalabs.in"
    }
  }
  ```

---

### `slack_search`

Searches messages across authorized Slack channels with automatic user mention resolution (`<@U12345>` is automatically translated to human names like `@Alex`).

- **Dangerous**: `false`
- **Input Schema (Zod)**:
  ```typescript
  z.object({
    query: z.string().min(1).describe("Search terms or topic"),
    limit: z.number().int().min(1).max(20).optional().default(10),
  })
  ```
- **Output Structure**:
  ```json
  {
    "query": "deployment error",
    "count": 1,
    "messages": [
      {
        "id": "slack-C012345-1698200000.000100",
        "title": "Slack Message in #engineering by @Alex",
        "url": "https://slack.com/archives/C012345/p1698200000000100",
        "content": "@Alex: Rolling back deployment v2.0.4 due to memory leak on worker-3.",
        "channel": "#engineering",
        "author": "@Alex",
        "thread_ts": "1698200000.000100"
      }
    ]
  }
  ```

---

### `slack_read_thread`

Fetches an entire discussion thread with all user replies in chronological order.

- **Dangerous**: `false`
- **Input Schema (Zod)**:
  ```typescript
  z.object({
    channel_id: z.string().min(1).describe("Slack channel ID (e.g. C123456)"),
    thread_ts: z.string().min(1).describe("Thread parent timestamp (ts)"),
  })
  ```
- **Output Structure**:
  ```json
  {
    "id": "slack-thread-C012345-1698200000.000100",
    "title": "Slack Thread in C012345 (3 replies)",
    "url": "https://slack.com/archives/C012345/p1698200000000100",
    "discussion": "**@Alex** (2026-10-25T08:00:00Z):\nRolling back deployment v2.0.4...\n\n---\n\n**@Sarah** (2026-10-25T08:05:00Z):\nIdentified root cause in connection pooler.",
    "reply_count": 2
  }
  ```

---

### `slack_send_message`

Posts an update or reply into an authorized channel. Because this mutates external team workspaces, it carries `dangerous: true`. When executed in moderated rooms, human teammates receive an approval prompt before message delivery.

- **Dangerous**: `true`
- **Input Schema (Zod)**:
  ```typescript
  z.object({
    channel_id: z.string().min(1).describe("Slack channel ID (e.g. C123456) or channel name"),
    text: z.string().min(1).describe("Message markdown text to post"),
    thread_ts: z
      .string()
      .optional()
      .describe("Optional thread parent timestamp to reply in thread"),
  })
  ```
- **Output Structure**:
  ```json
  {
    "ok": true,
    "message_id": "slack-msg-1698200500.000200",
    "channel": "C012345",
    "ts": "1698200500.000200"
  }
  ```

---

### `github_search_code`

Searches source code and repository symbols across the agent's whitelisted repositories.

- **Dangerous**: `false`
- **Input Schema (Zod)**:
  ```typescript
  z.object({
    query: z.string().min(1).describe("Code search query or symbol name"),
    limit: z.number().int().min(1).max(20).optional().default(10),
  })
  ```
- **Output Structure**:
  ```json
  {
    "query": "enforceAgentScope",
    "count": 1,
    "items": [
      {
        "id": "gh-sayalabs/saaya-apps/orchestrator/src/connectors/service.ts",
        "title": "service.ts (sayalabs/saaya)",
        "url": "https://github.com/sayalabs/saaya/blob/main/apps/orchestrator/src/connectors/service.ts",
        "repo": "sayalabs/saaya",
        "path": "apps/orchestrator/src/connectors/service.ts"
      }
    ]
  }
  ```

---

### `github_get_file`

Fetches and decodes the raw text content of any file from a GitHub repository. Automatically decodes base64 content and truncates at 100,000 characters.

- **Dangerous**: `false`
- **Input Schema (Zod)**:
  ```typescript
  z.object({
    repo: z.string().min(1).describe("Repository in 'owner/name' format"),
    path: z.string().min(1).describe("File path relative to repository root"),
    ref: z.string().optional().default("main").describe("Branch, tag, or commit SHA"),
  })
  ```
- **Output Structure**:
  ```json
  {
    "title": "rate-limiter.ts (sayalabs/saaya)",
    "url": "https://github.com/sayalabs/saaya/blob/main/apps/orchestrator/src/connectors/rate-limiter.ts",
    "content": "export async function fetchWithRetry(...) { ... }",
    "metadata": {
      "repo": "sayalabs/saaya",
      "path": "apps/orchestrator/src/connectors/rate-limiter.ts",
      "size": 2611
    }
  }
  ```

---

### `github_get_issue_or_pr`

Fetches a GitHub Issue or Pull Request description, author, labels, state, and complete discussion comments in Markdown format.

- **Dangerous**: `false`
- **Input Schema (Zod)**:
  ```typescript
  z.object({
    repo: z.string().min(1).describe("Repository in 'owner/name' format"),
    issue_number: z.number().int().positive().describe("Issue or PR number"),
  })
  ```
- **Output Structure**:
  ```json
  {
    "id": "gh-sayalabs/saaya-42",
    "title": "Issue #42: Flaky rate limiter backoff on 429",
    "url": "https://github.com/sayalabs/saaya/issues/42",
    "content": "# Issue #42: Flaky rate limiter backoff on 429 (CLOSED)\n**Author:** @octocat | **Created:** 2026-10-20T10:00:00Z\n\nUnder high load, 429 retries can synchronize...\n\n---\n## Discussion & Comments\n\n**@sarah** (2026-10-20T11:00:00Z):\nResolved by introducing Math.random() * 250 jitter in PR #43.\n",
    "metadata": {
      "repo": "sayalabs/saaya",
      "issueNumber": 42,
      "state": "closed",
      "author": "octocat",
      "labels": ["bug", "connectors"]
    }
  }
  ```

---

## 7. UI Management & Database Schemas

### PostgreSQL DDL & Drizzle Schemas

The relational model is implemented in `packages/db/src/schema/connectors.ts`:

```typescript
// packages/db/src/schema/connectors.ts
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { agents } from "./agents"
import { orgs, profiles } from "./identity"

// ── 1. Workspace Connectors Table (Tier-1) ───────────────────────────────────
export const workspaceConnectors = pgTable(
  "workspace_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").references(() => profiles.id, { onDelete: "set null" }),
    source: text("source").notNull(), // 'google_drive', 'slack', 'github', 'jira'
    name: text("name").notNull(),
    status: text("status").notNull().default("active"), // 'active', 'error', 'syncing', 'disabled'
    authType: text("auth_type").notNull().default("token"), // 'oauth', 'token', 'service_account'
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    last4: text("last4").notNull(),
    config: jsonb("config").notNull().default({}),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workspace_connectors_org_idx").on(t.orgId),
    index("workspace_connectors_source_idx").on(t.orgId, t.source),
  ],
)

// ── 2. Agent Connector Grants Table (Tier-2) ─────────────────────────────────
export const agentConnectorGrants = pgTable(
  "agent_connector_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => workspaceConnectors.id, { onDelete: "cascade" }),
    scopeConfig: jsonb("scope_config").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_connector_grants_agent_idx").on(t.orgId, t.agentId)],
)
```

### Web UI Administration (`/[org]/settings/connectors`)

Administrators manage workspace integrations under **Organization Settings** → **Workspace Connectors**:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Workspace Connectors                                                  │
│  Connect your company tools once here with AES-256-GCM encryption.     │
├────────────────────────────────────────────────────────────────────────┤
│  📁 Company Google Drive        GOOGLE_DRIVE   ● Active                │
│     Search docs, read spreadsheets (CSV)                               │
│     Key ends in ...A4d8 • Last verified: Today at 10:14 AM             │
│     [ Test Connection ]  [ Delete ]                                    │
├────────────────────────────────────────────────────────────────────────┤
│  💬 Engineering Slack           SLACK          ● Active                │
│     Search workspace conversation history and resolve threads          │
│     Key ends in ...x89q • Last verified: Today at 09:30 AM             │
│     [ Test Connection ]  [ Delete ]                                    │
├────────────────────────────────────────────────────────────────────────┤
│  🐙 Core GitHub Org             GITHUB         ● Active                │
│     Search code, retrieve files, inspect issues & PRs                  │
│     Key ends in ...77b1 • Last verified: Yesterday                     │
│     [ Test Connection ]  [ Delete ]                                    │
└────────────────────────────────────────────────────────────────────────┘
```

Adding a connector via Server Action `saveWorkspaceConnector`:

1. Validates source against `z.enum(["google_drive", "slack", "github", "jira"])`.
2. Encrypts token using `encryptSecret(token, getKek())`.
3. Inserts row into `workspace_connectors` with `ciphertext`, `iv`, `tag`, and `last4(token)`.
4. Emits structured audit log (`audit({ action: "workspace_connector.created" })`).

### Agent Grant Wizard (`/[org]/agents/[handle]`)

Under each individual agent's profile, the **Workspace Knowledge Connectors** card allows team owners to grant access and configure whitelist boundaries:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Workspace Knowledge Connectors                                        │
│  Tier-2 scoping: grant access to company tools with strict boundaries. │
├────────────────────────────────────────────────────────────────────────┤
│  Engineering Slack (slack)                                             │
│  Channels: #engineering, #deployments, #alerts                         │
│  [ Revoke ]                                                            │
├────────────────────────────────────────────────────────────────────────┤
│  Core GitHub Org (github)                                              │
│  Repos: sayalabs/saaya, sayalabs/core                                  │
│  [ Revoke ]                                                            │
├────────────────────────────────────────────────────────────────────────┤
│  + Grant Connector Access                                              │
│  Connector: [ Company Google Drive ▼ ]                                 │
│  Allowed Folder IDs: [ 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms ]  │
│  [ Grant Scoped Access ]                                               │
└────────────────────────────────────────────────────────────────────────┘
```

### Live Diagnostics & Connection Health Testing

When an administrator clicks **Test Connection**, Sayabot executes Server Action `testWorkspaceConnector(orgSlug, connectorId)`:

1. Decrypts stored credentials in memory using `MESH_KEK`.
2. Dispatches an authentic verification handshake:
   - **Google Drive**: `GET https://www.googleapis.com/drive/v3/about?fields=user`
   - **Slack**: `GET https://slack.com/api/auth.test`
   - **GitHub**: `GET https://api.github.com/user`
3. Measures roundtrip latency (`latencyMs`) and extracts identity metadata (e.g. `Connected as @octocat`).
4. Updates `last_synced_at`, clears `error_message`, and marks status as `active`.
5. If the handshake fails or the token was revoked upstream, updates status to `error` and records the diagnostic message.

### Audit Logging & Compliance Ledger

Every mutation is recorded in Sayabot's immutable audit log (`packages/db/src/schema/ops.ts`):

- `workspace_connector.created`
- `workspace_connector.updated`
- `workspace_connector.deleted`
- `agent_connector_grant.saved`
- `agent_connector_grant.deleted`

Logs include `actorId`, `orgId`, `target`, and full JSON metadata (whitelisted channels, repository names, source type), meeting SOC 2 and ISO 27001 audit trail requirements.

---

## 8. Extending Connectors: Developer Guide

Sayabot is architected for clean extensibility. To add a new connector source (e.g., Notion, Jira, Confluence, Linear):

### Step 1: Update Supported Sources

Add the source identifier to `ConnectorSource` in `apps/orchestrator/src/connectors/types.ts`:

```typescript
export type ConnectorSource = "google_drive" | "slack" | "github" | "jira" | "linear"
```

### Step 2: Implement the Provider Client

Create `apps/orchestrator/src/connectors/linear.ts`:

```typescript
import { fetchWithRetry } from "./rate-limiter"
import type { ConnectorDoc, ConnectorSearchOptions } from "./types"

export class LinearConnector {
  constructor(private config: { apiKey: string; fetchFn?: typeof fetch }) {}

  async searchIssues(options: ConnectorSearchOptions): Promise<ConnectorDoc[]> {
    const res = await fetchWithRetry(
      "https://api.linear.app/graphql",
      {
        method: "POST",
        headers: {
          Authorization: this.config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `query Search($term: String!) { issueSearch(query: $term) { nodes { id title url description } } }`,
          variables: { term: options.query },
        }),
      },
      { fetchFn: this.config.fetchFn },
    )

    const data = await res.json()
    return (data.data?.issueSearch?.nodes ?? []).map((issue: any) => ({
      id: `linear-${issue.id}`,
      source: "linear",
      title: issue.title,
      content: issue.description || "[No description]",
      url: issue.url,
      metadata: { issueId: issue.id },
    }))
  }
}
```

### Step 3: Register in ConnectorService

In `apps/orchestrator/src/connectors/service.ts`, add the action and bind `getDecryptedConnector`:

```typescript
async searchLinear(args: { agentId: string; orgId: string; query: string }): Promise<ConnectorDoc[]> {
  const { connector, token } = await this.getDecryptedConnector(args.orgId, "linear" as any)
  await this.getAgentScope(args.agentId, connector.id)

  const client = new LinearConnector({ apiKey: token, fetchFn: this.fetchFn })
  return client.searchIssues({ query: args.query })
}
```

### Step 4: Expose Built-in Tool

In `apps/orchestrator/src/tools/builtins/connectors.ts`, define the tool specification and add it to `connectorTools()`.

---

## 9. Comprehensive Troubleshooting Matrix

| Symptom / Error Message                                                 | Likely Root Cause                                                                | Diagnostic & Remediation Steps                                                                                    |
| :---------------------------------------------------------------------- | :------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| **`No connector configured for '<source>' in this workspace`**          | The integration has not been added at Tier 1.                                    | Navigate to `/[org]/settings/connectors` and add the service credentials.                                         |
| **`Access Denied: This agent is not granted access to this connector`** | The agent lacks a Tier-2 grant in `agent_connector_grants`.                      | Open `/[org]/agents/[handle]` → **Workspace Knowledge Connectors** → Add a grant for this connector.              |
| **`Channel '<name>' is outside this agent's allowed channels`**         | The agent attempted to query a channel not listed in its grant whitelist.        | Edit the agent's grant in `/[org]/agents/[handle]` to include the channel or use `#` prefixes consistently.       |
| **`Failed to decrypt connector credentials`**                           | `MESH_KEK` was rotated or differs between the web server and orchestrator.       | Ensure `MESH_KEK` is identical across `.env` in `apps/web` and `apps/orchestrator`.                               |
| **`Slack search failed with HTTP 403 (missing_scope)`**                 | The Slack bot token lacks required scopes (`search:read` or `channels:history`). | Open `api.slack.com/apps` → **OAuth & Permissions** → Add missing scopes → Reinstall app to workspace.            |
| **`Google Drive search failed (403): Access Not Configured`**           | Google Drive API is not enabled in the Google Cloud Console.                     | Open Google Cloud Console → **APIs & Services** → Search for **Google Drive API** → Click **Enable**.             |
| **`Google Drive readFile: 404 File Not Found`**                         | The file is in a private folder not shared with the service account.             | Share the target Google Drive folder with the Service Account email address as **Viewer**.                        |
| **`GitHub API returned HTTP 401: Bad credentials`**                     | The GitHub Personal Access Token expired or was revoked.                         | Generate a new token in GitHub Settings and update the connector in `/[org]/settings/connectors`.                 |
| **`Rate limit exceeded: 429`**                                          | Upstream API exhausted rate limit and max retries were exceeded.                 | Verify `fetchWithRetry` logs. For GitHub, verify that secondary search limits (30 req/min) are not being flooded. |

---

## 10. Verification & Diagnostic Runbook

To verify connector health directly from the terminal:

### 1. Test Encryption Key (`MESH_KEK`)

```bash
# Verify that your MESH_KEK decodes to exactly 32 bytes
echo "$MESH_KEK" | base64 --decode | wc -c
# Expected output: 32
```

### 2. Direct Slack Handshake Check

```bash
curl -s -X POST https://slack.com/api/auth.test \
  -H "Authorization: Bearer xoxb-YOUR-TOKEN" \
  -H "Content-Type: application/json" | jq .
# Expected output: { "ok": true, "url": "https://...", "team": "...", "user": "..." }
```

### 3. Direct Google Drive About Check

```bash
curl -s -H "Authorization: Bearer ya29.YOUR-TOKEN" \
  "https://www.googleapis.com/drive/v3/about?fields=user" | jq .
# Expected output: { "user": { "displayName": "...", "emailAddress": "..." } }
```

### 4. Direct GitHub Authentication Check

```bash
curl -s -H "Authorization: Bearer ghp_YOUR_TOKEN" \
  -H "User-Agent: Sayabot-Diagnostics" \
  https://api.github.com/user | jq '{login: .login, name: .name}'
# Expected output: { "login": "octocat", "name": "Mona Lisa Octocat" }
```

### 5. Run Monorepo Unit Test Suites

```bash
# Test connector clients and scoping rules
pnpm --filter @sayabot/orchestrator test tests/unit/connectors.test.ts

# Test web server actions and encryption workflows
pnpm --filter @sayabot/web test tests/unit/connectors-actions.test.ts
```
