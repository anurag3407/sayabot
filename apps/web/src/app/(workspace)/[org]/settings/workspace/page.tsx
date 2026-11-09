import type { Metadata } from "next"
import { requireOrgAdmin } from "@/lib/auth"
import { listAuditLogs, listMemberViews, listRooms } from "@/lib/queries"
import { inviteMember, renameWorkspaceAction, updateSso } from "@/lib/actions/orgs"
import { ssoEnabled } from "@/lib/env"
import { ActionForm } from "@/components/ui/action-form"
import { Field, Input, Select } from "@/components/ui/field"
import { EmptyState, InlineAlert } from "@/components/ui/empty"
import { Section } from "@/components/settings/section"
import { MemberRoleForm } from "@/components/admin/member-role-form"
import { RemoveMemberButton } from "@/components/admin/remove-member-button"
import { fullTime, pretty } from "@/lib/format"

export const metadata: Metadata = { title: "General & members" }

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params
  const access = await requireOrgAdmin(orgSlug)
  const [members, logs, rooms] = await Promise.all([
    listMemberViews(access.org.id),
    listAuditLogs(access.org.id),
    listRooms(access.org.id),
  ])
  const isOwner = access.role === "owner"
  const invitableRooms = rooms.filter((room) => room.kind !== "dm")

  return (
    <>
    <Section title="Workspace" description="The name everyone in this workspace sees." className="border-t-0 pt-0">
      <ActionForm action={renameWorkspaceAction} submitLabel="Save name">
        <input type="hidden" name="orgSlug" value={orgSlug} />
        <Field label="workspace name" htmlFor="workspace-name">
          <Input
            id="workspace-name"
            name="name"
            required
            minLength={2}
            maxLength={60}
            defaultValue={access.org.name}
            className="max-w-md"
          />
        </Field>
      </ActionForm>
    </Section>

    <Section
      title="Members"
      description={`${members.length} ${members.length === 1 ? "person" : "people"} in this workspace.`}
    >
      <ul className="divide-y divide-line border-y border-line">
        {members.map((member) => (
          <li key={member.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
            <span className="min-w-0 flex-1 truncate text-[13px] text-text">
              {member.displayName}
            </span>
            <span className="font-mono text-[11px] text-faint">{member.role}</span>
            <MemberRoleForm
              orgSlug={orgSlug}
              userId={member.userId}
              role={member.role}
              allowOwner={isOwner}
            />
            {member.userId !== access.user.id ? (
              <RemoveMemberButton
                orgSlug={orgSlug}
                userId={member.userId}
                name={member.displayName}
              />
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-5 border-t border-line pt-5">
        <ActionForm action={inviteMember} submitLabel="Invite" pendingLabel="Inviting…" resetOnSuccess>
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
            <Field label="email" htmlFor="invite-email">
              <Input id="invite-email" name="email" type="email" required placeholder="teammate@company.com" />
            </Field>
            <Field label="role" htmlFor="invite-role">
              <Select id="invite-role" name="role" defaultValue="member">
                <option value="member">member</option>
                <option value="admin">admin</option>
                {isOwner ? <option value="owner">owner</option> : null}
              </Select>
            </Field>
          </div>
          {invitableRooms.length ? (
            <fieldset>
              <legend className="mb-1.5 font-mono text-[12px] text-muted">
                add to rooms
              </legend>
              <div className="max-h-44 space-y-1 overflow-y-auto border border-line bg-panel p-2">
                {invitableRooms.map((room) => (
                  <label
                    key={room.id}
                    className="flex min-h-9 items-center justify-between gap-2 text-[12px] text-muted md:min-h-0"
                  >
                    <span className="truncate">
                      {room.name}
                      {room.kind === "public" ? " (anyone in the workspace can read it)" : ""}
                    </span>
                    <input
                      type="checkbox"
                      name="roomIds"
                      value={room.id}
                      defaultChecked={invitableRooms.length === 1}
                      className="h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
                Pick at least one, or they will join with no private rooms to see.
              </p>
            </fieldset>
          ) : null}
          <p className="text-[12px] leading-relaxed text-faint">
            New people get an invitation email. People who already have an account are added
            right away.
          </p>
        </ActionForm>
      </div>
    </Section>

    <Section
      title="SAML SSO"
      description="Single sign-on must first be set up by whoever runs this server."
    >
      {!ssoEnabled() ? (
        <InlineAlert tone="warning">
          Single sign-on is not available on this server yet. Ask your server administrator to
          set it up.
        </InlineAlert>
      ) : (
        <ActionForm action={updateSso} submitLabel="Save SSO flag">
          <input type="hidden" name="orgSlug" value={orgSlug} />
          <Field label="state" htmlFor="sso-state">
            <Select
              id="sso-state"
              name="enabled"
              defaultValue={access.org.ssoEnabled ? "true" : "false"}
            >
              <option value="false">disabled</option>
              <option value="true">enabled</option>
            </Select>
          </Field>
        </ActionForm>
      )}
    </Section>

    <Section
      title="Audit log"
      description="The last 100 sensitive actions: keys, members, room settings, tool approvals and API keys."
    >
      {logs.length === 0 ? (
        <EmptyState
          title="No audit entries yet"
          body="Entries appear when an admin changes a key, a role or a room setting, or decides on an agent action."
        />
      ) : (
        <div className="overflow-x-auto border-y border-line">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line font-mono text-[11px] text-faint">
                <th className="py-2 pr-3 font-normal">time</th>
                <th className="py-2 pr-3 font-normal">action</th>
                <th className="py-2 pr-3 font-normal">target</th>
                <th className="py-2 pr-3 font-normal">actor</th>
                <th className="py-2 font-normal">metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {logs.map((log) => (
                <tr key={log.id} className="align-top">
                  <td className="whitespace-nowrap py-2 pr-3 font-mono text-[11px] text-faint">
                    {fullTime(log.createdAt)}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[12px] text-text">{log.action}</td>
                  <td className="max-w-[180px] truncate py-2 pr-3 font-mono text-[11px] text-muted">
                    {log.target ?? "-"}
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-faint">
                    {log.actorType}
                    {log.actorId ? `:${log.actorId.slice(0, 8)}` : ""}
                  </td>
                  <td className="max-w-[260px] py-2 font-mono text-[11px] leading-relaxed text-faint">
                    <details>
                      <summary className="cursor-pointer hover:text-text">view</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-all">
                        {pretty(log.metadata)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
    </>
  )
}
