-- 0025_storage_summary.sql
-- What a workspace stores, measured in the database: chat history, files (canvases and their
-- versions), memory, tool activity and agent computers, with per-agent and per-room breakdowns.
-- security definer so it can sum across tables, but it refuses anyone outside the workspace.

create or replace function public.storage_summary(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_org_member(p_org) and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'not a member of this workspace';
  end if;

  with org_rooms as (
    select id from public.rooms where org_id = p_org
  ),
  msg as (
    select m.room_id, m.sender_type, m.sender_id,
           octet_length(m.content) + coalesce(octet_length(m.metadata::text), 0) as bytes
    from public.messages m
    where m.room_id in (select id from org_rooms)
  ),
  canvas as (
    select c.room_id,
           octet_length(c.snapshot_text) + coalesce(octet_length(c.ydoc_state), 0)
             + coalesce((select sum(octet_length(v.snapshot_text)) from public.canvas_versions v where v.canvas_id = c.id), 0) as bytes
    from public.canvases c
    where c.room_id in (select id from org_rooms)
  ),
  mem as (
    select agent_id, octet_length(title) + octet_length(body) as bytes
    from public.memories where org_id = p_org
  ),
  tools as (
    select t.room_id, coalesce(octet_length(t.args::text), 0) + coalesce(octet_length(t.result::text), 0) as bytes
    from public.tool_calls t
    where t.room_id in (select id from org_rooms)
  ),
  computers as (
    select agent_id, disk_used_mb::bigint * 1048576 as bytes from public.agent_computers where org_id = p_org
  )
  select jsonb_build_object(
    'measured_at', now(),
    'chat', jsonb_build_object('bytes', coalesce((select sum(bytes) from msg), 0), 'count', (select count(*) from msg)),
    'files', jsonb_build_object('bytes', coalesce((select sum(bytes) from canvas), 0), 'count', (select count(*) from canvas)),
    'memory', jsonb_build_object('bytes', coalesce((select sum(bytes) from mem), 0), 'count', (select count(*) from mem)),
    'tools', jsonb_build_object('bytes', coalesce((select sum(bytes) from tools), 0), 'count', (select count(*) from tools)),
    'computers', jsonb_build_object('bytes', coalesce((select sum(bytes) from computers), 0), 'count', (select count(*) from computers)),
    'agents', coalesce((
      select jsonb_agg(row_to_json(a)) from (
        select ag.id as agent_id,
               coalesce((select sum(bytes) from msg where sender_type = 'agent' and sender_id = ag.id), 0) as chat_bytes,
               (select count(*) from msg where sender_type = 'agent' and sender_id = ag.id) as messages,
               coalesce((select sum(bytes) from mem where agent_id = ag.id), 0) as memory_bytes,
               (select count(*) from mem where agent_id = ag.id) as memories,
               coalesce((select sum(bytes) from computers where agent_id = ag.id), 0) as computer_bytes
        from public.agents ag where ag.org_id = p_org
      ) a
    ), '[]'::jsonb),
    'rooms', coalesce((
      select jsonb_agg(row_to_json(r)) from (
        select o.id as room_id,
               coalesce((select sum(bytes) from msg where room_id = o.id), 0)
                 + coalesce((select sum(bytes) from canvas where room_id = o.id), 0)
                 + coalesce((select sum(bytes) from tools where room_id = o.id), 0) as bytes,
               (select count(*) from msg where room_id = o.id) as messages,
               (select count(*) from canvas where room_id = o.id) as files
        from org_rooms o
        order by 2 desc
        limit 10
      ) r
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.storage_summary(uuid) from public, anon;
grant execute on function public.storage_summary(uuid) to authenticated, service_role;
