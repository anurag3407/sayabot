"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { inviteMember } from "@/lib/actions/orgs"
import { createInviteLinkAction, revokeInviteAction } from "@/lib/actions/workspace-invites"
import { ActionForm } from "@/components/ui/action-form"
import { Button } from "@/components/ui/button"
import { Input, Select } from "@/components/ui/field"
import { CheckIcon, CopyIcon } from "@/components/ui/icons"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import type { PendingInviteView } from "@/lib/workspace-invites"

type Tab = "email" | "link" | "permanent"

function expiry(iso: string | null): string {
  if (!iso) return "Never expires"
  return `Expires ${new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-ink p-2">
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{url}</span>
      <Button
        size="sm"
        variant="primary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1_600)
          } catch {
            showToast({ tone: "danger", message: "Couldn't copy. Select the link and copy it." })
          }
        }}
      >
        {copied ? <CheckIcon width={13} height={13} /> : <CopyIcon width={13} height={13} />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}

/** OpenBot-style "Invite people": email, a single-use link, or a permanent link, plus what's pending. */
export function InvitePeopleCard({
  orgSlug,
  isOwner,
  rooms,
  pending,
}: {
  orgSlug: string
  isOwner: boolean
  rooms: { id: string; name: string; kind: string }[]
  pending: PendingInviteView[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("email")
  const [role, setRole] = useState<"member" | "admin">("member")
  const [made, setMade] = useState<{ url: string; expiresAt: string | null } | null>(null)
  const [busy, startTransition] = useTransition()

  function makeLink(kind: "link" | "permanent") {
    startTransition(async () => {
      const result = await createInviteLinkAction({ orgSlug, kind, role })
      if (!result.ok || !result.data) {
        showToast({ tone: "danger", message: result.error ?? "Could not make the link" })
        return
      }
      setMade({ url: result.data.url as string, expiresAt: (result.data.expiresAt as string | null) ?? null })
      router.refresh()
    })
  }

  function revoke(id: string) {
    startTransition(async () => {
      const result = await revokeInviteAction({ orgSlug, inviteId: id })
      showToast({ tone: result.ok ? "neutral" : "danger", message: result.ok ? "Revoked" : (result.error ?? "Could not revoke") })
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-md">
            <h3 className="text-[15px] font-medium text-text">Invite people</h3>
            <p className="mt-1 text-[13px] text-muted">
              Single-use links expire after 24 hours. A permanent link never expires and works for anyone who has it.
            </p>
          </div>
          <div role="tablist" aria-label="How to invite" className="flex rounded-lg border border-line bg-ink p-1">
            {(
              [
                ["email", "Email"],
                ["link", "Invite link"],
                ["permanent", "Perma link"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => {
                  setTab(id)
                  setMade(null)
                }}
                className={cn(
                  "h-8 rounded-md px-3 text-[13px] transition-colors",
                  tab === id ? "bg-raised font-medium text-text" : "text-muted hover:text-text",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-panel p-4">
          {tab === "email" ? (
            <ActionForm action={inviteMember} submitLabel="Send invite" pendingLabel="Sending…" resetOnSuccess>
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input name="email" type="email" required placeholder="person@company.com" aria-label="Email" className="flex-1" />
                <Select name="role" defaultValue="member" aria-label="Role" className="sm:w-36">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  {isOwner ? <option value="owner">Owner</option> : null}
                </Select>
              </div>
              {rooms.length ? (
                <details className="text-[13px]">
                  <summary className="cursor-pointer text-muted hover:text-text">Also add them to rooms</summary>
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line bg-ink p-2">
                    {rooms.map((room) => (
                      <label key={room.id} className="flex items-center justify-between gap-2 text-[13px] text-muted">
                        <span className="truncate">#{room.name}</span>
                        <input type="checkbox" name="roomIds" value={room.id} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
                      </label>
                    ))}
                  </div>
                </details>
              ) : null}
            </ActionForm>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select value={role} onChange={(event) => setRole(event.target.value as "member" | "admin")} aria-label="Role" className="sm:w-36">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
                <Button variant="primary" disabled={busy} onClick={() => makeLink(tab)}>
                  {busy ? "Making…" : tab === "link" ? "Create single-use link" : "Get permanent link"}
                </Button>
              </div>
              {made ? (
                <>
                  <CopyLink url={made.url} />
                  <p className="text-[12px] text-faint">
                    {tab === "link" ? `Works once. ${expiry(made.expiresAt)}.` : "Works for anyone who has it until you revoke it."}
                  </p>
                </>
              ) : (
                <p className="text-[12px] text-faint">
                  {tab === "link"
                    ? "Send it to one person. They sign in or sign up, then they're in."
                    : "Good for a team channel. Revoke it any time below."}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <h3 className="text-[15px] font-medium text-text">Pending invitations</h3>
          <span className="text-[13px] text-faint">{pending.length} pending</span>
        </div>
        {pending.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line p-6 text-center text-[14px] text-faint">
            No pending invitations.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {pending.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-text">{invite.label}</p>
                  <p className="text-[12px] text-faint">
                    <span className="capitalize">{invite.role}</span> · {invite.kind === "email" ? "Hasn't signed in yet" : expiry(invite.expiresAt)}
                    {invite.kind === "permanent" && invite.uses ? ` · used ${invite.uses} ${invite.uses === 1 ? "time" : "times"}` : ""}
                    {invite.roomCount ? ` · ${invite.roomCount} ${invite.roomCount === 1 ? "room" : "rooms"}` : ""}
                  </p>
                </div>
                {invite.url ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={async () => {
                      await navigator.clipboard.writeText(invite.url!).catch(() => {})
                      showToast({ tone: "success", message: "Link copied" })
                    }}
                  >
                    Copy link
                  </Button>
                ) : null}
                <Button size="sm" variant="quiet" disabled={busy} onClick={() => revoke(invite.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
