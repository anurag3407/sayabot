# Memory Schemas

This reference documents `packages/db/src/schema/memory.ts` — the five tables behind Sayabot's multi-tier memory system: `memories` (agent/room/org-scoped memories with cognitive and epistemic attributes), `memory_sources` (federated source registry), `open_loops` (cross-turn commitments and follow-ups), `memory_links` (the knowledge graph between memories), and `vector_providers` (org-configured embedding/vector backends). There is no separate `embeddings` table: embeddings are stored as a `real[]` column directly on `memories` (added by `packages/db/sql/0027_memory_v2.sql`), deliberately independent of pgvector — recall casts to `vector` only when the extension is installed and falls back to in-process cosine similarity otherwise.

The layer evolved in three migrations: `0011_memory.sql` created the core table with full-text search, `0016_cognitive_memory.sql` added the "GBrain-grade" epistemic columns plus `memory_sources`/`open_loops`/`memory_links`, and `0017_vector_providers.sql` + `0027_memory_v2.sql` added provider-configurable semantic recall.

Source files: `packages/db/src/schema/memory.ts`, `packages/db/src/schema/enums.ts`, `packages/db/sql/0011_memory.sql`, `packages/db/sql/0016_cognitive_memory.sql`, `packages/db/sql/0017_vector_providers.sql`, `packages/db/sql/0027_memory_v2.sql`

---

## Memories (`memories`)

Defined at `packages/db/src/schema/memory.ts:28` (table created `packages/db/sql/0011_memory.sql:14-34`). One row per remembered item. Scope determines visibility: `agent` (private to one bot), `room` (shared by bots in one room), `org` (workspace-wide). Rows can be pinned (never evicted), given a decay half-life, superseded by newer memories, and scored for confidence and emotional salience.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Memory id. |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Workspace. |
| `scope` | `memory_scope` enum | NOT NULL, default `"agent"` | `agent`, `room`, or `org` (`enums.ts:105`). |
| `agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE CASCADE` | Owning bot for `scope = "agent"` (and the room-scope owner for `scope = "room"`). |
| `room_id` | `uuid` | nullable, FK → `rooms.id`, `ON DELETE CASCADE` | Room binding for `scope = "room"`. |
| `kind` | `memory_kind` enum | NOT NULL, default `"fact"` | `fact`, `preference`, `decision`, `procedure`, `episode` (`enums.ts:106-112`). |
| `title` | `text` | NOT NULL | Short summary; also the dedup key (case-insensitive, see indexes). |
| `body` | `text` | NOT NULL | Full memory text. |
| `tags` | `text[]` | NOT NULL, default `[]` | Free-form tags for keyword search. |
| `source` | `memory_source` enum | NOT NULL, default `"agent"` | `agent`, `human`, `compaction`, `consolidation`, `import` (`enums.ts:113-119`). |
| `source_ref` | `text` | nullable | Pointer to where it came from (message id, document, …). |
| `confidence` | `numeric(4,3)` | NOT NULL, default `1.0`, mode `"number"` | Confidence score (0–1). |
| `pinned` | `boolean` | NOT NULL, default `false` | Pinned memories are always retrievable and skip decay. |
| `expires_at` | `timestamptz` | nullable | TTL for ephemeral memories. |
| `superseded_by` | `uuid` | nullable | Newer memory replacing this one. In Drizzle this is a bare uuid (`memory.ts:49`); the FK (`references public.memories(id) on delete set null`) exists only in the SQL migration (`0011_memory.sql:27`). |
| `created_by_user_id` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Human who wrote it. |
| `created_by_agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE SET NULL` | Bot that wrote it. |
| `last_used_at` | `timestamptz` | nullable | Last retrieval; feeds decay/LRU. |
| `use_count` | `integer` | NOT NULL, default `0` | Retrieval counter. |
| `perspective` | `text` | NOT NULL, default `"first_person"` | Narrative perspective (cognitive addition, `0016_cognitive_memory.sql:20`). |
| `emotional_salience` | `numeric(3,2)` | NOT NULL, default `0.5`, mode `"number"` | Importance weight used in ranking (`0016_cognitive_memory.sql:21`). |
| `epistemic_status` | `epistemic_status` enum | NOT NULL, default `"belief"` | `hypothesis`, `belief`, `verified`, `withdrawn`, `superseded` (`enums.ts:121-127`). |
| `evidence_refs` | `text[]` | NOT NULL, default `[]` | Pointers backing the belief (`0016_cognitive_memory.sql:23`). |
| `target_agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE SET NULL` | For agent→agent memories: the bot the memory is *about* (`0016_cognitive_memory.sql:24`). |
| `decay_half_life_days` | `integer` | NOT NULL, default `30` | Half-life for recall weighting (`0016_cognitive_memory.sql:25`). |
| `withdrawal_reason` | `text` | nullable | Why the memory was withdrawn (`epistemic_status = "withdrawn"`) (`0016_cognitive_memory.sql:26`). |
| `embedding` | `real[]` | nullable | Embedding vector from the org's active embedding provider (`0027_memory_v2.sql:18`). Stored as `real[]` so the column exists without pgvector; provider dimensions vary (768 Gemini, 1024 Voyage, 1536 OpenAI). |
| `embedding_model` | `text` | nullable | Model that produced the embedding (`0027_memory_v2.sql:19`). |
| `embedded_at` | `timestamptz` | nullable | When it was embedded (`0027_memory_v2.sql:20`). |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps. |

