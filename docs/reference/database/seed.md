# Seed Script

`packages/db/src/seed.ts` bootstraps a fresh Sayabot database with the two datasets every deployment needs: the **model pricing table** used to cost agent runs, and the **curated agent templates** offered in the "new agent" gallery. It is a standalone `tsx` entrypoint — run it with `pnpm db:seed` after `pnpm db:migrate` — and it is fully idempotent: prices insert only if missing, templates upsert (refresh) on every run.

Source files: `packages/db/src/seed.ts`, `packages/db/src/schema/ops.ts` (`model_pricing`), `packages/db/src/schema/templates.ts` (`agent_templates`), `packages/db/src/templates/*.md` (system prompts)

---

## How to run

```bash
# From the repo root
pnpm db:seed
```

The root script delegates to the package (`package.json:14`: `"db:seed": "pnpm --filter @sayabot/db seed"`), which runs `tsx src/seed.ts` (`packages/db/package.json`). The script:

1. Loads the repo-root `.env` (`src/seed.ts:12`).
2. Connects via `createDb(requireDatabaseUrl())` — it fails fast with `"DATABASE_URL is not set"` when the variable is missing (`src/seed.ts:14`, `src/client.ts:24-28`).
3. Inserts pricing, then templates, printing progress lines.
4. Closes the pool in a `finally` block (`src/seed.ts:294-296`).

Run order matters: the `agent_templates` upsert relies on the unique `agent_templates_org_slug_idx` with `nulls not distinct` (created by Drizzle migration `0000` and fixed by `sql/0015_agent_templates_unique.sql`), and the `model_pricing` composite PK exists from `0000` — so seed **after** `pnpm db:migrate`.

---

## What it seeds

### 1. Model pricing (`model_pricing`)

Twelve rows at `src/seed.ts:28-41`, inserted with `.onConflictDoNothing()` on the `(provider, model)` primary key — existing rows are never touched, so manual price edits survive re-seeding (`src/seed.ts:259`):

| Provider | Model | Input $/Mtok | Output $/Mtok |
| :--- | :--- | ---: | ---: |
| openai | gpt-4o | 2.50 | 10.00 |
| openai | gpt-4o-mini | 0.15 | 0.60 |
| openai | gpt-4.1 | 2.00 | 8.00 |
| openai | gpt-4.1-mini | 0.40 | 1.60 |
| openai | o3-mini | 1.10 | 4.40 |
| anthropic | claude-sonnet-4-20250514 | 3.00 | 15.00 |
| anthropic | claude-opus-4-20250514 | 15.00 | 75.00 |
| anthropic | claude-3-5-haiku-latest | 0.80 | 4.00 |
| google | gemini-2.5-pro | 1.25 | 10.00 |
| google | gemini-2.5-flash | 0.30 | 2.50 |
| groq | llama-3.3-70b-versatile | 0.59 | 0.79 |
| cerebras | llama-3.3-70b | 0.85 | 1.20 |

### 2. Curated agent templates (`agent_templates`)

Nine templates defined in `CURATED_TEMPLATES` (`src/seed.ts:54-256`), all seeded with `orgId: null` — global templates visible to every workspace (the `agent_templates_read` policy from `sql/0009_bot_platform.sql` allows reading rows with `org_id is null`). Each insert/upsert fills `slug`, `name`, `description`, `icon`, `category`, `systemPrompt`, `defaultModel`, `capabilities`, and `secretSlots`.

The system prompt body comes from a Markdown file: `loadTemplatePrompt(slug)` reads `packages/db/src/templates/<slug>.md` and returns `""` when the file is missing (`src/seed.ts:19-26`). All nine prompts ship in the repo (`researcher.md`, `coder.md`, `reviewer.md`, `designer.md`, `writer.md`, `analyst.md`, `ops.md`, `assistant.md`, `blank.md`).

| Slug | Name | Category | Default model hint | Distinct capabilities |
| :--- | :--- | :--- | :--- | :--- |
| `researcher` | Researcher | research | `claude-sonnet-4-20250514` | `computer: { profile: "browser" }`; no sandbox/github/postgres/secrets |
| `coder` | Coder | engineering | `gpt-4o` | `computer: { profile: "standard" }`, github, secrets |
| `reviewer` | Code Reviewer | engineering | `claude-sonnet-4-20250514` | github only; no computer, postgres, secrets |
| `designer` | Designer | design | `gemini-2.5-pro` | `computer: { profile: "browser" }` |
| `writer` | Writer | writing | `claude-sonnet-4-20250514` | Minimal: canvas + tasks + web search |
| `analyst` | Data Analyst | data | `gpt-4o` | `computer: { profile: "standard" }`, postgres, secrets |
| `ops` | Ops / On-call | ops | `gpt-4.1` | `computer: { profile: "standard" }`, secrets, mcp |
| `assistant` | General Assistant | general | `gpt-4o` | Full `DEFAULT_CAPABILITIES` |
| `blank` | Blank | general | `gpt-4o-mini` | Explicit minimal set (canvas, tasks, memory, subagents, cron, connectors) |

Most templates spread `DEFAULT_CAPABILITIES` from `@sayabot/core` and override individual flags; `blank` spells out its full capability object so it stays deliberately minimal.

**Secret slots** pre-declare the vault grants a template's agent will need — when a user instantiates the template, Sayabot knows which secrets to ask for. Seeded slots (`SecretSlot` shape at `packages/db/src/schema/templates.ts:15-25`):

