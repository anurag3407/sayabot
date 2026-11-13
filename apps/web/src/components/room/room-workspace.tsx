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
import { InvitePeople, RoomInviteNudge } from "@/components/room/invite-people"
import { PresenceLine } from "@/components/ui/avatar"
import { Mascot } from "@/components/ui/mascot"
import { Button } from "@/components/ui/button"
import { SlidersIcon } from "@/components/ui/icons"
import { RoomSkeleton } from "@/components/ui/skeleton"
import { TitlebarActions, useTitlebarSlot } from "@/components/workspace/titlebar-slot"
import { ChevronRight, PanelRight } from "lucide-react"
import { cn } from "@/lib/format"
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
  // On wide screens the tab names the chat, so its buttons move up into the title bar.
  const inTitlebar = Boolean(useTitlebarSlot())
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
      userId={data.user.id}
      canvases={data.canvases}
      orgSlug={data.org.slug}
      roomId={data.room.id}
      userName={data.user.displayName}
      initialCanvasId={initialCanvasId}
      canAdmin={data.canAdmin}
    />
  )

  const inviteProps =
    data.canAdmin && data.room.kind !== "dm"
      ? {
          orgSlug: data.org.slug,
          roomId: data.room.id,
          roomName: data.room.name,
          canInviteNew: data.orgRole !== "member",
          workspaceMembers: data.members
            .filter((member) => !data.roomMemberIds.includes(member.userId))
            .map((member) => ({ userId: member.userId, displayName: member.displayName })),
        }
      : null

  const actionButton = cn(
    "grid place-items-center text-muted transition-colors hover:bg-panel hover:text-text",
    inTitlebar ? "h-9 w-9 rounded-lg" : "h-10 w-10 rounded-full",
  )

  const actions = (
    <>
      <div className="hidden md:block">
        <EnableAlerts enabled={data.user.notifications !== "off"} />
      </div>
      {inviteProps ? <InvitePeople {...inviteProps} /> : null}
      {data.canAdmin ? (
        <InviteBotDialog orgSlug={data.org.slug} roomId={data.room.id} roomName={data.room.name} />
      ) : null}
      {data.canAdmin ? (
        <Link
          href={`/${data.org.slug}/r/${data.room.id}/settings`}
          aria-label="Chat settings"
          title="Chat settings"
          className={actionButton}
        >
          <SlidersIcon width={16} height={16} />
        </Link>
      ) : null}
      {isDesktop ? (
        <button
          type="button"
          aria-pressed={canvasOpen}
          aria-label="Canvas"
          title={canvasOpen ? "Hide canvas" : "Show canvas"}
          onClick={() => toggleCanvas(!canvasOpen)}
          className={cn(actionButton, canvasOpen && "bg-panel text-text")}
        >
          <PanelRight className="h-[18px] w-[18px]" />
        </button>
      ) : null}
    </>
  )

  const someoneTyping = presence.some((person) => person.typing && person.id !== data.user.id)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {inTitlebar ? <TitlebarActions fallback={false}>{actions}</TitlebarActions> : null}
      {inTitlebar && someoneTyping ? (
        <div className="shrink-0 px-4 pt-2 text-center text-[12px] text-faint">
          <PresenceLine people={presence} selfId={data.user.id} />
        </div>
      ) : null}
      <header
        className={cn(
          "grid min-h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 md:px-4",
          inTitlebar && "hidden",
        )}
      >
        <div className="flex min-w-0 items-center gap-1">
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

        <div className="flex min-w-0 flex-col items-center">
          <Link
            href={
              data.room.kind === "dm" && data.roomAgents[0]
                ? `/${data.org.slug}/agents/${data.roomAgents[0].agent.id}`
                : `/${data.org.slug}/r/${data.room.id}/settings`
            }
            title={data.room.kind === "dm" ? "About this agent" : "About this chat"}
            className="group flex h-11 min-w-0 max-w-[60vw] items-center gap-2 rounded-full bg-panel py-1 pl-1.5 pr-3.5 transition-colors hover:bg-raised md:max-w-[360px]"
          >
            {data.room.kind === "dm" && data.roomAgents[0] ? (
              <Mascot
                seed={data.roomAgents[0].agent.displayName}
                mood={realtime.turnState?.activeAgentId ? "busy" : "idle"}
                blink
                className="h-8 w-8 shrink-0"
              />
            ) : data.roomAgents.length ? (
              <span className="flex shrink-0 -space-x-2.5 pl-0.5">
                {data.roomAgents.slice(0, 3).map(({ agent }) => (
                  <Mascot
                    key={agent.id}
                    seed={agent.displayName}
                    className="h-7 w-7 rounded-full ring-2 ring-panel"
                  />
                ))}
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raised text-[14px] text-muted"
              >
                {roomPrefix}
              </span>
            )}
            <h1
              className="truncate text-[15px] font-semibold tracking-[-0.01em]"
              data-testid="room-title"
            >
              {data.room.name}
            </h1>
            <ChevronRight
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5"
            />
          </Link>
          {presence.some((person) => person.typing && person.id !== data.user.id) ||
          (data.room.kind !== "dm" && presence.length > 1) ? (
            <div className="mt-1 text-[12px] text-faint">
              <PresenceLine people={presence} selfId={data.user.id} />
            </div>
          ) : null}
          {realtime.connection !== "connected" ? (
            <span className="sr-only">Connecting</span>
          ) : null}
        </div>

        <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">
          {inTitlebar ? null : actions}
        </div>
      </header>

      {inviteProps && data.roomMemberIds.length <= 1 ? <RoomInviteNudge {...inviteProps} /> : null}

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
