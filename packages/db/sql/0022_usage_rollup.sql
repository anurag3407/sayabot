-- 0022_usage_rollup.sql
-- Exact usage totals for the analytics page, summed in the database. The page used to add up
-- raw rows in the browser, and the API row cap silently dropped the newest calls.
-- security invoker: the caller's RLS on usage_events still decides what they can see.

create index if not exists usage_events_org_agent_created_idx
  on public.usage_events (org_id, agent_id, created_at);

create or replace function public.usage_rollup(p_org uuid, p_since timestamptz)
returns table (
  agent_id uuid,
  room_id uuid,
  provider text,
  model text,
  kind text,
  requests bigint,
  input_tokens bigint,
  output_tokens bigint,
  cached_input_tokens bigint,
  cost_usd numeric,
  last_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.agent_id,
    e.room_id,
    e.provider,
    e.model,
    e.kind,
    count(*)::bigint,
    coalesce(sum(e.input_tokens), 0)::bigint,
    coalesce(sum(e.output_tokens), 0)::bigint,
    coalesce(sum(e.cached_input_tokens), 0)::bigint,
    coalesce(sum(e.cost_usd), 0)::numeric,
    max(e.created_at)
  from public.usage_events e
  where e.org_id = p_org and e.created_at >= p_since
  group by e.agent_id, e.room_id, e.provider, e.model, e.kind
$$;

revoke all on function public.usage_rollup(uuid, timestamptz) from public, anon;
grant execute on function public.usage_rollup(uuid, timestamptz) to authenticated, service_role;
