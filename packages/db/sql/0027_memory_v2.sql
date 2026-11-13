-- 0027_memory_v2.sql
-- Memory layer v2: semantic recall columns and indexes for agent+room private memory
-- and write-time deduplication.
-- Idempotent: migrate.ts re-applies every file in sql/ on each run.

-- 1. pgvector is optional. Recall casts real[] -> vector when the extension exists and
--    falls back to in-process cosine similarity when it does not, so a missing extension
--    (or missing permission to create it) must never fail the migration.
do $$ begin
  create extension if not exists vector;
exception when others then
  raise notice 'pgvector unavailable (%); semantic recall will use the in-process fallback', sqlerrm;
end $$;

-- 2. Embedding columns. real[] keeps the column independent of pgvector and of the
--    provider's dimension (768 Gemini, 1024 Voyage, 1536 OpenAI).
alter table public.memories
  add column if not exists embedding real[],
  add column if not exists embedding_model text,
  add column if not exists embedded_at timestamptz;

-- 3. Agent-private memories are now bound to (agent, room) as well as agent-wide.
create index if not exists memories_agent_room_idx
  on public.memories (org_id, agent_id, room_id);

-- Backfill and re-embed scans: rows without an embedding for the active model.
create index if not exists memories_embedding_model_idx
  on public.memories (org_id, embedding_model);

-- 4. Case-insensitive title lookups used by write-time deduplication.
create index if not exists memories_title_lower_idx
  on public.memories (org_id, scope, lower(title));
