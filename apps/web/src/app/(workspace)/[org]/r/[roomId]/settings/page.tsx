import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { agentModelText } from "@sayabot/core"
import { requireRoomAccess } from "@/lib/auth"
import { sayaAiPublic } from "@/lib/env"
import {
  listMemberViews,
  listOrgAgents,
  listRoomAgents,
  listRoomMemberRows,
} from "@/lib/queries"
import { loadRoomSchedule } from "@/lib/queries-ia"
import {
  addAgentToRoom,
  addRoomMember,
  removeAgentFromRoom,
  removeRoomMember,
  updateRoomSettings,
} from "@/lib/actions/rooms"
import { ActionForm } from "@/components/ui/action-form"
import { Field, HelpText, Input, Select, Textarea } from "@/components/ui/field"
import { EmptyState } from "@/components/ui/empty"
import { Section } from "@/components/settings/section"
import { AgentOrderEditor } from "@/components/rooms/agent-order-editor"
import { DeleteRoomButton } from "@/components/rooms/delete-room-button"
import { RoomScheduleForm } from "@/components/rooms/room-schedule-form"
import { TURN_MODE_LABELS } from "@/lib/format"

export const metadata: Metadata = { title: "Room settings" }

export default async function RoomSettingsPage({
  params,
}: {
  params: Promise<{ org: string; roomId: string }>
}) {
  const { org: orgSlug, roomId } = await params
  const access = await requireRoomAccess(orgSlug, roomId)
  const saya = sayaAiPublic()
  if (!access.canAdmin) redirect(`/${orgSlug}/r/${roomId}`)

  const [roomAgents, orgAgents, schedule, orgMembers, roomMembers] = await Promise.all([
    listRoomAgents(roomId),
    listOrgAgents(access.org.id),
    loadRoomSchedule(roomId),
    listMemberViews(access.org.id),
    listRoomMemberRows(roomId),
  ])
  const roomMemberIds = new Set(roomMembers.map((member) => member.userId))
  const memberNames = new Map(orgMembers.map((member) => [member.userId, member.displayName]))
  const availableMembers = orgMembers.filter((member) => !roomMemberIds.has(member.userId))
  const roomAgentIds = new Set(roomAgents.map(({ agent }) => agent.id))
  const availableAgents = orgAgents.filter((agent) => !roomAgentIds.has(agent.id))
  const roomAgentOptions = roomAgents.map(({ agent }) => ({
    id: agent.id,
    handle: agent.handle,
    displayName: agent.displayName,
  }))
  const initialOrder = access.room.debateOrder.length
    ? access.room.debateOrder
    : roomAgentOptions.map((agent) => agent.id)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
        <p className="font-mono text-[12px] text-faint">
          <Link href={`/${orgSlug}/r/${roomId}`} className="hover:text-text">
            #{access.room.name}
          </Link>{" "}
          / settings
        </p>
        <h1 className="mt-1 text-2xl font-medium tracking-[-0.02em]">Room settings</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
          How agents behave here, their limits, and who is in the room. Room and workspace admins
          can change these.
        </p>

        <div className="mt-6 space-y-8">
          <Section
            title="How agents reply"
            description="Choose when agents speak, and set limits so a conversation cannot run away or overspend."
          >
            <ActionForm action={updateRoomSettings} submitLabel="Save room settings">
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="roomId" value={roomId} />
              <div className="grid gap-3 sm:grid-cols-[1fr_260px]">
                <Field label="name" htmlFor="room-name">
                  <Input id="room-name" name="name" defaultValue={access.room.name} required />
                </Field>
                <Field label="agents reply" htmlFor="turn-mode">
                  <Select id="turn-mode" name="turnMode" defaultValue={access.room.turnMode}>
                    {Object.entries(TURN_MODE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="agent replies per message" htmlFor="turn-cap" hint="1 to 10">
                  <Input
                    id="turn-cap"
                    name="turnCap"
                    type="number"
                    min={1}
                    max={10}
                    defaultValue={access.room.turnCap}
                    className="font-mono"
                  />
                </Field>
                <Field label="agent runs per minute" htmlFor="rpm" hint="blank = no limit">
                  <Input
                    id="rpm"
                    name="rpmLimit"
                    type="number"
                    min={1}
                    defaultValue={access.room.rpmLimit ?? ""}
                    className="font-mono"
                  />
                </Field>
                <Field label="daily budget (USD)" htmlFor="budget" hint="blank = no limit">
                  <Input
                    id="budget"
                    name="dailyBudgetUsd"
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={access.room.dailyBudgetUsd ?? ""}
                    className="font-mono"
                  />
                </Field>
              </div>

              <Field label="room instructions" htmlFor="directive" hint="every agent here follows these">
                <Textarea
                  id="directive"
                  name="systemDirective"
                  defaultValue={access.room.systemDirective ?? ""}
                  className="min-h-24"
                  placeholder="Keep answers short. Prefer concrete file paths and commands."
                />
              </Field>

              <Field
                label="moderator"
                htmlFor="moderator"
                hint="needed for moderated rooms"
              >
                <Select
                  id="moderator"
                  name="moderatorAgentId"
                  defaultValue={access.room.moderatorAgentId ?? ""}
                >
                  <option value="">none</option>
                  {roomAgentOptions.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      @{agent.handle} · {agent.displayName}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="speaking order in debates">
                <AgentOrderEditor agents={roomAgentOptions} initialOrder={initialOrder} />
              </Field>

              <HelpText>
                When a limit is reached, agents stop and a note appears in the chat. Costs are estimated
                from the prices in Settings.
              </HelpText>
            </ActionForm>
          </Section>

          {access.room.kind !== "dm" ? (
            <Section
              title="Meetings & check-ins"
              description="Two stand-ups run each weekday, plus optional check-ins, in this room's time zone. Every agent in the room replies, using your API credits."
            >
              <RoomScheduleForm
                orgSlug={orgSlug}
                roomId={roomId}
                timezone={access.room.timezone}
                schedule={schedule}
              />
            </Section>
          ) : null}

          <Section
            title="People in this room"
            description="Only members can read a private room, even workspace admins. Add teammates here and the room appears in their Chats. To invite someone new, use Workspace & members."
          >
            <ul className="divide-y divide-line border-y border-line">
              {roomMembers.map((member) => (
                <li key={member.userId} className="flex flex-wrap items-center gap-2 py-2.5">
                  <span className="text-[13px] text-text">
                    {memberNames.get(member.userId) ?? "Someone"}
                    {member.userId === access.user.id ? " (you)" : ""}
                  </span>
                  <span className="font-mono text-[11px] text-faint">{member.role}</span>
                  {member.userId !== access.user.id ? (
                    <div className="ml-auto">
                      <ActionForm
                        action={removeRoomMember}
                        submitLabel="Remove"
                        submitVariant="danger"
                        pendingLabel="Removing…"
                        confirmLabel="Confirm remove"
                      >
                        <input type="hidden" name="orgSlug" value={orgSlug} />
                        <input type="hidden" name="roomId" value={roomId} />
                        <input type="hidden" name="memberId" value={member.userId} />
                      </ActionForm>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="mt-5 border-t border-line pt-5">
              {availableMembers.length === 0 ? (
                <p className="text-[13px] text-muted">
                  Everyone in this workspace is already in the room.
                </p>
              ) : (
                <ActionForm action={addRoomMember} submitLabel="Add person" resetOnSuccess>
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="roomId" value={roomId} />
                  <Field label="person" htmlFor="add-room-member">
                    <Select id="add-room-member" name="memberId" required defaultValue="">
                      <option value="" disabled>
                        Choose a workspace member
                      </option>
                      {availableMembers.map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.displayName} · {member.role}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </ActionForm>
              )}
            </div>
          </Section>

          <div id="room-agents" className="scroll-mt-6">
          <Section
            title="Agents in this room"
            description="Removing an agent keeps its past messages."
          >
            {roomAgents.length === 0 ? (
              <EmptyState
                title="No agents in the room"
                body="Add one below. Until then, this room is just for people."
              />
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {roomAgents.map(({ agent, position }) => (
                  <li key={agent.id} className="flex flex-wrap items-center gap-2 py-2.5">
                    <span className="w-5 font-mono text-[11px] text-faint">{position + 1}</span>
                    <span className="font-mono text-[12px] text-text">@{agent.handle}</span>
                    <span className="text-[12px] text-muted">{agent.displayName}</span>
                    <span className="font-mono text-[11px] text-faint">
                      {agentModelText(agent, saya)}
                    </span>
                    <div className="ml-auto">
                      <ActionForm
                        action={removeAgentFromRoom}
                        submitLabel="Remove"
                        submitVariant="danger"
                        pendingLabel="Removing…"
                        confirmLabel="Confirm remove"
                      >
                        <input type="hidden" name="orgSlug" value={orgSlug} />
                        <input type="hidden" name="roomId" value={roomId} />
                        <input type="hidden" name="agentId" value={agent.id} />
                      </ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 border-t border-line pt-5">
              {availableAgents.length === 0 ? (
                <p className="text-[13px] text-muted">
                  {orgAgents.length === 0
                    ? "This workspace has no agents yet. "
                    : "Every agent in this workspace is already in the room. "}
                  <Link
                    href={`/${orgSlug}/agents?room=${roomId}#create-agent`}
                    className="text-accent underline underline-offset-4"
                  >
                    Create an agent
                  </Link>
                </p>
              ) : (
                <ActionForm action={addAgentToRoom} submitLabel="Add agent">
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="roomId" value={roomId} />
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <Field label="agent" htmlFor="add-agent">
                      <Select id="add-agent" name="agentId" required defaultValue="">
                        <option value="" disabled>
                          Choose an agent
                        </option>
                        {availableAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            @{agent.handle} · {agent.displayName}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                </ActionForm>
              )}
            </div>
          </Section>
          </div>

          <Section
            title="Delete this room"
            description="This permanently deletes the room's messages, threads, canvases, tasks and meetings. It cannot be undone."
          >
            <DeleteRoomButton orgSlug={orgSlug} roomId={roomId} roomName={access.room.name} />
          </Section>
        </div>
      </div>
    </div>
  )
}
