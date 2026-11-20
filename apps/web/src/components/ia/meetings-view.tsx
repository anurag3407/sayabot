"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import {
  endMeetingAction,
  scheduleMeetingAction,
  startMeetingNowAction,
  startScheduledMeetingAction,
  wakeBotsAction,
} from "@/lib/actions/meetings"
import { formatMinutes } from "@sayabot/core"
import { dateTimeLocalToIso, toDateTimeLocalValue } from "@/lib/datetime"
import { Button } from "@/components/ui/button"
import { ConfirmButton } from "@/components/ui/confirm-button"
import { showToast } from "@/components/ui/toast"
import { Field, Input, Select, Textarea } from "@/components/ui/field"
import { EmptyState, InlineAlert } from "@/components/ui/empty"
import { cn } from "@/lib/format"
import type { MeetingView, RoomScheduleView } from "@/lib/types"

interface MeetingRoom {
  id: string
  name: string
  kind: "public" | "private" | "dm"
}

function formatMeetingTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function minutesNow(timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date())
    const hour = Number(parts.find((part) => part.type === "hour")?.value)
    const minute = Number(parts.find((part) => part.type === "minute")?.value)
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null
    return (hour % 24) * 60 + minute
  } catch {
    return null
  }
}

function isWeekday(timeZone: string): boolean {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
      new Date(),
    )
    return !["Sat", "Sun"].includes(weekday)
  } catch {
    return true
  }
}

function statusTone(status: MeetingView["status"]): string {
  if (status === "active") return "bg-accent text-void"
  if (status === "scheduled") return "bg-raised text-muted"
  return "bg-panel text-faint"
}

function MeetingCard({
  meeting,
  orgSlug,
  pendingId,
  onAction,
}: {
  meeting: MeetingView
  orgSlug: string
  pendingId: string | null
  onAction: (kind: "start" | "end" | "wake", meeting: MeetingView) => void
}) {
  const pending = pendingId === meeting.id
  return (
    <li className="border border-line bg-panel p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-sm px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide",
                statusTone(meeting.status),
              )}
            >
              {meeting.status}
            </span>
            <span className="font-mono text-[11px] text-faint">{meeting.kind}</span>
            <Link
              href={`/${orgSlug}/r/${meeting.roomId}`}
              className="font-mono text-[11px] text-muted hover:text-text"
            >
              {meeting.roomName}
            </Link>
          </div>
          <p className="mt-2 text-[14px] text-text">{meeting.title}</p>
          {meeting.agenda ? (
            <p className="mt-1 line-clamp-2 max-w-[60ch] text-[12px] leading-relaxed text-muted">
              {meeting.agenda}
            </p>
          ) : null}
          <p className="mt-2 font-mono text-[11px] text-faint">
            {formatMeetingTime(meeting.startsAt)} → {formatMeetingTime(meeting.endsAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {meeting.status === "scheduled" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onAction("start", meeting)}
            >
              Start now
            </Button>
          ) : null}
          {meeting.status === "active" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => onAction("wake", meeting)}
              >
                Ask agents again
              </Button>
              <ConfirmButton
                label="End"
                confirmLabel="End meeting"
                pendingLabel="Ending…"
                warning="Any agent reply in progress will stop."
                pending={pending}
                onConfirm={() => onAction("end", meeting)}
              />
            </>
          ) : null}
          <Link
            href={`/${orgSlug}/r/${meeting.roomId}`}
            className="inline-flex h-8 items-center rounded-sm px-2 font-mono text-[11px] text-muted hover:text-text"
          >
            open room
          </Link>
        </div>
      </div>
    </li>
  )
}

