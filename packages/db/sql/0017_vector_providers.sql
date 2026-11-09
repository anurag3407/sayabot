-- 0017_vector_providers.sql
-- Vector DB & Embedding Providers configuration for Cognitive Memory / RAG

-- 1. Create vector provider kind enum
do $$ begin
  create type public.vector_provider_kind as enum ('vector_db', 'embedding');
exception
  when duplicate_object then null;
end $$;

-- 2. Create vector_providers table
create table if not exists public.vector_providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  owner_user_id uuid references public.profiles(id) on delete set null,
  kind public.vector_provider_kind not null default 'vector_db',
  provider text not null,
  label text not null,
  endpoint_url text,
  ciphertext text not null,
  iv text not null,
  tag text not null,
  last4 text not null,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Indexes
create index if not exists vector_providers_org_idx on public.vector_providers(org_id);
create index if not exists vector_providers_active_idx on public.vector_providers(org_id, kind, is_active);

-- 4. Safe public view without ciphertext
create or replace view public.vector_providers_public as
select
  id,
  org_id,
  owner_user_id,
  kind,
  provider,
  label,
  endpoint_url,
  last4,
  config,
  is_active,
  created_at,
  updated_at
from public.vector_providers
where public.is_org_member(org_id);

-- 5. RLS and Grants
alter table public.vector_providers enable row level security;

revoke all on public.vector_providers from anon, authenticated, public;
grant select on public.vector_providers_public to authenticated;
grant all on public.vector_providers to service_role;
