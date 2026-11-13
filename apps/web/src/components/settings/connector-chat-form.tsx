"use client"

import { saveConnectorChat } from "@/lib/actions/connectors"
import { ActionForm } from "@/components/ui/action-form"
import { Field, HelpText, Select } from "@/components/ui/field"

export function ConnectorChatForm({
  orgSlug,
  connectorId,
  source,
  rooms,
  agents,
  inbound,
}: {
  orgSlug: string
  connectorId: string
  source: string
  rooms: Array<{ id: string; name: string; turnMode: string }>
  agents: Array<{ id: string; handle: string; displayName: string }>
  inbound: { enabled?: boolean; roomId?: string; agentId?: string; allowedChats?: string[] } | null
}) {
  return (
    <ActionForm action={saveConnectorChat} submitLabel={inbound?.enabled ? "Update chat" : "Turn on chat"} className="mt-3 max-w-xl">
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="connectorId" value={connectorId} />
      <p className="text-[12px] text-muted">
        A message sent to this bot starts a turn in the room, as if someone typed @the agent. The agent&apos;s answer
        is sent back to that chat. Use a mentions room, or a direct room with just that agent.
      </p>
      <label className="flex items-center gap-2 text-[13px] text-text">
        <input type="checkbox" name="enabled" defaultChecked={inbound?.enabled !== false} />
        Answer messages
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Room" htmlFor={`chat-room-${connectorId}`}>
          <Select id={`chat-room-${connectorId}`} name="roomId" defaultValue={inbound?.roomId ?? rooms[0]?.id}>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
                {room.turnMode === "mentions" ? " (mentions)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Agent" htmlFor={`chat-agent-${connectorId}`}>
          <Select id={`chat-agent-${connectorId}`} name="agentId" defaultValue={inbound?.agentId ?? agents[0]?.id}>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                @{agent.handle} · {agent.displayName}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Only these chats (optional)" htmlFor={`chat-allow-${connectorId}`}>
        <input
          id={`chat-allow-${connectorId}`}
          name="allowedChats"
          defaultValue={inbound?.allowedChats?.join(", ") ?? ""}
          placeholder={source === "whatsapp" ? "14155550123" : "chat or channel id"}
          className="w-full rounded-md border border-border bg-ink px-2 py-1.5 text-[13px]"
        />
        <HelpText>Blank means any chat that messages the bot. Discord also needs Message Content Intent.</HelpText>
      </Field>
    </ActionForm>
  )
}
