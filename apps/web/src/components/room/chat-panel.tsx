"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { MessageItem } from "@/components/room/message-item"
import { Composer } from "@/components/room/composer"
import { SetupChecklist, type SetupState } from "@/components/room/setup-checklist"
import { StarterCard } from "@/components/room/starter-card"
import { Mascot } from "@/components/ui/mascot"
import { TurnStrip } from "@/components/room/turn-strip"
import { ToolCallsList } from "@/components/room/tool-call-card"
import { Button } from "@/components/ui/button"
import { EmptyState, InlineAlert } from "@/components/ui/empty"
import { RETRYABLE_REASONS } from "@/lib/recovery-hint"
import { truncate } from "@/lib/format"
import type {
  MemberView,
  MessageView,
  RoomAgentView,
  ToolCallView,
  TurnStateView,
} from "@/lib/types"

const STICK_THRESHOLD_PX = 140

function dayLabel(iso: string) {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return "today"
  if (date.toDateString() === yesterday.toDateString()) return "yesterday"
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

function canRetry(message: MessageView): boolean {
  if (message.senderType === "system") {
    return (
      message.status === "halted" &&
      typeof message.metadata.reason === "string" &&
      RETRYABLE_REASONS.has(message.metadata.reason)
    )
  }
  return message.senderType === "agent" && message.status === "error"
}

export function ChatPanel({
  orgSlug,
  roomId,
  roomName,
  roomKind = "public",
  user,
  messages,
  toolCalls,
  turnState,
  runActivity,
  roomAgents,
  people,
  canAdmin,
  memberAvatars,
  connection,
  threadCounts,
  hasOlder,
  loadingOlder,
  lastReadAt,
  focusMessageId,
  setup,
  onLoadOlder,
  onOpenThread,
  onTyping,
  onShowCanvas,
}: {
  orgSlug: string
  roomId: string
  roomName: string
  roomKind?: "public" | "private" | "dm"
  user: { id: string; displayName: string }
  messages: MessageView[]
  toolCalls: ToolCallView[]
  turnState: TurnStateView | null
  runActivity?: import("./use-room-realtime").RunActivityState | null
  roomAgents: RoomAgentView[]
  people: MemberView[]
  canAdmin: boolean
  memberAvatars: Record<string, string>
  connection: "connecting" | "connected" | "error" | "offline"
  threadCounts: Record<string, number>
  hasOlder: boolean
  loadingOlder: boolean
  lastReadAt: string | null
  focusMessageId: string | null
  setup: SetupState | null
  onLoadOlder: () => Promise<void>
  onOpenThread: (message: MessageView) => void
  onTyping: () => void
  onShowCanvas: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const prependAnchor = useRef<number | null>(null)
  const initialScrollDone = useRef(false)
  const seenCount = useRef(0)
  const [showJump, setShowJump] = useState(false)
  const [newCount, setNewCount] = useState(0)

  const mainMessages = useMemo(
    () => messages.filter((message) => message.threadRootId === null),
    [messages],
  )
  const [firstUnreadId] = useState<string | null>(() => {
    if (!lastReadAt) return null
    const lastRead = new Date(lastReadAt).getTime()
    return (
      messages.find(
        (message) =>
          message.threadRootId === null &&
          message.senderId !== user.id &&
          new Date(message.createdAt).getTime() > lastRead,
      )?.id ?? null
    )
  })

  const streamingMessage = [...messages]
    .reverse()
    .find(
      (message) =>
        message.status === "streaming" &&
        message.senderType === "agent" &&
        message.threadRootId === null,
    )

  const orphanCalls = useMemo(() => {
    const shownInFeed = (call: ToolCallView) =>
      mainMessages.some(
        (message) =>
          call.messageId === message.id ||
          (message.runId !== null && call.runId === message.runId && call.messageId === null),
      )
    // Only items that still need attention belong above the composer. Finished calls from a
    // thread, or from a message older than the loaded window, stay with their own message.
    return toolCalls.filter(
      (call) =>
        !shownInFeed(call) &&
        (call.status === "pending_approval" || (!call.messageId && call.status === "running")),
    )
  }, [toolCalls, mainMessages])

  const latestCompleted = useMemo(
    () =>
      [...mainMessages]
        .reverse()
        .find((message) => message.status === "complete" && message.senderId !== user.id) ?? null,
    [mainMessages, user.id],
  )
  const [announced, setAnnounced] = useState("")
  const announcedId = useRef(latestCompleted?.id ?? null)

  useEffect(() => {
    if (!latestCompleted || latestCompleted.id === announcedId.current) return
    announcedId.current = latestCompleted.id
    setAnnounced(`${latestCompleted.senderName}: ${truncate(latestCompleted.content, 300)}`)
  }, [latestCompleted])

  function scrollToBottom() {
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    stickToBottom.current = true
    setShowJump(false)
    setNewCount(0)
  }

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    if (!initialScrollDone.current) {
      initialScrollDone.current = true
      seenCount.current = mainMessages.length
      const target = focusMessageId ?? firstUnreadId
      const marker = target
        ? element.querySelector<HTMLElement>(`[data-message-id="${target}"]`)
        : null
      if (marker) {
        marker.scrollIntoView({ block: "center" })
        stickToBottom.current = false
      } else {
        element.scrollTop = element.scrollHeight
      }
      return
    }
    if (prependAnchor.current !== null) {
      element.scrollTop = element.scrollHeight - prependAnchor.current
      prependAnchor.current = null
      seenCount.current = mainMessages.length
      return
    }
    if (stickToBottom.current) {
      element.scrollTop = element.scrollHeight
      seenCount.current = mainMessages.length
      return
    }
    const added = mainMessages.length - seenCount.current
    if (added > 0) {
      seenCount.current = mainMessages.length
      setNewCount((count) => count + added)
    }
  }, [messages, mainMessages.length, focusMessageId, firstUnreadId])

  const focusedOnce = useRef(false)
  useEffect(() => {
    if (!focusMessageId || focusedOnce.current) return
    const marker = scrollRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${focusMessageId}"]`,
    )
    if (!marker) return
    focusedOnce.current = true
    marker.scrollIntoView({ block: "center" })
    stickToBottom.current = false
    marker.classList.add("message-highlight")
  }, [focusMessageId, mainMessages.length])

  async function loadOlder() {
    const element = scrollRef.current
    if (element) prependAnchor.current = element.scrollHeight - element.scrollTop
    await onLoadOlder()
  }

  const hasMessages = mainMessages.length > 0

  return (
    <section
      className="relative flex h-full min-h-0 flex-col"
      aria-label={`Chat in ${roomName}`}
    >
      {connection === "error" ? (
        <div className="border-b border-line px-4 py-2">
          <InlineAlert tone="warning">
            Live updates are paused, so new messages may take a few seconds. Reconnecting…
          </InlineAlert>
        </div>
      ) : null}
      {connection === "offline" ? (
        <div className="border-b border-line px-4 py-2">
          <InlineAlert tone="warning">
            You are offline. Messages you write will send when you reconnect.
          </InlineAlert>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget
          const nearBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD_PX
          stickToBottom.current = nearBottom
          setShowJump(!nearBottom)
          if (nearBottom) setNewCount(0)
        }}
        className="relative min-h-0 flex-1 overflow-y-auto outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
        role="log"
        aria-live="off"
        tabIndex={0}
        aria-label="Messages"
      >
        {setup ? <SetupChecklist setup={setup} orgSlug={orgSlug} roomId={roomId} /> : null}

        {!hasMessages && setup ? null : !hasMessages && roomKind === "dm" && roomAgents[0] ? (
          <StarterCard
            orgSlug={orgSlug}
            roomId={roomId}
            agentName={roomAgents[0].agent.displayName}
            userName={user.displayName}
            onSent={scrollToBottom}
            onSomethingElse={() =>
              document.querySelector<HTMLTextAreaElement>('[data-testid="composer"]')?.focus()
            }
          />
        ) : !hasMessages ? (
          <div className="px-6 py-10">
            {roomAgents.length ? (
              <div className="mb-2 flex justify-center -space-x-3" aria-hidden="true">
                {roomAgents.slice(0, 4).map(({ agent }) => (
                  <Mascot key={agent.id} seed={agent.displayName} figure blink className="h-[84px] w-auto" />
                ))}
              </div>
            ) : null}
            <EmptyState
              title="It's quiet in here"
              body={
                roomAgents.length
                  ? `Say hi! Type @ and pick a name to ask ${roomAgents
                      .map(({ agent }) => agent.displayName)
                      .join(", ")} for help.`
                  : canAdmin
                    ? "Add an agent to this chat, then type @ and its name to ask it something."
                    : "No agents here yet. Ask whoever runs this chat to add one, or start talking with your team."
              }
              action={
                canAdmin ? (
                  <Link
                    href={`/${orgSlug}/r/${roomId}/settings`}
                    className="text-[13px] text-accent underline underline-offset-4"
                  >
                    Chat settings
                  </Link>
                ) : null
              }
            />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[780px] px-1 pb-4 pt-2 md:px-4">
            {hasOlder ? (
              <div className="flex justify-center pt-4">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingOlder}
                  onClick={() => void loadOlder()}
                >
                  {loadingOlder ? "Loading…" : "Load older messages"}
                </Button>
              </div>
            ) : null}
            {mainMessages.map((message, index) => {
              const previous = mainMessages[index - 1]
              const showDay = !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt)
              return (
                <div key={message.id} data-message-id={message.id}>
                  {showDay ? (
                    <p className="px-4 pb-2 pt-6 text-center text-[13px] capitalize text-faint" aria-hidden="true">
                      {dayLabel(message.createdAt)}
                    </p>
                  ) : null}
                  {message.id === firstUnreadId ? (
                    <div className="flex items-center gap-3 px-4 pb-1 pt-3" role="separator">
                      <span className="h-px flex-1 bg-accent/50" />
                      <span className="text-[12px] text-accent">New messages</span>
                      <span className="h-px flex-1 bg-accent/50" />
                    </div>
                  ) : null}
                  <MessageItem
                    message={message}
                    toolCalls={toolCalls}
                    orgSlug={orgSlug}
                    canAdmin={canAdmin}
                    threadReplyCount={threadCounts[message.id] ?? 0}
                    onOpenThread={onOpenThread}
                    avatarUrl={message.senderId ? memberAvatars[message.senderId] : null}
                    selfId={user.id}
                    continued={
                      !showDay &&
                      previous?.senderId === message.senderId &&
                      previous?.senderName === message.senderName &&
                      previous?.senderType !== "system" &&
                      message.id !== firstUnreadId &&
                      new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 300_000
                    }
                    showRetry={index === mainMessages.length - 1 && canRetry(message)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showJump ? (
        <div className="pointer-events-none relative z-10 h-0">
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <button
              type="button"
              onClick={scrollToBottom}
              className="pointer-events-auto rounded-full border border-line-strong bg-raised px-3.5 py-2 text-[13px] text-text shadow-[0_8px_24px_rgba(0,0,0,0.45)] hover:bg-hover md:py-1.5"
            >
              {newCount > 0 ? `↓ ${newCount} new ${newCount === 1 ? "message" : "messages"}` : "↓ Latest"}
            </button>
          </div>
        </div>
      ) : null}

      {orphanCalls.length ? (
        <div className="mx-auto max-h-[40%] w-full max-w-[820px] space-y-2 overflow-y-auto px-4 py-3">
          <ToolCallsList calls={orphanCalls.slice(-6)} orgSlug={orgSlug} canApprove={canAdmin} />
        </div>
      ) : null}

      <TurnStrip
        turnState={turnState}
        agents={roomAgents}
        streamingRunId={streamingMessage?.runId ?? null}
        orgSlug={orgSlug}
        roomId={roomId}
        runActivity={runActivity}
      />

      <div className="mx-auto w-full max-w-[780px] shrink-0 pb-[env(safe-area-inset-bottom)] md:px-2">
        <Composer
          orgSlug={orgSlug}
          roomId={roomId}
          agents={roomAgents}
          people={people}
          selfId={user.id}
          canAdmin={canAdmin}
          roomKind={roomKind}
          placeholder={
            roomKind === "public" ? `Message #${roomName}` : `Message ${roomName}`
          }
          onTyping={onTyping}
          onSent={scrollToBottom}
          onShowCanvas={onShowCanvas}
        />
      </div>
      <p className="sr-only" aria-live="polite">
        {announced}
      </p>
      <p className="sr-only">
        You are {user.displayName}. Agents in this room:{" "}
        {roomAgents.map(({ agent }) => `@${agent.handle}`).join(", ") || "none"}.
      </p>
    </section>
  )
}
