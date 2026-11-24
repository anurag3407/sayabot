"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
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
import {
  AgentConfigPanel,
  type AgentUsageView,
  type IdentityPreview,
  type AlertMode,
  type ConnectedAppView,
  type MemoryNoteView,
  type OrgSkillView,
} from "@/components/room/agent-config-panel"
import { RoomSidePanel, type RoomRoutine, type SideTab } from "@/components/room/side-panel"
import { mascotProps } from "@/lib/agent-look"
import { PresenceLine } from "@/components/ui/avatar"
import { DetailsMenu } from "@/components/ui/details-menu"
import { Mascot } from "@/components/ui/mascot"
import { RoomSkeleton } from "@/components/ui/skeleton"
import {
  Bot,
  Ellipsis,
  FileText,
  PanelRight,
  Pencil,
  Phone,
  SlidersHorizontal,
  UserPlus,
  Volume2,
} from "lucide-react"
import { CallModal, VoiceSettingsDialog } from "@/components/voice"
import { cn } from "@/lib/format"
import { isSayaHandle } from "@sayabot/core"
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
  return data.canvases.some((canvas) => canvas.snapshotText.replace(/^#.*$/m, "").trim().length > 0)
}

export function RoomWorkspace({
  data,
  initialCanvasId = null,
  focusMessageId = null,
  initialThreadId = null,
  setup = null,
  routines = [],
  initialConfigure = false,
  skills = [],
  apps = [],
  usage = {},
  alerts = "all",
  sound = true,
  memoryNotes = [],
}: {
  data: RoomPageData
  initialCanvasId?: string | null
  focusMessageId?: string | null
  initialThreadId?: string | null
  setup?: SetupState | null
  routines?: RoomRoutine[]
  /** Open the bot settings sidebar, from a chat-list "Edit bot" link. */
  initialConfigure?: boolean
  skills?: OrgSkillView[]
  apps?: ConnectedAppView[]
  usage?: Record<string, AgentUsageView>
  alerts?: AlertMode
  sound?: boolean
  memoryNotes?: MemoryNoteView[]
}) {
  // Unknown until the first client render, so the layout is only ever mounted once.
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null)
  const [view, setView] = useState<View>(initialCanvasId ? "panel" : "chat")
  const [panelOpen, setPanelOpen] = useState(Boolean(initialCanvasId) || canvasHasContent(data))
  const [tab, setTab] = useState<SideTab>("canvas")
  const [configAgentId, setConfigAgentId] = useState<string | null>(null)
  const [identityPreview, setIdentityPreview] = useState<IdentityPreview | null>(null)
  const onIdentityPreview = useCallback((preview: IdentityPreview | null) => {
    setIdentityPreview(preview)
  }, [])
  const lastMode = useRef<SideTab | "agent">(
    initialCanvasId || canvasHasContent(data)
      ? "canvas"
      : data.room.kind === "dm"
        ? "agent"
        : "canvas",
  )
  const [addBotOpen, setAddBotOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false)
  const [threadRootId, setThreadRootId] = useState<string | null>(initialThreadId)
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "room-split",
    panelIds: ["room-chat", "room-side"],
    storage: layoutStorage,
  })

  useEffect(() => {
    // Side-by-side needs room for both minimums (chat 380 + panel 340) next to the sidebar.
    const query = window.matchMedia("(min-width: 1100px)")
    const apply = () => setIsDesktop(query.matches)
    apply()
    query.addEventListener("change", apply)
    return () => query.removeEventListener("change", apply)
  }, [])

  const appliedPanelRoom = useRef<string | null>(null)
  useEffect(() => {
    if (isDesktop === null || initialCanvasId) return
    if (appliedPanelRoom.current === data.room.id) return
    appliedPanelRoom.current = data.room.id
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(`${PANEL_KEY}:${data.room.id}`)
    } catch {
      stored = null
    }
    const firstAgent = data.roomAgents[0]?.agent.id ?? null
    if (initialConfigure && firstAgent) {
      setConfigAgentId(firstAgent)
      if (isDesktop) setPanelOpen(true)
      else setView("panel")
      return
    }
    if (stored === "closed") {
      setPanelOpen(false)
      setConfigAgentId(null)
      return
    }
    if (stored === "agent" && firstAgent && isDesktop) {
      lastMode.current = "agent"
      setConfigAgentId(firstAgent)
      setPanelOpen(true)
      return
    }
    if (
      stored === "screen" ||
      stored === "activity" ||
      stored === "canvas" ||
      stored === "routines"
    ) {
      lastMode.current = stored
      setTab(stored)
      setConfigAgentId(null)
      setPanelOpen(true)
      return
    }
    if (!stored && isDesktop && data.room.kind === "dm" && firstAgent && !canvasHasContent(data)) {
      lastMode.current = "agent"
      setConfigAgentId(firstAgent)
      setPanelOpen(true)
    }
  }, [isDesktop, data, initialCanvasId, initialConfigure])

  function remember(next: SideTab | "agent" | "closed") {
    if (next !== "closed") lastMode.current = next
    try {
      window.localStorage.setItem(`${PANEL_KEY}:${data.room.id}`, next)
    } catch {
      // The choice just lasts for this visit.
    }
  }

  function openPanel(next: SideTab) {
    setConfigAgentId(null)
    setTab(next)
    remember(next)
    if (isDesktop) setPanelOpen(true)
    else setView("panel")
  }

  function openConfig(id: string) {
    setConfigAgentId(id)
    remember("agent")
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
    ? (realtime.messages.find((message) => message.id === threadRootId) ?? null)
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
      questions={data.questions}
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
      onOptimisticMessage={realtime.addOptimisticMessage}
      onOptimisticMessageError={(id, error) =>
        realtime.updateOptimisticMessage(id, { metadata: { failed: true, error } })
      }
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

  function showPanel() {
    if (lastMode.current === "agent") {
      const id = configAgentId ?? dmAgent?.id ?? data.roomAgents[0]?.agent.id
      if (id) {
        openConfig(id)
        return
      }
    }
    openPanel(lastMode.current === "agent" ? tab : lastMode.current)
  }

  const configAgent = data.roomAgents.find((item) => item.agent.id === configAgentId)?.agent
  const sidePanel = configAgent ? (
    <AgentConfigPanel
      orgSlug={data.org.slug}
      roomId={data.room.id}
      agents={data.roomAgents.map((item) => item.agent)}
      agentId={configAgent.id}
      onAgentChange={openConfig}
      canEdit={data.canAdmin}
      routines={routines}
      toolCalls={realtime.toolCalls}
      canvasCount={data.canvases.length}
      executionMode={data.room.executionMode}
      pendingApprovals={waiting}
      skills={skills}
      apps={apps}
      usage={usage}
      alerts={alerts}
      sound={sound}
      memoryNotes={memoryNotes}
      onClose={() => {
        setConfigAgentId(null)
        closePanel()
      }}
      onOpenWorkspace={(next) => openPanel(next)}
      onIdentityPreview={onIdentityPreview}
    />
  ) : (
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
      <header className="relative flex min-h-14 shrink-0 items-center gap-3 border-b border-line/60 px-3 py-2 md:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {dmAgent ? (
            <button
              type="button"
              onClick={() => openConfig(dmAgent.id)}
              aria-label={`Configure ${dmAgent.displayName}`}
              className="relative shrink-0 rounded-xl p-0.5 transition-transform hover:scale-105"
            >
              <Mascot
                {...mascotFor(dmAgent, identityPreview)}
                {...(realtime.turnState?.activeAgentId ? { mood: "busy" as const, lit: true } : {})}
                crown={isSayaHandle(dmAgent.handle)}
                live
                className="h-9 w-9"
              />
            </button>
          ) : data.roomAgents.length ? (
            <span className="flex shrink-0 -space-x-2.5 pl-0.5">
              {data.roomAgents.slice(0, 3).map(({ agent }) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => openConfig(agent.id)}
                  aria-label={`Configure ${agent.displayName}`}
                  title={agent.displayName}
                  className="rounded-full transition-transform hover:z-10 hover:-translate-y-0.5"
                >
                  <Mascot
                    {...mascotFor(agent, identityPreview)}
                    crown={isSayaHandle(agent.handle)}
                    className="h-8 w-8 rounded-full bg-ink ring-2 ring-ink"
                  />
                </button>
              ))}
              {data.roomAgents.length > 3 ? (
                <span className="z-10 grid h-8 w-8 place-items-center rounded-full bg-raised text-[11px] font-semibold text-muted ring-2 ring-ink">
                  +{data.roomAgents.length - 3}
                </span>
              ) : null}
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-raised text-[15px] font-semibold text-muted"
            >
              {roomPrefix}
            </span>
          )}

          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1">
              {dmAgent ? (
                <button
                  type="button"
                  onClick={() => openConfig(dmAgent.id)}
                  className="min-w-0 truncate text-left text-[15px] font-semibold tracking-[-0.01em] text-text"
                  data-testid="room-title"
                >
                  {identityPreview?.agentId === dmAgent.id &&
                  identityPreview.name.trim() &&
                  identityPreview.name.trim() !== dmAgent.displayName
                    ? identityPreview.name.trim()
                    : data.room.name}
                </button>
              ) : (
                <h1
                  className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-text"
                  data-testid="room-title"
                >
                  {data.room.name}
                </h1>
              )}
              {dmAgent ? (
                <button
                  type="button"
                  onClick={() => openConfig(dmAgent.id)}
                  aria-pressed={Boolean(configAgent)}
                  aria-label={`Edit ${dmAgent.displayName}`}
                  title="Edit bot"
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-raised hover:text-text",
                    configAgent && "bg-raised text-text",
                  )}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              ) : (
                <Link
                  href={aboutHref}
                  aria-label="Chat settings"
                  title="Chat settings"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-raised hover:text-text"
                >
                  <Pencil className="h-3 w-3" />
                </Link>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-faint">
              {realtime.turnState?.activeAgentId ? (
                <span className="flex shrink-0 items-center gap-1.5 font-medium text-accent">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                  </span>
                  Working
                </span>
              ) : null}
              {realtime.turnState?.activeAgentId ? <span aria-hidden="true">·</span> : null}
              {someoneTyping || (data.room.kind !== "dm" && presence.length > 1) ? (
                <span className="min-w-0 truncate">
                  <PresenceLine people={presence} selfId={data.user.id} />
                </span>
              ) : dmAgent ? (
                <span className="min-w-0 truncate">
                  @{dmAgent.handle}
                  {isSayaHandle(dmAgent.handle) ? " · Orchestrator" : ""}
                </span>
              ) : (
                <span className="min-w-0 truncate">
                  {data.roomAgents.length === 1 ? "1 bot" : `${data.roomAgents.length} bots`}
                  {data.roomMemberIds.length > 1
                    ? ` · ${data.roomMemberIds.length} people`
                    : ""}
                  {data.room.kind === "private" ? " · private" : ""}
                </span>
              )}
            </div>
          </div>
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
            aria-label="Start voice call"
            title="Start voice call (Take-turns audio)"
            onClick={() => setCallOpen(true)}
            className={cn(iconButton, "hover:text-accent hover:bg-accent-soft")}
          >
            <Phone className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            aria-pressed={panelShowing}
            aria-label={configAgent ? "Bot settings" : "Side panel"}
            title={
              panelShowing
                ? "Hide panel"
                : lastMode.current === "agent"
                  ? "Bot settings"
                  : "Screen, activity, canvas"
            }
            onClick={() => (panelShowing ? closePanel() : showPanel())}
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
              {dmAgent ? (
                <button type="button" className={menuItem} onClick={() => openConfig(dmAgent.id)}>
                  <Bot className="h-4 w-4 text-faint" />
                  Edit bot
                </button>
              ) : (
                <Link href={aboutHref} className={menuItem}>
                  <SlidersHorizontal className="h-4 w-4 text-faint" />
                  Chat settings
                </Link>
              )}
              {!dmAgent && data.roomAgents[0] ? (
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    const first = data.roomAgents[0]
                    if (first) openConfig(first.agent.id)
                  }}
                >
                  <Bot className="h-4 w-4 text-faint" />
                  {data.roomAgents.length === 1
                    ? `Configure ${data.roomAgents[0].agent.displayName}`
                    : "Configure a bot"}
                </button>
              ) : null}
              {data.canAdmin && !dmAgent ? (
                <button type="button" className={menuItem} onClick={() => setAddBotOpen(true)}>
                  <UserPlus className="h-4 w-4 text-faint" />
                  Add a bot to this chat
                </button>
              ) : null}
              {data.canAdmin && dmAgent ? (
                <Link href={`/${data.org.slug}/chats/new`} className={menuItem}>
                  <UserPlus className="h-4 w-4 text-faint" />
                  Create a room to add bots
                </Link>
              ) : null}
              <button type="button" className={menuItem} onClick={showCanvas}>
                <FileText className="h-4 w-4 text-faint" />
                Open canvas
              </button>
              <button type="button" className={menuItem} onClick={() => setVoiceSettingsOpen(true)}>
                <Volume2 className="h-4 w-4 text-faint" />
                Voice settings
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

      <RoomMeetingBar orgSlug={data.org.slug} meeting={data.meeting} schedule={data.roomSchedule} />

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
        onOptimisticMessage={realtime.addOptimisticMessage}
        onOptimisticMessageError={(id, error) =>
          realtime.updateOptimisticMessage(id, { metadata: { failed: true, error } })
        }
        onClose={() => setThreadRootId(null)}
      />

      <CallModal
        isOpen={callOpen}
        onClose={() => setCallOpen(false)}
        orgSlug={data.org.slug}
        roomId={data.room.id}
        roomName={data.room.name}
        agent={dmAgent ?? data.roomAgents[0]?.agent ?? null}
        messages={realtime.messages}
        toolCalls={realtime.toolCalls}
        turnState={realtime.turnState}
      />

      <VoiceSettingsDialog
        isOpen={voiceSettingsOpen}
        onClose={() => setVoiceSettingsOpen(false)}
        roomId={data.room.id}
      />
    </div>
  )
}

function mascotFor(
  agent: { id: string; displayName: string; params: Record<string, unknown> },
  preview: IdentityPreview | null,
) {
  if (!preview || preview.agentId !== agent.id) return mascotProps(agent.displayName, agent.params)
  const current =
    agent.params.mascot && typeof agent.params.mascot === "object"
      ? (agent.params.mascot as Record<string, unknown>)
      : {}
  return mascotProps(agent.displayName, {
    ...agent.params,
    mascot: {
      ...current,
      ...(preview.look.shape ? { shape: preview.look.shape } : {}),
      ...(preview.look.tone ? { tone: preview.look.tone } : {}),
      ...(preview.look.mood ? { mood: preview.look.mood } : {}),
    },
  })
}
