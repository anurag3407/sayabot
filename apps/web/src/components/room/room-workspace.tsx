"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels"
import { ChatPanel } from "@/components/room/chat-panel"
import { CanvasPanel } from "@/components/room/canvas-panel"
import type { SetupState } from "@/components/room/setup-checklist"
import { ThreadSheet } from "@/components/room/thread-sheet"
import { useRoomRealtime } from "@/components/room/use-room-realtime"
import { EnableAlerts, RoomActivity } from "@/components/room/room-activity"
import { RoomMeetingBar } from "@/components/room/room-meeting-bar"
import { InviteBotDialog } from "@/components/room/invite-bot-dialog"
import { AvatarStack, PresenceLine } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { CanvasIcon, SlidersIcon } from "@/components/ui/icons"
import { RoomSkeleton } from "@/components/ui/skeleton"
import { ModelPickerButton } from "@/components/room/model-picker"
import { cn, TURN_MODE_SHORT } from "@/lib/format"
import type { RoomPageData } from "@/lib/types"

type View = "chat" | "canvas"

const CANVAS_OPEN_KEY = "mesh:canvas-open"

/** The panel library defaults to localStorage, which does not exist during server rendering. */
const layoutStorage = {
  getItem(key: string): string | null {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // The split position just resets on the next visit.
    }
  },
}

