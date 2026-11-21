import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Sparkles } from "lucide-react"
import { agentModelText } from "@sayabot/core"
import { isOrgAdmin, requireRoomAccess } from "@/lib/auth"
import { sayaAiPublic } from "@/lib/env"
import {
  listMcpServers,
  listMemberViews,
  listOrgAgents,
  listRoomAgents,
  listRoomMemberRows,
} from "@/lib/queries"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadRoomSchedule } from "@/lib/queries-ia"
import {
  addRoomMember,
  removeAgentFromRoom,
  removeRoomMember,
  updateRoomBasics,
  updateRoomSettings,
} from "@/lib/actions/rooms"
import { ActionForm } from "@/components/ui/action-form"
import { Field, HelpText, Input, Select, Textarea } from "@/components/ui/field"
import { EmptyState } from "@/components/ui/empty"
import { Section } from "@/components/settings/section"
import { AgentOrderEditor } from "@/components/rooms/agent-order-editor"
import { DeleteRoomButton } from "@/components/rooms/delete-room-button"
import { RoomScheduleForm } from "@/components/rooms/room-schedule-form"
import { RoomAddAgent } from "@/components/rooms/room-add-agent"
import { RoomTools } from "@/components/rooms/room-tools"
import { RoomModelPicker } from "@/components/room/model-picker/room-model-picker"
import { relativeTime, TURN_MODE_LABELS } from "@/lib/format"

