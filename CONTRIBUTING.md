# Contributing to Sayabot

Thank you for your interest in contributing to **Sayabot**! Sayabot is an open-source, full-stack autonomous remote agent platform and real-time collaboration workspace where human teams and AI agents share rooms, execute deterministic turns, collaborate on live canvases, and operate persistent Linux computers.

We welcome contributions from developers, researchers, designers, and documentation writers of all skill levels. Whether you are fixing a bug, adding a new connector, optimizing Docker sandbox execution, or refining documentation, this guide will help you get started smoothly.

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free experience for everyone. Please be respectful, constructive, and kind in all issues, pull requests, and discussions.

---

## 🛠 Local Setup & Development Environment

### 1. Prerequisites

Ensure you have the following installed on your local machine:

- **Node.js**: `v24.x` (LTS or latest active version; check with `node -v`)
- **pnpm**: `v10.33.0` or later
  ```bash
  corepack enable
  corepack prepare pnpm@10.33.0 --activate
  ```
- **Docker**: Docker Desktop (Mac/Windows) or Docker Engine (Linux) with Docker Compose, required for running persistent computer sandboxes (`computerd`).
- **Supabase**: Either a free hosted [Supabase](https://supabase.com) project or local Supabase via the Supabase CLI (`npx supabase start`).
- **OpenSSL**: For generating secure encryption keys.

---

### 2. Fork & Clone Repository

```bash
git clone https://github.com/sayalabs/sayabot.git
cd sayabot
pnpm install
```

---

### 3. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Generate the required cryptographic master keys and add them to `.env`:

```bash
# 1. Master Key Encryption Key (MESH_KEK / SAYABOT_KEK) - 32-byte Base64 key
openssl rand -base64 32

# 2. Internal Orchestrator Secret - 32-byte Hex string
openssl rand -hex 32
```

Configure your database connection string in `.env`:

```env
# Supabase PostgreSQL Session Pooler (port 5432) or local Postgres
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"

# Master Encryption Key
MESH_KEK="<generated_32_byte_base64_key>"

# Internal Service Secret
ORCHESTRATOR_INTERNAL_SECRET="<generated_32_byte_hex_secret>"

# Supabase Auth & Public Configuration
NEXT_PUBLIC_SUPABASE_URL="https://[REF].supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<your_supabase_anon_key>"
SUPABASE_SERVICE_ROLE_KEY="<your_supabase_service_role_key>"

# Application URLs
NEXT_PUBLIC_APP_URL="http://localhost:3000"
ORCHESTRATOR_URL="http://localhost:4000"
```

---

### 4. Database Setup & Migrations

Sayabot uses Drizzle ORM paired with PostgreSQL migration routines:

```bash
# Apply all schema migrations (Drizzle snapshots + SQL routines 0001 through 0025)
pnpm db:migrate

# Seed default agent templates, routines, and workspace configuration
pnpm db:seed
```

---

### 5. Start Development Servers

Run the full monorepo concurrently via Turborepo:

```bash
pnpm dev
```

The services will be available at:

- **Web UI & Canvas**: `http://localhost:3000`
- **Orchestrator Engine**: `http://localhost:4000`
- **SSRF Egress Proxy**: `http://localhost:4001`
- **Computerd Daemon**: `http://localhost:4002`

To run an individual service in isolation:

```bash
pnpm --filter @sayabot/web dev
pnpm --filter @sayabot/orchestrator dev
pnpm --filter @sayabot/computerd dev
```

---

## 🌿 Branch Naming Conventions

All development should take place on dedicated feature or bugfix branches created from `main`. Use the following branch prefix format:

| Prefix      | Description                              | Example                                                      |
| :---------- | :--------------------------------------- | :----------------------------------------------------------- |
| `feat/`     | A new feature or capability              | `feat/jira-connector`, `feat/canvas-markdown-diff`           |
| `fix/`      | A bug fix or patch                       | `fix/advisory-lock-timeout`, `fix/mobile-turn-stream`        |
| `docs/`     | Documentation improvements               | `docs/connectors-guide`, `docs/self-hosting-troubleshooting` |
| `refactor/` | Code refactoring without behavior change | `refactor/turn-coordinator`, `refactor/evidence-logger`      |
| `perf/`     | Performance optimizations                | `perf/vector-memory-search`, `perf/canvas-crdt-sync`         |
| `test/`     | Adding or updating tests                 | `test/computerd-sandbox-isolation`, `test/connectors-grants` |
| `chore/`    | Tooling, dependencies, or config changes | `chore/upgrade-turborepo`, `chore/eslint-update`             |

Create your branch:

```bash
git checkout -b feat/my-awesome-feature
```

---

## 📝 Conventional Commits

We strictly follow the [Conventional Commits 1.0.0](https://www.conventionalcommits.org/) specification. Structured commit messages allow automated changelog generation and clean Git histories.

### Commit Format

```
<type>(<scope>): <short description in present tense>

[optional body explaining motivation and technical details]

[optional footer(s), e.g. Fixes #123]
```

### Allowed Types

- **`feat`**: A new user-facing or platform feature.
- **`fix`**: A bug fix.
- **`docs`**: Documentation changes only.
- **`style`**: Changes that do not affect code logic (formatting, white-space, semicolon cleanup).
- **`refactor`**: Code restructuring without altering external behavior.
- **`perf`**: Changes that improve latency, throughput, or memory usage.
- **`test`**: Adding missing tests or refactoring existing tests.
- **`build`**: Changes that affect the build system or dependencies.
- **`ci`**: Changes to CI/CD workflows and scripts.
- **`chore`**: Maintenance tasks, repo housekeeping, or auxiliary tool updates.

### Allowed Scopes

Scopes must reflect monorepo packages or major sub-systems:

- `web` — Next.js 16 frontend app, components, hooks, canvas UI
- `orchestrator` — Hono server, turn coordinator, engine, loop control
- `computerd` — Persistent Docker sandbox daemon and `/home/bot` agentd
- `egress` — SSRF-hardened outbound proxy
- `mobile` — Expo / React Native iOS & Android client
- `desktop` — Electron desktop application
- `db` — Database schemas, migrations, client
- `core` — Shared core utilities, capabilities, types
- `llm` — LLM providers, crypto envelope, MCP gateway
- `connectors` — Workspace connectors (Slack, Google Drive, GitHub, Jira)
- `deploy` — Docker, Nginx, Caddy, Cloudflare, deployment automation

### Commit Examples

```bash
# Good examples:
feat(connectors): add fine-grained folder restriction for Google Drive
fix(orchestrator): ensure advisory lock unlocks on turn abortion
docs(self-hosting): add Cloudflare Tunnel ingress configuration
test(computerd): verify path traversal denial outside /home/bot

# Bad examples (avoid these):
fixed bug
updates
wip
feat: new connector for orgs
```

---

## 🎨 Code Style & Quality Guidelines

### Formatting with Prettier

The monorepo uses Prettier with the following rules:

- No semicolons (`semi: false`)
- Double quotes (`singleQuote: false`)
- Print width: 100 characters (`printWidth: 100`)

Format code before committing:

```bash
pnpm format
```

### Linting with ESLint

- Run `pnpm lint` to check for syntax and style issues.
- Prefix unused variables or function parameters with `_` (e.g. `_signal`, `_ctx`).
- Avoid `any` types in application code; use specific interfaces or `unknown` parsed with Zod schemas.
- In `apps/web`, adhere strictly to React Hooks rules (no conditional hooks, exhaustive dependencies).

### TypeScript Guidelines

- All code must pass `pnpm typecheck` with zero errors.
- Never use non-null assertions (`!`) in production application code; use proper conditional guards or fallback values. (Non-null assertions are permitted only inside `.test.ts` files).

---

## 🔒 Security & Architectural Rules

All contributors must respect the core security rules outlined in [AGENTS.md](AGENTS.md):

1. **Zero Secret Leakage**:
   - Never commit `.env` files or API keys.
   - Encrypt all secrets using AES-256-GCM envelope encryption (`MESH_KEK`) via `@sayabot/llm`.
   - Never log secrets in plaintext; pass logs through `redactSecrets()`.
2. **PostgreSQL Advisory Locks**:
   - Turn execution in rooms must be protected with `withRoomLock(roomId, fn)`.
   - Never perform concurrent turn writes without the lock.
3. **Database Changes**:
   - Update schemas in `packages/db/src/schema/*.ts`.
   - Generate migrations with `pnpm db:generate`.
   - Ensure tenant isolation via Row Level Security (RLS) on all tables with `org_id`.
4. **Dangerous Tools**:
   - Any tool performing destructive writes, file deletions, bash commands, or external mutations must be marked `dangerous: true` to trigger human approval gates.
5. **Sandbox Isolation**:
   - File and command operations in `computerd` must remain strictly inside `/home/bot` or `/tmp`.

---

## 🧪 Testing Standards

Sayabot maintains high test coverage across all packages using **Vitest** and **Playwright**:

### Running Tests

```bash
# Run all unit tests
pnpm test

# Run tests for a specific workspace
pnpm --filter @sayabot/orchestrator test
pnpm --filter @sayabot/web test

# Run integration tests
pnpm test:integration

# Run Playwright E2E browser tests
pnpm e2e
```

### Writing Tests

- Place unit tests alongside the code under test (e.g. `service.ts` -> `service.test.ts`).
- Mock network requests, external databases, and LLM calls.
- Every new tool or connector must be accompanied by comprehensive unit tests covering:
  - Input schema validation.
  - Successful execution.
  - Error handling and timeouts.
  - Dangerous flag resolution.

---

## 🚀 Pull Request Workflow

Follow these steps when preparing a pull request:

### 1. Pre-Flight Verification Checklist

Before opening a PR, ensure all local checks pass:

```bash
pnpm typecheck      # Type check entire monorepo
pnpm lint           # Check ESLint rules
pnpm format         # Verify Prettier formatting
pnpm test           # Run Vitest test suites
```

### 2. Open a Pull Request

1. Push your branch to your GitHub fork:
   ```bash
   git push origin feat/my-awesome-feature
   ```
2. Navigate to [sayalabs/sayabot](https://github.com/sayalabs/sayabot) and click **New Pull Request**.
3. Select your branch against `main`.
4. Fill out the pull request template completely (`.github/pull_request_template.md`), including:
   - Clear summary of changes and user-facing impact.
   - Link to relevant issue (e.g. `Fixes #42`).
   - Database migration checklist (if schema changed).
   - Security audit checklist (encryption, advisory locks, RLS).
   - Test plan and verification evidence.
   - **AI Agent Co-Authorship Disclosure**: If you used Claude, Cursor, Copilot, Antigravity, or other AI assistants, declare it transparently.

### 3. Review & Merge

- Maintainers and CI bots will review your pull request.
- Address any reviewer feedback promptly.
- Once approved and CI checks pass, a maintainer will merge your PR using **Squash and Merge**.

---

## 🤝 Community & Support

- **Bug Reports**: Open an issue using the [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.yml).
- **Feature Requests**: Propose ideas using the [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.yml).
- **Connector Proposals**: Suggest new platform integrations using the [Connector Request Template](.github/ISSUE_TEMPLATE/connector_request.yml).
- **Documentation Issues**: Suggest fixes using the [Documentation Template](.github/ISSUE_TEMPLATE/documentation.yml).
- **Security Vulnerabilities**: For responsible disclosure of security issues, email security@sayalabs.in instead of opening a public issue.