function canvasHasContent(data: RoomPageData): boolean {
  return data.canvases.some(
    (canvas) => canvas.snapshotText.replace(/^#.*$/m, "").trim().length > 0,
  )
}

export function RoomWorkspace({
  data,
  initialCanvasId = null,
  focusMessageId = null,
  initialThreadId = null,
  setup = null,
}: {
  data: RoomPageData
  initialCanvasId?: string | null
  focusMessageId?: string | null
  initialThreadId?: string | null
  setup?: SetupState | null
}) {
  // Unknown until the first client render, so the layout is only ever mounted once.
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null)
  const [view, setView] = useState<View>(initialCanvasId ? "canvas" : "chat")
  const [canvasOpen, setCanvasOpen] = useState(Boolean(initialCanvasId) || canvasHasContent(data))
  const [threadRootId, setThreadRootId] = useState<string | null>(initialThreadId)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "room-split",
    panelIds: ["room-chat", "room-canvas"],
    storage: layoutStorage,
  })

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)")
    const apply = () => setIsDesktop(query.matches)
    apply()
    query.addEventListener("change", apply)
    return () => query.removeEventListener("change", apply)
  }, [])

  useEffect(() => {
    if (initialCanvasId) return
    try {
      const stored = window.localStorage.getItem(`${CANVAS_OPEN_KEY}:${data.room.id}`)
      if (stored !== null) setCanvasOpen(stored === "1")
    } catch {
      // Falls back to opening the canvas only when it has something in it.
    }
  }, [data.room.id, initialCanvasId])

  function toggleCanvas(next: boolean) {
    setCanvasOpen(next)
    try {
      window.localStorage.setItem(`${CANVAS_OPEN_KEY}:${data.room.id}`, next ? "1" : "0")
    } catch {
      // The choice just lasts for this visit.
    }
  }

  const realtime = useRoomRealtime({
    roomId: data.room.id,
    user: { id: data.user.id, email: data.user.email },
    displayName: data.user.displayName,
    initialMessages: data.messages,
    initialToolCalls: data.toolCalls,
    initialSession: data.activeSession,
    initialThreadCounts: data.threadCounts,
    focusMessageId,
    roomAgents: data.roomAgents,
    members: data.members,
  })

  const root = threadRootId
    ? realtime.messages.find((message) => message.id === threadRootId) ?? null
    : null

  const presence = realtime.presence.length
    ? realtime.presence
    : [{ id: data.user.id, name: data.user.displayName, typing: false }]

  const roomPeople =
    data.room.kind === "public"
      ? data.members
      : data.members.filter((member) => data.roomMemberIds.includes(member.userId))

  const roomPrefix = data.room.kind === "public" ? "#" : data.room.kind === "dm" ? "@" : "·"

  function showCanvas() {
    if (isDesktop) toggleCanvas(true)
    else setView("canvas")
  }

  const chat = (
    <ChatPanel
      orgSlug={data.org.slug}
      roomId={data.room.id}
      roomName={data.room.name}
      roomKind={data.room.kind}
      user={{ id: data.user.id, displayName: data.user.displayName }}
      messages={realtime.messages}
      toolCalls={realtime.toolCalls}
      turnState={realtime.turnState}
      runActivity={realtime.runActivity}
      roomAgents={data.roomAgents}
      people={roomPeople}
      canAdmin={data.canAdmin}
      memberAvatars={data.memberAvatars}
      connection={realtime.connection}
      threadCounts={realtime.threadCounts}
      hasOlder={realtime.hasOlder}
      loadingOlder={realtime.loadingOlder}
      lastReadAt={data.lastReadAt}
      focusMessageId={focusMessageId}
      setup={setup}
      onLoadOlder={realtime.loadOlder}
      onOpenThread={(message) => setThreadRootId(message.id)}
      onTyping={realtime.trackTyping}
      onShowCanvas={showCanvas}
    />
  )

  const canvas = (
    <CanvasPanel
      canvases={data.canvases}
      orgSlug={data.org.slug}
      roomId={data.room.id}
      userName={data.user.displayName}
      initialCanvasId={initialCanvasId}
      canAdmin={data.canAdmin}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-x-4 gap-y-2 border-b border-line bg-ink px-4 py-2 md:flex-wrap md:py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-x-2 gap-y-0.5 md:flex-wrap">
            <span aria-hidden="true" className="font-mono text-[12px] text-faint">
              {roomPrefix}
            </span>
            <h1
              className="truncate text-[15px] font-medium tracking-[-0.01em]"
              data-testid="room-title"
            >
              {data.room.name}
            </h1>
            <span className="hidden font-mono text-[11px] text-faint md:inline">
              {data.room.kind === "dm" ? "direct chat" : data.room.kind} ·{" "}
              {TURN_MODE_SHORT[data.room.turnMode] ?? data.room.turnMode}
            </span>
          </div>
          <div className="mt-1 hidden items-center gap-2 md:flex">
            <AvatarStack people={presence} />
            <PresenceLine people={presence} selfId={data.user.id} />
            {realtime.connection === "connected" ? (
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-faint">
                <span aria-hidden="true" className="h-1 w-1 bg-[var(--color-ok)]" />
                live
              </span>
            ) : null}
          </div>
          {presence.some((person) => person.typing && person.id !== data.user.id) ? (
            <div className="md:hidden">
              <PresenceLine people={presence} selfId={data.user.id} />
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
          <ModelPickerButton />
          <div className="hidden md:block">
            <EnableAlerts enabled={data.user.notifications !== "off"} />
          </div>
          {isDesktop ? (
            <Button
              size="sm"
              variant={canvasOpen ? "secondary" : "outline"}
              aria-pressed={canvasOpen}
              onClick={() => toggleCanvas(!canvasOpen)}
            >
              <CanvasIcon width={13} height={13} />
              Canvas
            </Button>
          ) : null}
          {data.canAdmin ? (
            <InviteBotDialog
              orgSlug={data.org.slug}
              roomId={data.room.id}
              roomName={data.room.name}
            />
          ) : null}
          {data.canAdmin ? (
            <Link
              href={`/${data.org.slug}/r/${data.room.id}/settings`}
              aria-label="Room settings"
              className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-line px-2.5 font-mono text-[12px] text-muted hover:border-line-strong hover:text-text md:h-8"
            >
              <SlidersIcon width={13} height={13} />
              <span className="hidden md:inline">Settings</span>
            </Link>
          ) : null}
          <div className="flex items-center gap-1 md:hidden" role="group" aria-label="Room view">
            {(["chat", "canvas"] as const).map((item) => (
              <Button
                key={item}
                size="sm"
                variant={view === item ? "secondary" : "ghost"}
                onClick={() => setView(item)}
                aria-pressed={view === item}
              >
                {item === "chat" ? "Chat" : "Canvas"}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <RoomMeetingBar
        orgSlug={data.org.slug}
        meeting={data.meeting}
        schedule={data.roomSchedule}
      />

      <RoomActivity
        orgSlug={data.org.slug}
        roomId={data.room.id}
        roomName={data.room.name}
        userId={data.user.id}
        userName={data.user.displayName}
        notifications={data.user.notifications}
        sound={data.user.sound}
        messages={realtime.messages}
      />

      {isDesktop === null ? (
        <div className="min-h-0 flex-1">
          <RoomSkeleton />
        </div>
      ) : isDesktop ? (
        <Group
          orientation="horizontal"
          id="room-split"
          className="min-h-0 flex-1"
          defaultLayout={canvasOpen ? defaultLayout : undefined}
          onLayoutChanged={canvasOpen ? onLayoutChanged : undefined}
        >
          <Panel
            id="room-chat"
            defaultSize={canvasOpen ? "57%" : "100%"}
            minSize="380px"
            className="min-h-0 overflow-hidden"
          >
            {chat}
          </Panel>
          {canvasOpen ? (
            <>
              <Separator className="w-1 bg-line transition-colors hover:bg-line-strong focus-visible:bg-accent" />
              <Panel
                id="room-canvas"
                defaultSize="43%"
                minSize="300px"
                className="min-h-0 overflow-hidden"
              >
                {canvas}
              </Panel>
            </>
          ) : null}
        </Group>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn("min-h-0 flex-1", view !== "chat" && "hidden")}>{chat}</div>
          {view === "canvas" ? <div className="min-h-0 flex-1">{canvas}</div> : null}
        </div>
      )}

      <ThreadSheet
        root={root}
        messages={realtime.messages}
        toolCalls={realtime.toolCalls}
        orgSlug={data.org.slug}
        roomId={data.room.id}
        roomName={data.room.name}
        roomAgents={data.roomAgents}
        people={roomPeople}
        selfId={data.user.id}
        canAdmin={data.canAdmin}
        memberAvatars={data.memberAvatars}
        mergeHistory={realtime.mergeHistory}
        onTyping={realtime.trackTyping}
        onClose={() => setThreadRootId(null)}
      />
    </div>
  )
}