/** Same window the orchestrator uses (APP_ONLINE_WINDOW_MS): an invited app is "open" if it called in. */
const APP_ONLINE_MS = 15 * 60_000

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

  const orgAdmin = isOrgAdmin(access.orgRole)
  const admin = createAdminClient()
  const [roomAgents, orgAgents, schedule, orgMembers, roomMembers, mcpServers, templateRows] =
    await Promise.all([
      listRoomAgents(roomId),
      listOrgAgents(access.org.id),
      loadRoomSchedule(roomId),
      listMemberViews(access.org.id),
      listRoomMemberRows(roomId),
      listMcpServers(access.org.id),
      orgAdmin
        ? admin
            .from("agent_templates")
            .select("id, name, description, category")
            .or(`org_id.is.null,org_id.eq.${access.org.id}`)
            .order("created_at", { ascending: true })
            .then(({ data }) => data ?? [])
        : Promise.resolve([]),
    ])
  const templates = (
    templateRows as {
      id: string
      name: string
      description: string | null
      category: string | null
    }[]
  ).map((t) => ({ id: t.id, name: t.name, description: t.description, category: t.category }))
  // When each invited app last called in, for "open now" / "not open".
  const externalIds = roomAgents
    .filter(({ agent }) => agent.kind === "external")
    .map(({ agent }) => agent.id)
  const { data: seenRows } = externalIds.length
    ? await admin.from("agents").select("id, last_seen_at").in("id", externalIds)
    : { data: [] as { id: string; last_seen_at: string | null }[] }
  const lastSeen = new Map(
    ((seenRows ?? []) as { id: string; last_seen_at: string | null }[]).map((row) => [
      row.id,
      row.last_seen_at,
    ]),
  )
  const now = Date.now()
  const roomServers = mcpServers
    .filter((server) => server.roomId === null || server.roomId === roomId)
    .map((server) => ({
      id: server.id,
      name: server.name,
      url: server.url,
      roomId: server.roomId,
      enabled: server.enabled,
    }))
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
  // Only agents made in Sayabot can lead: the lead needs a model Sayabot can ask.
  const leadOptions = roomAgents
    .filter(({ agent }) => agent.kind === "llm")
    .map(({ agent }) => ({ id: agent.id, handle: agent.handle, displayName: agent.displayName }))
  const hasModelAgents = leadOptions.length > 0
  const leadId = access.room.moderatorAgentId
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
          <Section title="Room" description="Its name and who can see it.">
            <ActionForm action={updateRoomBasics} submitLabel="Save">
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="roomId" value={roomId} />
              <div className="grid gap-3 sm:grid-cols-[1fr_300px]">
                <Field label="name" htmlFor="room-name" hint="1 to 60 characters">
                  <Input
                    id="room-name"
                    name="name"
                    defaultValue={access.room.name}
                    required
                    maxLength={60}
                  />
                </Field>
                {access.room.kind !== "dm" ? (
                  <Field label="who can see it" htmlFor="room-kind">
                    <Select id="room-kind" name="kind" defaultValue={access.room.kind}>
                      <option value="private">Private: only people you add</option>
                      <option value="public">Public: anyone in the workspace can read</option>
                    </Select>
                  </Field>
                ) : null}
              </div>
            </ActionForm>
          </Section>

          <div id="room-agents" className="scroll-mt-6">
            <Section
              title="Agents in this room"
              description="Add specialists, pick where each one runs, or bring your own app. Removing an agent keeps its past messages."
              actions={
                hasModelAgents && orgAdmin ? (
                  <RoomModelPicker orgSlug={orgSlug} roomId={roomId} placement="down" />
                ) : undefined
              }
            >
              {roomAgents.length === 0 ? (
                <EmptyState
                  title="No agents in the room"
                  body="Add one below. Until then, this room is just for people."
                />
              ) : (
                <ul className="divide-y divide-line border-y border-line">
                  {roomAgents.map(({ agent, position }) => {
                    const seen = lastSeen.get(agent.id) ?? null
                    const open = seen ? now - new Date(seen).getTime() <= APP_ONLINE_MS : false
                    return (
                      <li key={agent.id} className="py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-5 font-mono text-[11px] text-faint">
                            {position + 1}
                          </span>
                          <span className="font-mono text-[12px] font-medium text-text">
                            @{agent.handle}
                          </span>
                          <span className="text-[12px] text-muted">{agent.displayName}</span>
                          {agent.id === leadId ? (
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                              Lead
                            </span>
                          ) : null}
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Runtime Prompt
                          </span>
                          {agent.kind === "external" ? (
                            <span
                              className={
                                open
                                  ? "rounded-full bg-ok/15 px-2 py-0.5 text-[11px] text-ok"
                                  : "rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted"
                              }
                              title={
                                seen
                                  ? `Last called in ${relativeTime(seen)}`
                                  : "Hasn't connected yet"
                              }
                            >
                              {open
                                ? "Your app · open now"
                                : seen
                                  ? `Your app · not open (seen ${relativeTime(seen)})`
                                  : "Your app · not connected yet"}
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] text-faint">
                              {agentModelText(agent, saya)}
                            </span>
                          )}
                          <div className="ml-auto flex items-center gap-2">
                            <Link
                              href={`/${orgSlug}/r/${roomId}?configure=${agent.id}#soul`}
                              className="inline-flex items-center gap-1 rounded-md border border-line bg-raised px-2.5 py-1 text-[11px] font-medium text-text hover:border-line-strong hover:bg-hover transition-colors"
                              title="Edit the persona in the bot sidebar"
                            >
                              <Sparkles className="h-3 w-3 text-accent" />
                              Edit in sidebar
                            </Link>
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
                        </div>
                        {agent.systemPrompt?.trim() ? (
                          <div className="mt-2 ml-7 rounded-lg border border-line/60 bg-raised/40 px-3 py-2 text-[11.5px] font-mono text-muted leading-relaxed line-clamp-2">
                            <span className="font-sans text-[10px] uppercase font-semibold tracking-wider text-faint block mb-0.5">
                              Persona:
                            </span>
                            {agent.systemPrompt}
                          </div>
                        ) : (
                          <p className="mt-1 ml-7 text-[11.5px] text-faint italic">
                            No persona set yet.
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {hasModelAgents ? (
                <HelpText>
                  {orgAdmin
                    ? "Use the model button above to choose where each agent runs here: an API key, an app signed in on your Mac, or the server."
                    : "A workspace admin can change where each agent runs."}
                </HelpText>
              ) : null}

              <div className="mt-5 border-t border-line pt-5">
                <RoomAddAgent
                  orgSlug={orgSlug}
                  roomId={roomId}
                  roomName={access.room.name}
                  templates={templates}
                  available={availableAgents.map((agent) => ({
                    id: agent.id,
                    handle: agent.handle,
                    displayName: agent.displayName,
                  }))}
                  canCreate={orgAdmin}
                />
              </div>
            </Section>
          </div>

          <Section
            title="How agents reply"
            description="Choose when agents speak, and set limits so a conversation cannot run away or overspend."
          >
            <ActionForm action={updateRoomSettings} submitLabel="Save">
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <input type="hidden" name="roomId" value={roomId} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="agents reply" htmlFor="turn-mode">
                  <Select id="turn-mode" name="turnMode" defaultValue={access.room.turnMode}>
                    {Object.entries(TURN_MODE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="lead agent" htmlFor="moderator" hint="needed for “Lead agent”">
                  <Select id="moderator" name="moderatorAgentId" defaultValue={leadId ?? ""}>
                    <option value="">none</option>
                    {leadOptions.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        @{agent.handle} · {agent.displayName}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <HelpText>
                With a lead agent, messages that don&apos;t @mention anyone go to the lead. It reads
                what each agent here is for (its description or instructions) and hands the message
                to the best fit, which the room shows. An @mention always goes straight to that
                agent. Invited apps can be handed work but can&apos;t lead.
              </HelpText>

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

              <Field
                label="room instructions"
                htmlFor="directive"
                hint="every agent here follows these"
              >
                <Textarea
                  id="directive"
                  name="systemDirective"
                  defaultValue={access.room.systemDirective ?? ""}
                  className="min-h-24"
                  placeholder="Keep answers short. Prefer concrete file paths and commands."
                />
              </Field>

              <Field label="speaking order in debates">
                <AgentOrderEditor agents={roomAgentOptions} initialOrder={initialOrder} />
              </Field>

              <HelpText>
                When a limit is reached, agents stop and a note appears in the chat. Costs are
                estimated from the prices in Settings.
              </HelpText>
            </ActionForm>
          </Section>

          <Section
            title="Tools in this room"
            description="Apps whose tools the agents here can use, such as GitHub or a docs site."
          >
            <RoomTools
              orgSlug={orgSlug}
              roomId={roomId}
              servers={roomServers}
              canManage={orgAdmin}
            />
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