Indexes: the Drizzle schema declares `memories_scope_idx` on `(org_id, scope, agent_id, room_id)`, `memories_pinned_idx` on `(org_id, pinned)`, `memories_last_used_idx` on `(org_id, last_used_at)`, `memories_epistemic_idx` on `(org_id, epistemic_status)`, `memories_salience_idx` on `(org_id, emotional_salience)`, `memories_target_agent_idx` on `(org_id, target_agent_id)`, and `memories_agent_room_idx` on `(org_id, agent_id, room_id)` (`memory.ts:79-87`; SQL equivalents in `0011_memory.sql:37-40`, `0016_cognitive_memory.sql:28-31` — salience `desc`, `0027_memory_v2.sql:23-25`). SQL-only extras: `memories_tsv_idx`, a GIN index over the **generated `tsv` column** `to_tsvector('english', title || ' ' || body)` (`0011_memory.sql:21,33`) — the generated column exists only in SQL, not in the Drizzle schema — plus `memories_embedding_model_idx` on `(org_id, embedding_model)` and `memories_title_lower_idx` on `(org_id, scope, lower(title))` for write-time dedup (`0027_memory_v2.sql:27-31`).

**RLS** (`0011_memory.sql:53-85`): four policies (`memories_select_policy`, `memories_insert_policy`, `memories_update_policy`, `memories_delete_policy`) all requiring `public.is_org_member(org_id)` and — when the memory is room-bound — `public.can_read_room(room_id)`. `grant select, insert, update, delete` to `authenticated`, `grant all` to `service_role`. This is one of the few tables where authenticated clients may write directly (e.g. humans adding memories via settings).

**Used by**: the orchestrator memory service and its modules — retrieval, beliefs, consolidation, mirroring (`apps/orchestrator/src/memory/service.ts`, `modules/retrieval.ts`, `modules/beliefs.ts`, `mirror.ts`) — the `memory_search` tool (`apps/orchestrator/src/memory/tools.ts`), and web-side memory management (`apps/web/src/lib/actions/memory.ts`, storage view `apps/web/src/app/(workspace)/[org]/settings/storage/page.tsx`).

---

## Memory sources (`memory_sources`)

Defined at `packages/db/src/schema/memory.ts:92` (created `0016_cognitive_memory.sql:34-40`). Registry of where memories can originate, enabling multi-tenancy and federated visibility across systems that contribute memories.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `text` | PK | Composite identifier like `"agent:<uuid>"`, `"room:<uuid>"`, `"org:<uuid>"` (`memory.ts:95`). |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Workspace. |
| `name` | `text` | NOT NULL | Display name. |
| `federated` | `boolean` | NOT NULL, default `false` | True when the source is an external/federated system rather than a local agent/room. |
| `config` | `jsonb` | NOT NULL, default `{}` | Source-specific settings. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Creation time. |

Indexes: `memory_sources_org_idx` on `(org_id, federated)` (`memory.ts:104`).

