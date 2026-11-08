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
import { PresenceLine } from "@/components/ui/avatar"
import { Mascot } from "@/components/ui/mascot"
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
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line px-4 py-2">
        {data.room.kind === "dm" && data.roomAgents[0] ? (
          <Mascot seed={data.roomAgents[0].agent.displayName} className="h-8 w-8" />
        ) : (
          <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-raised text-[14px] text-muted">
            {roomPrefix}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-medium leading-tight" data-testid="room-title">
            {data.room.name}
          </h1>
          <div className="mt-0.5 hidden items-center gap-1.5 text-[12px] leading-tight text-faint md:flex">
            {realtime.connection === "connected" ? (
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--color-ok)]" />
            ) : null}
            <span className="truncate">
              {data.room.kind === "dm" ? "Direct chat" : TURN_MODE_SHORT[data.room.turnMode] ?? data.room.turnMode}
            </span>
            <span aria-hidden="true">·</span>
            <PresenceLine people={presence} selfId={data.user.id} />
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
              size="icon"
              variant={canvasOpen ? "secondary" : "ghost"}
              aria-pressed={canvasOpen}
              aria-label="Canvas"
              title="Canvas"
              onClick={() => toggleCanvas(!canvasOpen)}
            >
              <CanvasIcon width={16} height={16} />
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
              title="Room settings"
              className="grid h-11 w-11 place-items-center rounded-sm text-muted hover:bg-raised hover:text-text md:h-9 md:w-9"
            >
              <SlidersIcon width={16} height={16} />
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
              <Separator className="w-px bg-line transition-colors hover:bg-line-strong focus-visible:bg-accent" />
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
