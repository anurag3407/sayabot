"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import {
  endMeetingAction,
  startScheduledMeetingAction,
  wakeBotsAction,
} from "@/lib/actions/meetings"
import { formatMinutes } from "@sayabot/core"
import { Button } from "@/components/ui/button"
import { ConfirmButton } from "@/components/ui/confirm-button"
import { InlineAlert } from "@/components/ui/empty"
import { cn } from "@/lib/format"
import type { MeetingView, RoomScheduleView } from "@/lib/types"

export function RoomMeetingBar({
  orgSlug,
  meeting,
  schedule,
}: {
  orgSlug: string
  meeting: MeetingView | null
  schedule: RoomScheduleView | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!meeting && !schedule) return null

  function run(action: "start" | "wake" | "end") {
    if (!meeting) return
    setError(null)
    startTransition(async () => {
      const result =
        action === "start"
          ? await startScheduledMeetingAction(orgSlug, meeting.id)
          : action === "wake"
            ? await wakeBotsAction(orgSlug, meeting.id)
            : await endMeetingAction(orgSlug, meeting.id)
      if (!result.ok) {
        setError(result.error ?? "Could not update the meeting")
        return
      }
      router.refresh()
    })
  }

  // Only a live meeting earns a row on a phone; a schedule is not worth the chat's space.
  const hideOnPhone = meeting?.status !== "active"

  return (
    <div
      className={cn(
        "flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-1.5",
        hideOnPhone ? "hidden md:flex" : "flex",
        meeting?.status === "active" ? "bg-accent-soft" : "bg-panel",
      )}
      aria-label="Room meeting"
    >
      {meeting ? (
        <>
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              meeting.status === "active" ? "bg-accent" : "bg-[var(--color-warn)]",
            )}
            aria-hidden="true"
          />
          <span className="font-mono text-[11px] text-muted">
            {meeting.status === "active" ? "live · " : "scheduled · "}
            {meeting.kind === "checkin" ? "check-in" : meeting.kind}
          </span>
          <span className="truncate text-[12px] text-text">{meeting.title}</span>
          <span className="font-mono text-[11px] text-faint">
            {new Date(meeting.startsAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
            {"–"}
            {new Date(meeting.endsAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {meeting.status === "scheduled" ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run("start")}>
                Start
              </Button>
            ) : (
              <>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run("wake")}>
                  Ask agents again
                </Button>
                <ConfirmButton
                  label="End"
                  confirmLabel="End meeting"
                  pendingLabel="Ending…"
                  warning="Any agent reply in progress will stop."
                  pending={pending}
                  onConfirm={() => run("end")}
                />
              </>
            )}
            <Link
              href={`/${orgSlug}/meetings`}
              className="px-1 font-mono text-[11px] text-faint hover:text-text"
            >
              all meetings
            </Link>
          </div>
        </>
      ) : schedule ? (
        <>
          <span className="font-mono text-[11px] text-faint">weekday stand-ups</span>
          <span className="font-mono text-[11px] text-muted">
            {formatMinutes(schedule.morningStartMinutes)}–
            {formatMinutes(schedule.morningEndMinutes)}
            {" · "}
            {formatMinutes(schedule.eveningStartMinutes)}–
            {formatMinutes(schedule.eveningEndMinutes)}
            {schedule.checkinsEnabled
              ? ` · check-ins every ${schedule.checkinIntervalMinutes} min`
              : ""}
          </span>
          <span className="ml-auto font-mono text-[11px] text-faint">
            {schedule.timezone.replaceAll("_", " ")}
          </span>
          <Link
            href={`/${orgSlug}/meetings`}
            className="px-1 font-mono text-[11px] text-faint hover:text-text"
          >
            all meetings
          </Link>
        </>
      ) : null}
      {error ? (
        <div className="w-full pb-1.5">
          <InlineAlert tone="danger">{error}</InlineAlert>
        </div>
      ) : null}
    </div>
  )
}