**RLS** (`0016_cognitive_memory.sql:85-92`): `memory_sources_select_policy` (org members read) and `memory_sources_modify_policy` (`for all` with `using`/`check` on `is_org_member(org_id)`), granted `select, insert, update, delete` to `authenticated` and `all` to `service_role`.

**Used by**: `apps/orchestrator/src/memory/modules/sources.ts`, which maps scopes to source rows.

---

## Open loops (`open_loops`)

Defined at `packages/db/src/schema/memory.ts:109` (created `0016_cognitive_memory.sql:43-53`). Commitments, promises, and follow-ups that must survive across turns: a bot that said "I'll send the report tomorrow" gets an open loop the check-in/consolidation machinery keeps resurfacing until resolved.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Loop id. |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Workspace. |
| `agent_id` | `uuid` | NOT NULL, FK → `agents.id`, `ON DELETE CASCADE` | The bot on the hook (unlike `memories`, this is mandatory). |
| `room_id` | `uuid` | nullable, FK → `rooms.id`, `ON DELETE CASCADE` | Room the loop arose in. |
| `description` | `text` | NOT NULL | What remains to be done. |
| `status` | `open_loop_status` enum | NOT NULL, default `"open"` | `open`, `in_progress`, `blocked`, `resolved`, `dropped` (`enums.ts:129-135`). |
| `due_at` | `timestamptz` | nullable | When it should be resolved. |
| `blocker_reason` | `text` | nullable | Why it is stuck. |
| `resolution` | `text` | nullable | How it was resolved/dropped. |
| `source_ref` | `text` | nullable | Pointer to the originating message/task. |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps. |

Indexes: `open_loops_agent_status_idx` on `(org_id, agent_id, status)` and `open_loops_room_idx` on `(org_id, room_id)` (`memory.ts:129-132`).

**RLS** (`0016_cognitive_memory.sql:94-101`): `open_loops_select_policy` and `open_loops_modify_policy` — org member **and** room-readable when bound to a room (same predicate style as `memories`); granted to `authenticated` and `service_role`.

**Used by**: the memory service and open-loop modules (`apps/orchestrator/src/memory/service.ts`, `modules/open-loops.ts`), the "dream" consolidation module (`apps/orchestrator/src/memory/modules/dream.ts`), mirroring (`apps/orchestrator/src/memory/mirror.ts`), and the test suites (`apps/orchestrator/src/memory/memory.test.ts`, `mirror.test.ts`).

---

## Memory links (`memory_links`)

Defined at `packages/db/src/schema/memory.ts:137` (created `0016_cognitive_memory.sql:56-66`). Directed edges between memories — the knowledge-graph / concept-wikilink layer (`relates_to`, `depends_on`, `caused_by`, `contradicts`, `supersedes`, `supports` per `enums.ts:137-144`).

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Edge id. |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Workspace. |
| `source_memory_id` | `uuid` | NOT NULL, FK → `memories.id`, `ON DELETE CASCADE` | Edge tail (the memory making the link). |
| `target_memory_id` | `uuid` | nullable, FK → `memories.id`, `ON DELETE CASCADE` | Edge head (the memory being linked to); null when the target is unresolved. |
| `target_slug` | `text` | nullable | Wiki-style slug for the target concept, allowing links to not-yet-written memories. |
| `relationship` | `memory_link_type` enum | NOT NULL, default `"relates_to"` | Edge semantics (`enums.ts:137-144`). |
| `weight` | `numeric(3,2)` | NOT NULL, default `1.0`, mode `"number"` | Edge strength for graph ranking. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Creation time. |

Indexes: `memory_links_source_idx` on `(org_id, source_memory_id)`, `memory_links_target_idx` on `(org_id, target_memory_id)`, and `memory_links_slug_idx` on `(org_id, target_slug)` (`memory.ts:153-157`) — the last one resolves wikilinks written before the target memory exists.

**RLS** (`0016_cognitive_memory.sql:104-111`): `memory_links_select_policy` and `memory_links_modify_policy`, both `is_org_member(org_id)`; granted to `authenticated` and `service_role`.

