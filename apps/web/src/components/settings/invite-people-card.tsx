"use client"

import { useState, useTransition } from "react"
import {
  createInviteLinkAction,
  decideJoinRequestAction,
  revokeInviteAction,
} from "@/lib/actions/workspace-invites"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { CheckIcon, CopyIcon } from "@/components/ui/icons"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import type { JoinRequestView, PendingInviteView } from "@/lib/workspace-invites"

type Tab = "link" | "permanent"

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

/** Share a link. Whoever opens it asks to join, and a workspace admin approves them. */
export function InvitePeopleCard({
  orgSlug,
  rooms,
  pending,
  requests,
}: {
  orgSlug: string
  rooms: { id: string; name: string; kind: string }[]
  pending: PendingInviteView[]
  requests: JoinRequestView[]
}) {
  const [tab, setTab] = useState<Tab>("link")
  const [role, setRole] = useState<"member" | "admin">("member")
  const [roomIds, setRoomIds] = useState<string[]>([])
  const [made, setMade] = useState<{ url: string; expiresAt: string | null } | null>(null)
  const [busy, startTransition] = useTransition()

  function makeLink(kind: "link" | "permanent") {
    startTransition(async () => {
      const result = await createInviteLinkAction({ orgSlug, kind, role, roomIds })
      if (!result.ok || !result.data) {
        showToast({ tone: "danger", message: result.error ?? "Could not make the link" })
        return
      }
      setMade({
        url: result.data.url as string,
        expiresAt: (result.data.expiresAt as string | null) ?? null,
      })
    })
  }

  function decide(requestId: string, approve: boolean) {
    startTransition(async () => {
      const result = await decideJoinRequestAction({ orgSlug, requestId, approve })
      showToast({
        tone: result.ok ? (approve ? "success" : "neutral") : "danger",
        message: result.ok
          ? (result.message ?? (approve ? "Approved" : "Declined"))
          : (result.error ?? "Could not save that"),
      })
    })
  }

  function revoke(id: string) {
    startTransition(async () => {
      const result = await revokeInviteAction({ orgSlug, inviteId: id })
      showToast({
        tone: result.ok ? "neutral" : "danger",
        message: result.ok ? "Revoked" : (result.error ?? "Could not revoke"),
      })
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-md">
            <h3 className="text-[15px] font-medium text-text">Invite people</h3>
            <p className="mt-1 text-[13px] text-muted">
              Share a link. They sign in and ask to join. A workspace admin approves them before
              they can see anything.
            </p>
          </div>
          <div
            role="tablist"
            aria-label="How to invite"
            className="flex rounded-lg border border-line bg-ink p-1"
          >
            {(
              [
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

        <div className="mt-4 space-y-3 rounded-xl border border-line bg-panel p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={role}
              onChange={(event) => setRole(event.target.value as "member" | "admin")}
              aria-label="Role"
              className="sm:w-36"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
            <Button variant="primary" disabled={busy} onClick={() => makeLink(tab)}>
              {busy ? "Making…" : tab === "link" ? "Create single-use link" : "Get permanent link"}
            </Button>
          </div>
          {rooms.length ? (
            <details className="text-[13px]">
              <summary className="cursor-pointer text-muted hover:text-text">
                Also add them to rooms once approved
              </summary>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line bg-ink p-2">
                {rooms.map((room) => (
                  <label
                    key={room.id}
                    className="flex items-center justify-between gap-2 text-[13px] text-muted"
                  >
                    <span className="truncate">#{room.name}</span>
                    <input
                      type="checkbox"
                      checked={roomIds.includes(room.id)}
                      onChange={(event) =>
                        setRoomIds((current) =>
                          event.target.checked
                            ? [...current, room.id]
                            : current.filter((id) => id !== room.id),
                        )
                      }
                      className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                    />
                  </label>
                ))}
              </div>
            </details>
          ) : null}
          {made ? (
            <>
              <CopyLink url={made.url} />
              <p className="text-[12px] text-faint">
                {tab === "link"
                  ? `Works once, after an admin approves. ${expiry(made.expiresAt)}.`
                  : "Anyone with it can ask to join, until you revoke it. Each person waits for approval."}
              </p>
            </>
          ) : (
            <p className="text-[12px] text-faint">
              {tab === "link"
                ? "Send it to one person. They ask to join, then an admin approves them."
                : "Good for a team channel. Each person still waits for an admin."}
            </p>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <h3 className="text-[15px] font-medium text-text">Waiting for approval</h3>
          <span className="text-[13px] text-faint">{requests.length} waiting</span>
        </div>
        {requests.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line p-6 text-center text-[14px] text-faint">
            No one is waiting. Share a link and they will show up here.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-text">{request.name}</p>
                  <p className="text-[12px] text-faint">
                    {request.email ? `${request.email} · ` : ""}
                    <span className="capitalize">{request.role}</span>
                    {request.roomCount
                      ? ` · ${request.roomCount} ${request.roomCount === 1 ? "room" : "rooms"}`
                      : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => decide(request.id, true)}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => decide(request.id, false)}
                >
                  Decline
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <h3 className="text-[15px] font-medium text-text">Shared links</h3>
          <span className="text-[13px] text-faint">{pending.length} open</span>
        </div>
        {pending.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line p-6 text-center text-[14px] text-faint">
            No open links. Create one above and copy it.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {pending.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-text">{invite.label}</p>
                  <p className="text-[12px] text-faint">
                    <span className="capitalize">{invite.role}</span> ·{" "}
                    {invite.kind === "email" ? "Hasn't signed in yet" : expiry(invite.expiresAt)}
                    {invite.kind === "permanent" && invite.uses
                      ? ` · used ${invite.uses} ${invite.uses === 1 ? "time" : "times"}`
                      : ""}
                    {invite.roomCount
                      ? ` · ${invite.roomCount} ${invite.roomCount === 1 ? "room" : "rooms"}`
                      : ""}
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