- `coder`: `GITHUB_TOKEN` (required, header `Authorization: Bearer {secret}`, hosts `api.github.com`, `github.com`, `*.githubusercontent.com`, help link to GitHub token settings).
- `reviewer`: `GITHUB_TOKEN` (optional, read-only review, hosts `api.github.com`, `github.com`).
- `analyst`: `DATABASE_URL` (optional, basic-auth inject, hosts `*.supabase.co`, `*.postgres.database.azure.com`).
- `ops`: `SLACK_BOT_TOKEN` (optional, header) and `PAGERDUTY_TOKEN` (optional, header `Token token={secret}`).

---

## Idempotency

- **Pricing**: `.onConflictDoNothing()` on the `(provider, model)` PK — first write wins, later runs are no-ops (`src/seed.ts:259`).
- **Templates**: `.onConflictDoUpdate` targeted on `[agentTemplates.orgId, agentTemplates.slug]`, refreshing `name`, `description`, `icon`, `category`, `systemPrompt`, `defaultModel`, `capabilities`, `secretSlots`, and bumping `updatedAt` to `now()` (`src/seed.ts:278-291`). Re-seeding **overwrites** template rows with the shipped content — including templates an admin may have customized in the DB, since all seeded rows are global (`org_id` null). Org-scoped templates (rows with a real `org_id`) are never touched because the conflict target never matches them.
- The upsert for global rows works only because `sql/0015_agent_templates_unique.sql` rebuilt the unique index with `nulls not distinct`; with plain NULL-distinct semantics `ON CONFLICT` would insert duplicates on every run.

---

## Target table: `agent_templates`

The templates land in `agent_templates` (defined at `packages/db/src/schema/templates.ts:32`). Columns the seed fills:

| Column | Type | Seeded value |
| :--- | :--- | :--- |
| `org_id` | `uuid`, nullable FK → `orgs.id` | Always `null` — global template. |
| `slug` | `text`, NOT NULL | e.g. `researcher`; conflict target together with `org_id`. |
| `name` | `text`, NOT NULL | Display name. |
| `description` | `text`, NOT NULL, default `""` | One-line gallery description. |
| `icon` | `text`, nullable | Icon identifier (e.g. `search`, `code`). |
| `category` | `text`, NOT NULL, default `"general"` | Gallery grouping. |
| `system_prompt` | `text`, NOT NULL, default `""` | Body of `src/templates/<slug>.md`. |
| `default_provider` | `provider` enum, nullable | Not set by the seed (only `default_model` is). |
| `default_model` | `text`, nullable | The template's model hint. |
| `capabilities` | `jsonb`, NOT NULL | `AgentCapabilities` object per template. |
| `secret_slots` | `jsonb`, NOT NULL, default `[]` | Array of `SecretSlot` objects (below). |
| `starter_tasks` | `jsonb`, NOT NULL, default `[]` | Not set by the seed (stays `[]`). |

## `SecretSlot` shape

Each secret slot (interface at `packages/db/src/schema/templates.ts:15-25`) describes one credential the templated agent will need:

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `envName` | `string` | Environment name the grant will use (e.g. `GITHUB_TOKEN`). |
| `label` | `string` | Human-readable prompt shown when collecting the secret. |
| `kind` | `"api_token" \| "basic_auth" \| "password" \| "header_set" \| "github_app"` | Matches the `vault_secret_kind` enum. |
| `hosts` | `string[]` | Host allowlist for the future `agent_secret_grants` row. |
| `inject` | `{ mode, template?, param? }` | How the secret broker injects it (header/basic/query/body). |
| `methods` | `string[]?` | Optional HTTP method restriction. |
| `requiresApproval` | `boolean?` | Whether using the grant needs human approval. |
| `required` | `boolean` | Whether the agent cannot run without it. |
| `helpUrl` | `string?` | Where to obtain the token (e.g. GitHub token settings). |

---

## Verifying a seed run

A successful run prints exactly two progress lines before exiting (`src/seed.ts:260`, `src/seed.ts:293`):

```
Seeded 12 model prices (existing rows untouched).
Seeded 9 curated agent templates.
```

Quick SQL sanity checks:

```sql
select count(*) from model_pricing;      -- 12
select slug, category from agent_templates
  where org_id is null order by slug;    -- 9 rows, org_id null
```

Re-running the script prints the same lines: prices are skipped silently (`onConflictDoNothing`), templates are updated in place (`onConflictDoUpdate`).

---

## What it does not seed

The seed script touches exactly two tables. It does **not** create organizations, memberships, rooms, agents, or routines — those are created by the onboarding flow at runtime (and `room_schedules` rows are backfilled by `sql/0005_ia.sql`, not by the seed). It also does not seed anything Cloud-specific (`org_plans` / `org_usage_monthly` start empty even on Sayabot Cloud).

---

## Related docs

- [Database reference overview](./overview.md)
- [Migrations catalog](./migrations-catalog.md)
- [RLS & Realtime deep dive](./rls-and-realtime.md)
- [Connectors & Vault schemas](./schema-connectors-and-vault.md)
- [Engine, Tools & Ops schemas](./schema-engine-tools-ops.md)
- [Billing schema](./schema-billing.md)
- [Computers, Devices & Desktop schemas](./schema-computers-devices-desktop.md)