**Used by**: graph traversal and belief contradiction checks (`apps/orchestrator/src/memory/modules/graph.ts`, `apps/orchestrator/src/memory/modules/beliefs.ts`) and the memory test suite (`apps/orchestrator/src/memory/memory.test.ts`).

---

## Vector & embedding providers (`vector_providers`)

Defined at `packages/db/src/schema/memory.ts:162` (created `packages/db/sql/0017_vector_providers.sql`). Org-configurable RAG backends: one row per configured vector database or embedding API, with its API key envelope-encrypted (`ciphertext`/`iv`/`tag`/`last4`, same scheme as `provider_keys`). Exactly one provider per `(org, kind)` is typically active.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Provider row id. |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Workspace. |
| `owner_user_id` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | User who configured it. |
| `kind` | `vector_provider_kind` enum | NOT NULL, default `"vector_db"` | `vector_db` (storage/search backend) or `embedding` (model that computes `memories.embedding`) (`enums.ts:153-156`). |
| `provider` | `text` | NOT NULL | Provider identifier (e.g. `qdrant`, `voyage`, `openai`). |
| `label` | `text` | NOT NULL | Display name. |
| `endpoint_url` | `text` | nullable | API endpoint for self-hosted/compatible providers. |
| `ciphertext` | `text` | NOT NULL | AES-256-GCM ciphertext of the API key. |
| `iv` | `text` | NOT NULL | Base64 nonce. |
| `tag` | `text` | NOT NULL | GCM auth tag. |
| `last4` | `text` | NOT NULL | Key suffix for UI. |
| `config` | `jsonb` | NOT NULL, default `{}` | Provider-specific options (dimensions, collection name, …). |
| `is_active` | `boolean` | NOT NULL, default `false` | The active provider of its `kind` drives new embeddings. |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps. |

Indexes: `vector_providers_org_idx` on `(org_id)` and `vector_providers_active_idx` on `(org_id, kind, is_active)` (`memory.ts:183-186`) — the latter is the "find the active embedding provider" lookup.

**RLS** (`0017_vector_providers.sql:53-57`): `revoke all` on the table from `anon`/`authenticated`/`public`; `grant all` to `service_role`; clients read the sanitized `vector_providers_public` **view** (which exposes `id`, `org_id`, `owner_user_id`, `kind`, `provider`, `label`, `endpoint_url`, `last4`, `config`, `is_active`, timestamps — no ciphertext) filtered by `is_org_member(org_id)` (`0017_vector_providers.sql:33-48`).

**Used by**: the memory service selecting the active provider (`apps/orchestrator/src/memory/service.ts`) and the embeddings module that embeds/backs fills memories (`apps/orchestrator/src/memory/modules/embeddings.ts`).

---

## Type exports

The module exports inferred row types used across the orchestrator (`memory.ts:191-197`): `MemoryRow`, `NewMemoryRow`, `MemorySourceRow`, `OpenLoopRow`, `MemoryLinkRow`, `VectorProviderRow`, `NewVectorProviderRow`.

---

## Discrepancy notes (code vs AGENTS.md)

- AGENTS.md describes memory as a capability flag only; the schema is considerably richer than the manual implies (epistemic status, decay, graph links, open loops). No contradiction, but the manual's one-line description undersells the table set.
- Two SQL-only schema elements are invisible to drizzle-kit and would be lost if the table were regenerated from the Drizzle schema: the `superseded_by` FK (`0011_memory.sql:27`) and the generated `tsv` tsvector column + its GIN index (`0011_memory.sql:21,33`). The Drizzle schema deliberately models `supersededBy` as a bare uuid; treat `sql/` as the source of truth for both.
- The `memoryScopeEnum`/`memoryKindEnum`/etc. declared in `packages/db/src/schema/enums.ts:105-156` are all created by the SQL migrations with `exception when duplicate_object then null` guards (`0016_cognitive_memory.sql:4-14`), so enum creation is idempotent regardless of whether the Drizzle snapshot ran first.

---

## Related docs

- [Database reference overview](./overview.md)
- [Tasks & owner facts schemas](./schema-tasks-and-facts.md)
- [Agents & templates schemas](./schema-agents-and-templates.md)
- [Migrations catalog](./migrations-catalog.md)
- [RLS & Realtime deep dive](./rls-and-realtime.md)
