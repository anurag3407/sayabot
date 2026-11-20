-- One gateway, one chat, one room.
-- Existing gateways keep the conversation that spoke most recently. Older rooms stay; new
-- messages from any other chat are refused and do not open another room.

alter table agent_gateways
  add column if not exists bound_chat_id text,
  add column if not exists room_id uuid references rooms (id) on delete set null;

create unique index if not exists agent_gateways_room_idx
  on agent_gateways (room_id) where room_id is not null;

update agent_gateways g
set room_id = picked.room_id,
    bound_chat_id = picked.external_chat_id
from (
  select distinct on (gateway_id) gateway_id, room_id, external_chat_id
  from external_chats
  order by gateway_id, last_message_at desc nulls last, created_at desc
) picked
where g.id = picked.gateway_id
  and g.room_id is null;
