"use client"

import { useEffect, useRef, useState } from "react"
import { UserPlus, X } from "lucide-react"
import { addRoomMember } from "@/lib/actions/rooms"
import { inviteToRoom } from "@/lib/actions/orgs"
import { createInviteLinkAction } from "@/lib/actions/workspace-invites"
import { ActionForm } from "@/components/ui/action-form"
import { Button } from "@/components/ui/button"
import { Field, HelpText, Input, Select } from "@/components/ui/field"

interface InvitePeopleProps {
  orgSlug: string
  roomId: string
  roomName: string
  canInviteNew: boolean
  workspaceMembers: { userId: string; displayName: string }[]
}

function InviteDialog({
  dialog,
  orgSlug,
  roomId,
  roomName,
  canInviteNew,
  workspaceMembers,
}: InvitePeopleProps & { dialog: React.RefObject<HTMLDialogElement | null> }) {
  const hidden = (
    <>
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="roomId" value={roomId} />
    </>
  )
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`invite-people-${roomId}`}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-md border border-line bg-panel p-5 text-text backdrop:bg-void/70"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`invite-people-${roomId}`} className="truncate text-[15px] font-medium">
            Invite people to {roomName}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            They'll see every message, agent turn, task and canvas edit in this room.
          </p>
        </div>
        <Button size="icon" variant="ghost" aria-label="Close" onClick={() => dialog.current?.close()}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-4 space-y-5">
        {workspaceMembers.length > 0 ? (
          <ActionForm action={addRoomMember} submitLabel="Add to room" pendingLabel="Adding…" resetOnSuccess>
            {hidden}
            <Field label="from this workspace" htmlFor={`invite-member-${roomId}`}>
              <Select id={`invite-member-${roomId}`} name="memberId" required defaultValue="">
                <option value="" disabled>
                  Choose a person
                </option>
                {workspaceMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        ) : null}

        {canInviteNew ? (
          <ActionForm
            action={inviteToRoom}
            submitLabel="Send invite"
            pendingLabel="Sending…"
            resetOnSuccess
            className={workspaceMembers.length > 0 ? "border-t border-line pt-5" : undefined}
          >
            {hidden}
            <Field label="by email" htmlFor={`invite-email-${roomId}`}>
              <Input
                id={`invite-email-${roomId}`}
                name="email"
                type="email"
                required
                autoComplete="off"
                placeholder="teammate@company.com"
              />
            </Field>
            <HelpText>New people join your workspace as members, and only get this room.</HelpText>
          </ActionForm>
        ) : null}
        {canInviteNew ? (
          <RoomLinkButton orgSlug={orgSlug} roomId={roomId} />
        ) : workspaceMembers.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-muted">
            Everyone in this workspace is already here. To bring in someone new, ask a workspace admin.
          </p>
        ) : (
          <HelpText>To bring in someone new, ask a workspace admin.</HelpText>
        )}
      </div>
    </dialog>
  )
}

/** A single-use link (24h) that brings one person into the workspace and straight into this room. */
function RoomLinkButton({ orgSlug, roomId }: { orgSlug: string; roomId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">("idle")
  const [url, setUrl] = useState<string | null>(null)
  return (
    <div className="border-t border-line pt-5">
      <p className="text-[13px] text-text">Or share a link</p>
      <p className="mt-0.5 text-[12px] text-muted">Works once for one person, for 24 hours. They land in this room.</p>
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={state === "busy"}
          onClick={async () => {
            setState("busy")
            const result = await createInviteLinkAction({ orgSlug, kind: "link", role: "member", roomIds: [roomId] })
            if (!result.ok || !result.data) {
              setState("error")
              return
            }
            const link = result.data.url as string
            setUrl(link)
            await navigator.clipboard.writeText(link).catch(() => {})
            setState("copied")
          }}
        >
          {state === "busy" ? "Making…" : state === "copied" ? "Copied" : "Copy invite link"}
        </Button>
        {state === "error" ? <span className="text-[12px] text-danger">Could not make a link</span> : null}
      </div>
      {url ? <p className="mt-2 select-all break-all font-mono text-[11px] text-faint">{url}</p> : null}
    </div>
  )
}

export function InvitePeople(props: InvitePeopleProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Invite people"
        title="Invite people"
        onClick={() => dialog.current?.showModal()}
      >
        <UserPlus className="h-4 w-4" />
        <span className="hidden md:inline">Invite people</span>
      </Button>
      <InviteDialog {...props} dialog={dialog} />
    </>
  )
}

const NUDGE_KEY = "sayabot:invite-nudge-dismissed"

export function RoomInviteNudge(props: InvitePeopleProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const storageKey = `${NUDGE_KEY}:${props.roomId}`
  // Hidden until the client can read storage, so a dismissed nudge never flashes.
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1")
    } catch {
      setDismissed(false)
    }
  }, [storageKey])
  if (dismissed) return null

  function dismiss() {
    setDismissed(true)
    try {
      window.localStorage.setItem(storageKey, "1")
    } catch {
      // It comes back on the next visit.
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-4 py-2.5">
      <p className="min-w-0 flex-1 basis-60 text-[13px] leading-relaxed text-muted">
        <span className="text-text">Just you in here so far.</span> Invite a teammate to work alongside
        you and your agents, live.
      </p>
      <Button size="sm" variant="secondary" onClick={() => dialog.current?.showModal()}>
        Invite people
      </Button>
      <Button size="icon" variant="ghost" aria-label="Dismiss" onClick={dismiss}>
        <X className="h-4 w-4" />
      </Button>
      <InviteDialog {...props} dialog={dialog} />
    </div>
  )
}
