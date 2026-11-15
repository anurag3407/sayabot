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
import { RoomSidePanel, type RoomRoutine, type SideTab } from "@/components/room/side-panel"
import { PresenceLine } from "@/components/ui/avatar"
import { DetailsMenu } from "@/components/ui/details-menu"
import { Mascot } from "@/components/ui/mascot"
import { RoomSkeleton } from "@/components/ui/skeleton"
import { Bot, Ellipsis, FileText, PanelRight, Pencil, SlidersHorizontal, UserPlus } from "lucide-react"
import { cn } from "@/lib/format"
import type { RoomPageData } from "@/lib/types"

type View = "chat" | "panel"

/** Per chat: which side-panel tab is open, or "closed". */
const PANEL_KEY = "sayabot:panel"

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
  routines = [],
}: {
  data: RoomPageData
  initialCanvasId?: string | null
  focusMessageId?: string | null
  initialThreadId?: string | null
  setup?: SetupState | null
  routines?: RoomRoutine[]
}) {
  // Unknown until the first client render, so the layout is only ever mounted once.
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null)
  const [view, setView] = useState<View>(initialCanvasId ? "panel" : "chat")
  const [panelOpen, setPanelOpen] = useState(Boolean(initialCanvasId) || canvasHasContent(data))
  const [tab, setTab] = useState<SideTab>("canvas")
  const [addBotOpen, setAddBotOpen] = useState(false)
  const [threadRootId, setThreadRootId] = useState<string | null>(initialThreadId)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "room-split",
    panelIds: ["room-chat", "room-side"],
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
      const stored = window.localStorage.getItem(`${PANEL_KEY}:${data.room.id}`)
      if (stored === "closed") setPanelOpen(false)
      else if (stored === "screen" || stored === "activity" || stored === "canvas" || stored === "routines") {
        setTab(stored)
        setPanelOpen(true)
      }
    } catch {
      // Falls back to opening the canvas only when it has something in it.
    }
  }, [data.room.id, initialCanvasId])

  function remember(next: SideTab | "closed") {
    try {
      window.localStorage.setItem(`${PANEL_KEY}:${data.room.id}`, next)
    } catch {
      // The choice just lasts for this visit.
    }
  }

  function openPanel(next: SideTab) {
    setTab(next)
    remember(next)
    if (isDesktop) setPanelOpen(true)
    else setView("panel")
  }

  function closePanel() {
    remember("closed")
    if (isDesktop) setPanelOpen(false)
    else setView("chat")
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
  const dmAgent = data.room.kind === "dm" ? (data.roomAgents[0]?.agent ?? null) : null

  function showCanvas() {
    openPanel("canvas")
  }

  const chat = (
    <ChatPanel
      orgSlug={data.org.slug}
      roomId={data.room.id}
      roomName={data.room.name}
      roomKind={data.room.kind}
      executionMode={data.room.executionMode}
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

  const iconButton =
    "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-panel hover:text-text"
  const menuItem =
    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] text-muted transition-colors hover:bg-raised hover:text-text"
  const someoneTyping = presence.some((person) => person.typing && person.id !== data.user.id)
  const aboutHref = dmAgent
    ? `/${data.org.slug}/agents/${dmAgent.id}`
    : `/${data.org.slug}/r/${data.room.id}/settings`
  const panelShowing = isDesktop ? panelOpen : view === "panel"
  const waiting = realtime.toolCalls.filter((call) => call.status === "pending_approval").length

  const sidePanel = (
    <RoomSidePanel
      tab={tab}
      onTabChange={(next) => {
        setTab(next)
        remember(next)
      }}
      onClose={closePanel}
      orgSlug={data.org.slug}
      agents={data.roomAgents}
      canAdmin={data.canAdmin}
      viewerId={data.user.id}
      toolCalls={realtime.toolCalls}
      routines={routines}
      canvas={canvas}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="grid min-h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          {someoneTyping || (data.room.kind !== "dm" && presence.length > 1) ? (
            <div className="hidden truncate text-[12px] text-faint lg:block">
              <PresenceLine people={presence} selfId={data.user.id} />
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 items-center gap-1 rounded-full border border-line bg-panel/80 py-1 pl-1 pr-1.5">
          {dmAgent ? (
            <Mascot
              seed={dmAgent.displayName}
              mood={realtime.turnState?.activeAgentId ? "busy" : "idle"}
              lit={Boolean(realtime.turnState?.activeAgentId)}
              live
              className="h-8 w-8 shrink-0"
            />
          ) : data.roomAgents.length ? (
            <span className="flex shrink-0 -space-x-2.5 pl-0.5">
              {data.roomAgents.slice(0, 3).map(({ agent }) => (
                <Mascot key={agent.id} seed={agent.displayName} className="h-7 w-7 rounded-full ring-2 ring-panel" />
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
            className="max-w-[40vw] truncate pl-1 text-[15px] font-semibold tracking-[-0.01em] md:max-w-[260px]"
            data-testid="room-title"
          >
            {data.room.name}
          </h1>
          <Link
            href={aboutHref}
            aria-label={dmAgent ? `Edit ${dmAgent.displayName}` : "Chat settings"}
            title={dmAgent ? "Edit bot" : "Chat settings"}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-raised hover:text-text"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Link>
          {realtime.turnState?.activeAgentId ? (
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] text-accent sm:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              Working
            </span>
          ) : dmAgent ? (
            <span className="hidden shrink-0 rounded-full bg-raised px-2.5 py-0.5 text-[12px] text-muted sm:block">
              @{dmAgent.handle}
            </span>
          ) : data.roomAgents.length ? (
            <span className="hidden shrink-0 rounded-full bg-raised px-2.5 py-0.5 text-[12px] text-muted sm:block">
              {data.roomAgents.length === 1 ? "1 bot" : `${data.roomAgents.length} bots`}
            </span>
          ) : null}
          {realtime.connection !== "connected" ? <span className="sr-only">Connecting</span> : null}
        </div>

        <div className="flex min-w-0 items-center justify-end gap-1">
          {inviteProps ? (
            <div className="hidden md:block">
              <InvitePeople {...inviteProps} />
            </div>
          ) : null}
          <button
            type="button"
            aria-pressed={panelShowing}
            aria-label="Side panel"
            title={panelShowing ? "Hide panel" : "Screen, activity, canvas"}
            onClick={() => (panelShowing ? closePanel() : openPanel(tab))}
            className={cn(iconButton, "relative", panelShowing && "bg-panel text-text")}
          >
            <PanelRight className="h-[18px] w-[18px]" />
            {waiting && !panelShowing ? (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent shadow-[0_0_0_2px_var(--color-ink)]" />
            ) : null}
          </button>
          <DetailsMenu
            className="relative"
            summaryLabel="More"
            summaryClassName={cn(iconButton, "cursor-pointer list-none")}
            summary={<Ellipsis className="h-[18px] w-[18px]" />}
          >
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-2xl border border-line-strong bg-panel p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.55)]">
              <Link href={aboutHref} className={menuItem}>
                {dmAgent ? <Bot className="h-4 w-4 text-faint" /> : <SlidersHorizontal className="h-4 w-4 text-faint" />}
                {dmAgent ? "Edit bot" : "Chat settings"}
              </Link>
              {data.canAdmin ? (
                <button type="button" className={menuItem} onClick={() => setAddBotOpen(true)}>
                  <UserPlus className="h-4 w-4 text-faint" />
                  Add a bot to this chat
                </button>
              ) : null}
              <button type="button" className={menuItem} onClick={showCanvas}>
                <FileText className="h-4 w-4 text-faint" />
                Open canvas
              </button>
              {data.canAdmin && dmAgent ? (
                <Link href={`/${data.org.slug}/r/${data.room.id}/settings`} className={menuItem}>
                  <SlidersHorizontal className="h-4 w-4 text-faint" />
                  Chat settings
                </Link>
              ) : null}
              <div className="px-2.5 py-1.5">
                <EnableAlerts enabled={data.user.notifications !== "off"} />
              </div>
            </div>
          </DetailsMenu>
          {data.canAdmin ? (
            <InviteBotDialog
              orgSlug={data.org.slug}
              roomId={data.room.id}
              roomName={data.room.name}
              open={addBotOpen}
              onOpenChange={setAddBotOpen}
              hideTrigger
            />
          ) : null}
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
          defaultLayout={panelOpen ? defaultLayout : undefined}
          onLayoutChanged={panelOpen ? onLayoutChanged : undefined}
        >
          <Panel
            id="room-chat"
            defaultSize={panelOpen ? "60%" : "100%"}
            minSize="380px"
            className="min-h-0 overflow-hidden"
          >
            {chat}
          </Panel>
          {panelOpen ? (
            <>
              <Separator className="w-px bg-line transition-colors hover:bg-line-strong focus-visible:bg-accent" />
              <Panel
                id="room-side"
                defaultSize="40%"
                minSize="340px"
                className="min-h-0 overflow-hidden"
              >
                {sidePanel}
              </Panel>
            </>
          ) : null}
        </Group>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={cn("min-h-0 flex-1", view !== "chat" && "hidden")}>{chat}</div>
          {view === "panel" ? <div className="min-h-0 flex-1">{sidePanel}</div> : null}
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
