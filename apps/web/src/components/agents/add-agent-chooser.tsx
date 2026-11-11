"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Sparkles, UserPlus } from "lucide-react"
import { InviteBotDialog } from "@/components/room/invite-bot-dialog"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/field"
import { CloseIcon, PlusIcon } from "@/components/ui/icons"

/**
 * "Add agent" offers both ways in: create a new agent here (runs on your AI account), or
 * invite one you already use elsewhere (Hermes, Claude Code…) into a room.
 */
export function AddAgentChooser({
  orgSlug,
  rooms,
}: {
  orgSlug: string
  rooms: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "")
  const [inviting, setInviting] = useState(false)
  const room = rooms.find((r) => r.id === roomId)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <PlusIcon width={14} height={14} /> Add agent
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-void/70 backdrop-blur-sm sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="add-agent-choose" className="w-full max-w-2xl rounded-t-xl border border-line bg-panel p-5 shadow-2xl sm:rounded-xl sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 id="add-agent-choose" className="text-[18px] font-semibold text-text">
                  Add an agent
                </h2>
                <p className="mt-1 text-[13px] text-muted">Make a new one here, or bring one you already use.</p>
              </div>
              <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => setOpen(false)}>
                <CloseIcon width={14} height={14} />
              </Button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col rounded-xl border border-line bg-ink p-4">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent">
                  <Sparkles className="h-5 w-5" />
                </span>
                <p className="mt-3 text-[15px] font-medium text-text">Create a new agent</p>
                <p className="mt-1 flex-1 text-[13px] leading-relaxed text-muted">
                  Give it a job, pick its model, and it works in your rooms using your AI account.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/${orgSlug}/marketplace?tab=agents`}
                    className="inline-flex h-10 items-center rounded-sm bg-accent px-3 text-[13px] font-medium text-void hover:bg-[var(--color-accent-strong)] md:h-9"
                  >
                    Pick a ready-made one
                  </Link>
                  <Link
                    href={`/${orgSlug}/agents/new`}
                    className="inline-flex h-10 items-center rounded-sm px-3 text-[13px] text-muted hover:bg-raised hover:text-text md:h-9"
                  >
                    Start from scratch
                  </Link>
                </div>
              </div>

              <div className="flex flex-col rounded-xl border border-line bg-ink p-4">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-m-blue/15 text-m-blue">
                  <UserPlus className="h-5 w-5" />
                </span>
                <p className="mt-3 text-[15px] font-medium text-text">Invite one you already use</p>
                <p className="mt-1 flex-1 text-[13px] leading-relaxed text-muted">
                  Hermes, Claude Code, Codex, Cursor and others join as they are, on their own subscription.
                </p>
                {rooms.length ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Select value={roomId} onChange={(event) => setRoomId(event.target.value)} aria-label="Room to join" className="min-w-0 flex-1">
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          Into #{r.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setOpen(false)
                        setInviting(true)
                      }}
                    >
                      Continue
                    </Button>
                  </div>
                ) : (
                  <Link href={`/${orgSlug}/chats/new`} className="mt-4 text-[13px] font-medium text-accent hover:underline">
                    Make a room first →
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {room ? (
        <InviteBotDialog
          orgSlug={orgSlug}
          roomId={room.id}
          roomName={room.name}
          open={inviting}
          onOpenChange={setInviting}
          hideTrigger
        />
      ) : null}
    </>
  )
}