function ScheduleCard({
  room,
  schedule,
  orgSlug,
  onStart,
  pending,
}: {
  room: MeetingRoom
  schedule: RoomScheduleView | null
  orgSlug: string
  onStart: (roomId: string) => void
  pending: boolean
}) {
  if (!schedule) {
    return (
      <li className="border border-line bg-panel p-4">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-text">{room.name}</span>
          <span className="ml-auto font-mono text-[11px] text-faint">no schedule</span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          This room has no weekday stand-ups yet.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <ConfirmButton
            label="Start a meeting"
            confirmLabel="Start now"
            pendingLabel="Starting…"
            warning="Every agent in this room will reply, using your API credits."
            variant="outline"
            pending={pending}
            onConfirm={() => onStart(room.id)}
          />
          <Link
            href={`/${orgSlug}/r/${room.id}/settings`}
            className="font-mono text-[11px] text-muted hover:text-text"
          >
            set a schedule
          </Link>
        </div>
      </li>
    )
  }
  const now = minutesNow(schedule.timezone)
  const weekday = isWeekday(schedule.timezone)
  const inMorning =
    weekday &&
    now !== null &&
    now >= schedule.morningStartMinutes &&
    now < schedule.morningEndMinutes
  const inEvening =
    weekday &&
    now !== null &&
    now >= schedule.eveningStartMinutes &&
    now < schedule.eveningEndMinutes
  return (
    <li className="border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] text-text">{room.name}</span>
        {inMorning || inEvening ? (
          <span className="rounded-sm bg-accent px-1.5 py-0.5 font-mono text-[11px] uppercase text-void">
            in window
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[11px] text-faint">
          {schedule.timezone.replaceAll("_", " ")}
        </span>
      </div>
      <dl className="mt-3 space-y-1.5 font-mono text-[11px]">
        <div className="flex justify-between gap-3">
          <dt className="text-faint">morning</dt>
          <dd className="text-muted">
            {formatMinutes(schedule.morningStartMinutes)}–
            {formatMinutes(schedule.morningEndMinutes)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-faint">evening</dt>
          <dd className="text-muted">
            {formatMinutes(schedule.eveningStartMinutes)}–
            {formatMinutes(schedule.eveningEndMinutes)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-faint">check-ins</dt>
          <dd className="text-muted">
            {schedule.checkinsEnabled
              ? `every ${schedule.checkinIntervalMinutes}m · ${formatMinutes(schedule.checkinStartMinutes)}–${formatMinutes(schedule.checkinEndMinutes)}`
              : "off"}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <ConfirmButton
          label="Start a meeting"
          confirmLabel="Start now"
          pendingLabel="Starting…"
          warning="Every agent in this room will reply, using your API credits."
          variant="outline"
          pending={pending}
          onConfirm={() => onStart(room.id)}
        />
        <Link
          href={`/${orgSlug}/r/${room.id}`}
          className="font-mono text-[11px] text-muted hover:text-text"
        >
          open room
        </Link>
        <Link
          href={`/${orgSlug}/r/${room.id}/settings`}
          className="ml-auto font-mono text-[11px] text-muted hover:text-text"
        >
          edit schedule
        </Link>
      </div>
    </li>
  )
}

export function MeetingsView({
  orgSlug,
  rooms,
  schedules,
  meetings,
}: {
  orgSlug: string
  rooms: MeetingRoom[]
  schedules: RoomScheduleView[]
  meetings: MeetingView[]
}) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [formMode, setFormMode] = useState<"now" | "later">("now")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const schedulableRooms = rooms.filter((room) => room.kind !== "dm")
  const scheduleByRoom = new Map(schedules.map((schedule) => [schedule.roomId, schedule]))
  const active = meetings.filter((meeting) => meeting.status === "active")
  const upcoming = meetings
    .filter(
      (meeting) =>
        meeting.status === "scheduled" && new Date(meeting.endsAt).getTime() > Date.now(),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 8)
  const recent = meetings
    .filter((meeting) => meeting.status === "ended")
    .sort((a, b) => b.endsAt.localeCompare(a.endsAt))
    .slice(0, 8)
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

  function act(kind: "start" | "end" | "wake", meeting: MeetingView) {
    setError(null)
    setPendingId(meeting.id)
    startTransition(async () => {
      const result =
        kind === "start"
          ? await startScheduledMeetingAction(orgSlug, meeting.id)
          : kind === "wake"
            ? await wakeBotsAction(orgSlug, meeting.id)
            : await endMeetingAction(orgSlug, meeting.id)
      setPendingId(null)
      if (!result.ok) {
        setError(result.error ?? "Could not update the meeting")
        return
      }
      showToast({ message: result.message ?? "Meeting updated", tone: "success" })
      router.refresh()
    })
  }

  function startForRoom(roomId: string) {
    const form = new FormData()
    form.set("orgSlug", orgSlug)
    form.set("roomId", roomId)
    form.set("title", "Meeting")
    form.set("agenda", "")
    form.set("durationMinutes", "15")
    setPendingId(roomId)
    startTransition(async () => {
      const result = await startMeetingNowAction(null, form)
      setPendingId(null)
      if (!result.ok) {
        setError(result.error ?? "Could not start the meeting")
        return
      }
      const path = typeof result.data?.path === "string" ? result.data.path : `/${orgSlug}`
      router.push(path)
      router.refresh()
    })
  }

  function submitMeeting(form: FormData) {
    setError(null)
    if (formMode === "later") {
      // datetime-local has no zone: convert here, where the browser knows the user's zone.
      const startsAt = dateTimeLocalToIso(String(form.get("startsAt") ?? ""))
      if (!startsAt) {
        setError("Choose a start date and time")
        return
      }
      form.set("startsAt", startsAt)
    }
    startTransition(async () => {
      const result =
        formMode === "now"
          ? await startMeetingNowAction(null, form)
          : await scheduleMeetingAction(null, form)
      if (!result.ok) {
        setError(result.error ?? "Could not save the meeting")
        return
      }
      if (formMode === "now") {
        const path = typeof result.data?.path === "string" ? result.data.path : `/${orgSlug}`
        router.push(path)
        router.refresh()
        return
      }
      showToast({ message: result.message ?? "Meeting scheduled", tone: "success" })
      setShowForm(false)
      router.refresh()
    })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="font-mono text-[12px] text-faint">{today}</p>
            <h1 className="mt-1 text-2xl font-medium tracking-[-0.02em]">Meetings</h1>
            <p className="mt-1.5 max-w-[62ch] font-mono text-[12px] leading-relaxed text-muted">
              {active.length
                ? `${active.length} live now · ${upcoming.length} scheduled`
                : `${upcoming.length} scheduled · ${schedules.length} ${schedules.length === 1 ? "room" : "rooms"} with weekday stand-ups`}
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowForm((open) => !open)}
            aria-expanded={showForm}
          >
            {showForm ? "Close" : "Start a meeting"}
          </Button>
        </header>

        {error ? (
          <div className="mt-4">
            <InlineAlert tone="danger">{error}</InlineAlert>
          </div>
        ) : null}
        {showForm ? (
          <form action={submitMeeting} className="mt-5 border border-line bg-panel p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-2 font-mono text-[11px] text-faint">new meeting</p>
              <div className="flex gap-1">
                {(
                  [
                    { key: "now", label: "start now" },
                    { key: "later", label: "schedule" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setFormMode(option.key)}
                    aria-pressed={formMode === option.key}
                    className={cn(
                      "rounded-sm px-2 py-1 font-mono text-[11px]",
                      formMode === option.key
                        ? "bg-raised text-text"
                        : "text-muted hover:text-text",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="room" htmlFor="meeting-room">
                <Select id="meeting-room" name="roomId" required defaultValue="">
                  <option value="" disabled>
                    Choose a room
                  </option>
                  {schedulableRooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="title" htmlFor="meeting-title">
                <Input
                  id="meeting-title"
                  name="title"
                  required
                  maxLength={80}
                  defaultValue="Stand-up"
                />
              </Field>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_170px]">
              <Field label="agenda" htmlFor="meeting-agenda" hint="optional">
                <Textarea
                  id="meeting-agenda"
                  name="agenda"
                  rows={2}
                  className="min-h-16"
                  placeholder="What shipped, what is blocked, what needs a human decision."
                />
              </Field>
              <div className="space-y-3">
                <Field label="length" htmlFor="meeting-duration">
                  <Select id="meeting-duration" name="durationMinutes" defaultValue="15">
                    {[10, 15, 30, 45, 60].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes} minutes
                      </option>
                    ))}
                  </Select>
                </Field>
                {formMode === "later" ? (
                  <Field label="starts" htmlFor="meeting-starts">
                    <Input
                      id="meeting-starts"
                      name="startsAt"
                      type="datetime-local"
                      required
                      min={toDateTimeLocalValue(new Date(Date.now() + 5 * 60_000))}
                    />
                  </Field>
                ) : null}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <p className="max-w-[46ch] font-mono text-[11px] leading-relaxed text-faint">
                Every agent in the room is asked to reply, one at a time, using your API credits.
              </p>
              <Button
                type="submit"
                variant="primary"
                className="ml-auto"
                disabled={pending || schedulableRooms.length === 0}
              >
                {pending ? "Saving…" : formMode === "now" ? "Start meeting" : "Schedule meeting"}
              </Button>
            </div>
          </form>
        ) : null}

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
          <div className="space-y-10">
            <section aria-labelledby="live-heading">
              <div className="flex items-baseline justify-between">
                <h2 id="live-heading" className="text-[15px] font-medium">
                  Live now
                </h2>
                <span className="font-mono text-[11px] text-faint">agents reply one at a time</span>
              </div>
              {active.length === 0 ? (
                <p className="mt-3 border-l-2 border-line-strong pl-3 font-mono text-[12px] leading-relaxed text-faint">
                  No meeting is running. The scheduled ones start themselves on weekdays.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {active.map((meeting) => (
                    <MeetingCard
                      key={meeting.id}
                      meeting={meeting}
                      orgSlug={orgSlug}
                      pendingId={pendingId}
                      onAction={act}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="upcoming-heading">
              <div className="flex items-baseline justify-between">
                <h2 id="upcoming-heading" className="text-[15px] font-medium">
                  Upcoming
                </h2>
                <span className="font-mono text-[11px] text-faint">next 8</span>
              </div>
              {upcoming.length === 0 ? (
                <p className="mt-3 border-l-2 border-line-strong pl-3 font-mono text-[12px] leading-relaxed text-faint">
                  Nothing extra scheduled. Weekday stand-ups still run.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {upcoming.map((meeting) => (
                    <MeetingCard
                      key={meeting.id}
                      meeting={meeting}
                      orgSlug={orgSlug}
                      pendingId={pendingId}
                      onAction={act}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="recent-heading">
              <div className="flex items-baseline justify-between">
                <h2 id="recent-heading" className="text-[15px] font-medium">
                  Recently ended
                </h2>
                <span className="font-mono text-[11px] text-faint">last 7 days</span>
              </div>
              {recent.length === 0 ? (
                <p className="mt-3 border-l-2 border-line-strong pl-3 font-mono text-[12px] leading-relaxed text-faint">
                  No meetings have ended yet.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-line border-y border-line">
                  {recent.map((meeting) => (
                    <li key={meeting.id} className="flex flex-wrap items-baseline gap-2 py-2.5">
                      <span className="text-[12px] text-muted">{meeting.title}</span>
                      <Link
                        href={`/${orgSlug}/r/${meeting.roomId}`}
                        className="font-mono text-[11px] text-faint hover:text-text"
                      >
                        {meeting.roomName}
                      </Link>
                      <span className="ml-auto font-mono text-[11px] text-faint">
                        {formatMeetingTime(meeting.startsAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-medium">Weekday stand-ups</h2>
              <span className="font-mono text-[11px] text-faint">auto</span>
            </div>
            <p className="mt-2 max-w-[38ch] text-[12px] leading-relaxed text-muted">
              Each room runs two stand-ups every weekday, plus optional check-ins, in its own time
              zone. Agents reply using your API credits. Nothing runs on weekends.
            </p>
            {schedulableRooms.length === 0 ? (
              <div className="mt-5">
                <EmptyState
                  title="No rooms yet"
                  body="Create a room first, then set its stand-up times."
                />
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {rooms
                  .filter((room) => room.kind !== "dm")
                  .map((room) => (
                    <ScheduleCard
                      key={room.id}
                      room={room}
                      schedule={scheduleByRoom.get(room.id) ?? null}
                      orgSlug={orgSlug}
                      onStart={startForRoom}
                      pending={pending || pendingId === room.id}
                    />
                  ))}
              </ul>
            )}
            <p className="mt-4 font-mono text-[11px] leading-relaxed text-faint">
              Ending a meeting stops any agent reply in progress.
            </p>
          </aside>
        </div>
      </div>
    </div>
  )
}
