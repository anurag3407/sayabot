## 📋 Summary

<!-- Briefly describe the purpose of this PR, the core problem it solves, and the technical implementation approach. -->

- **What was changed?**:
- **Why was this change necessary?**:
- **How was it implemented?**:

---

## 🏷️ Type of Change

<!-- Mark the appropriate type with an [x]. -->

- [ ] `feat`: A new user-facing feature or agent capability
- [ ] `fix`: A bug fix
- [ ] `refactor`: Code change that neither fixes a bug nor adds a feature
- [ ] `perf`: A code change that improves performance
- [ ] `db`: Database schema migration or RLS policy change
- [ ] `sec`: Security hardening or vulnerability fix
- [ ] `docs`: Documentation updates or additions
- [ ] `chore`: Maintenance, dependency upgrades, or CI/workflow updates
- [ ] `test`: Adding missing tests or correcting existing tests

---

## 🔗 Related Issues

<!-- Closes #123 / Fixes #456 -->

- Resolves: #

---

## 🏛️ Monorepo & Architectural Impact

<!-- Check all components and subsystems impacted by this change. -->

- [ ] `apps/web` (Next.js 16 App Router, Tailwind, Monaco Editor, Visual Canvas)
- [ ] `apps/orchestrator` (Hono API Engine, Turn Lifecycle, Cron Engine, Tools)
- [ ] `apps/computerd` (Docker Sandbox Runner, Persistent Linux Environment)
- [ ] `apps/mobile` (React Native, Expo SDK 52, OTA Updates)
- [ ] `apps/desktop` (Tauri Desktop Companion, System Tray Host)
- [ ] `apps/egress` (HTTP/TCP Egress Bastion & Security Proxy)
- [ ] `packages/db` (Drizzle ORM, Supabase/PostgreSQL, Schema, Migrations)
- [ ] `packages/llm` (LLM Provider Integrations: Anthropic, OpenAI, Gemini, Ollama)
- [ ] `packages/core` (Shared Interfaces, Schemas, Validation Utilities)
- [ ] `connectors` (Slack, Google Drive, GitHub, Jira Integrations)
- [ ] `mcp-gateway` (Model Context Protocol Gateway & Tools)
- [ ] `docs/` (Architecture, Self-Hosting, Connector Guides)

### Architectural Notes

<!-- Describe any new abstractions, cross-service RPC contracts, data flows, or breaking changes. -->

---

## 🗄️ Database Migration Checklist

<!-- Complete this section if modifying packages/db/src/schema or database tables. -->
<!-- If no database changes are included, check "N/A" below. -->

- [ ] **N/A - No database changes in this PR**

If database changes are included:

- [ ] Schema changes updated in `packages/db/src/schema/`
- [ ] Migration generated using `pnpm db:generate` and committed to `packages/db/drizzle/`
- [ ] Migration verified locally against a clean PostgreSQL instance (`pnpm db:migrate`)
- [ ] **Row-Level Security (RLS)** policies defined and verified for all multi-tenant tables
- [ ] Backward compatibility ensured: existing records and older app versions will not crash
- [ ] Rollback strategy verified in case of deployment failure

---

## 🧪 Automated Testing & Verification

<!-- Ensure all quality gates are satisfied before requesting review. -->

### Local Quality Gates

- [ ] `pnpm test` (Vitest unit test suite passes across all packages)
- [ ] `pnpm test:integration` (Integration tests pass)
- [ ] `pnpm typecheck` (Monorepo TypeScript validation passes via Turbo)
- [ ] `pnpm typecheck:e2e` (E2E TypeScript validation passes)
- [ ] `pnpm lint` (ESLint checks pass with zero errors)
- [ ] `pnpm format` (Prettier formatting applied)
- [ ] `pnpm test:e2e:api` (Playwright API and navigation smoke tests pass)

### New Test Coverage

- [ ] Unit tests added for new services, tools, or utility functions
- [ ] Integration tests added for database migrations or cross-service API routes
- [ ] Regression test added reproducing the reported issue (for bug fixes)

---

## 🔒 Security & Privacy Audit

<!-- Sayabot enforces a strict zero-trust and envelope-encryption security perimeter. -->

- [ ] **Envelope Encryption**: Any connector tokens, API keys, or credentials use AES-256-GCM envelope encryption with `MESH_KEK` (`ciphertext`, `iv`, `tag`).
- [ ] **Zero Secret Leakage**: No raw API keys, passwords, database URLs, or tokens are logged or returned to client responses.
- [ ] **Multi-Tenant RLS**: Row-Level Security policies prevent cross-tenant workspace/room data leaks.
- [ ] **Input Validation**: All endpoints and tool parameters use strict Zod / Hono schema validation.
- [ ] **Internal Secrets**: Internal orchestrator-computerd endpoints require `ORCHESTRATOR_INTERNAL_SECRET` authentication.
- [ ] **Sandbox & Egress Isolation**: Tool executions respect sandbox boundaries and egress proxy restrictions.
- [ ] **Approval Gates**: Destructive actions (file deletion, external dispatch, table drop) are gated by human-in-the-loop approval.

---

## 📚 Documentation Checklist

- [ ] Relevant documentation updated in `docs/` (`self-hosting.md`, `architecture.md`, `connectors.md`, etc.)
- [ ] `README.md` updated if environment variables, CLI commands, or high-level architecture changed
- [ ] JSDoc / TSDoc comments added to newly exported functions, interfaces, and schemas
- [ ] N/A - No documentation changes required

---

## 🤖 AI Agent Co-Authorship & Assisted Coding Disclosure

<!-- In the spirit of transparency, please disclose any AI agent tools used to generate or assist with this code. -->

- [ ] **Human-Authored**: Written entirely by human developer.
- [ ] **AI-Assisted / Co-Authored**:
  - **Tool / Agent**: [e.g., Antigravity, Claude Code, Codex, Cursor, GitHub Copilot]
  - **Scope / Prompts**: [e.g., Scaffolded connector boilerplate, generated Vitest test suites, wrote migration SQL]
  - **Human Review**: I confirm that every line of the diff has been manually reviewed and verified for correctness, safety, and security.

---

## 📸 Screenshots / Visual Verification

<!-- If this PR modifies the Web UI, Mobile App, Monaco editor, or Visual Canvas, attach screenshots or a GIF recording below. -->
