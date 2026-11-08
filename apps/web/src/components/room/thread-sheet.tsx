"use client"

import { useEffect, useRef, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { Composer } from "@/components/room/composer"
import { MessageItem } from "@/components/room/message-item"
import { TurnStrip } from "@/components/room/turn-strip"
import { Button } from "@/components/ui/button"
import { CloseIcon } from "@/components/ui/icons"
import { InlineAlert } from "@/components/ui/empty"
import { truncate } from "@/lib/format"
import type { RawMessageRow } from "@/lib/message-map"
import type { MemberView, MessageView, RoomAgentView, ToolCallView } from "@/lib/types"

export function ThreadSheet({
  root,
  messages,
  toolCalls,
  orgSlug,
  roomId,
  roomName,
  roomAgents,
  people,
  selfId,
  canAdmin,
  memberAvatars,
  mergeHistory,
  onTyping,
  onClose,
}: {
  root: MessageView | null
  messages: MessageView[]
  toolCalls: ToolCallView[]
  orgSlug: string
  roomId: string
  roomName: string
  roomAgents: RoomAgentView[]
  people: MemberView[]
  selfId: string
  canAdmin: boolean
  memberAvatars: Record<string, string>
  mergeHistory: (rows: RawMessageRow[]) => void
  onTyping: () => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!root) {
      if (dialog?.open) dialog.close()
      return
    }
    if (!dialog?.open) dialog?.showModal()
    if (loaded === root.id) return
    setLoaded(root.id)
    setLoading(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()
    void supabase
      .from("messages")
      .select("*")
      .or(`id.eq.${root.id},thread_root_id.eq.${root.id}`)
      .order("created_at", { ascending: true })
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError(fetchError.message)
        else mergeHistory((data ?? []) as RawMessageRow[])
        setLoading(false)
      })
  }, [root, loaded, mergeHistory])

  const threadMessages = root
    ? messages.filter(
        (message) => message.id === root.id || message.threadRootId === root.id,
      )
    : []

  useEffect(() => {
    if (!root) return
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [root, threadMessages.length])

  if (!root) return null

  const streaming = [...threadMessages]
    .reverse()
    .find(
      (message) =>
        message.status === "streaming" &&
        message.senderType === "agent" &&
        message.threadRootId === root.id,
    )

  return (
    <dialog
      ref={dialogRef}
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-[560px] bg-ink p-0 pt-[env(safe-area-inset-top)] text-text backdrop:bg-void/70"
      onClose={() => {
        setLoaded(null)
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
      aria-label="Thread"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] text-faint">
              thread · {truncate(root.content || "no text", 80)}
            </p>
            <p className="mt-1 text-[13px] text-text">{root.senderName}</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close thread">
            <CloseIcon width={15} height={15} />
          </Button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" role="log">
          {loading ? (
            <p className="px-4 py-4 font-mono text-[12px] text-faint">loading thread…</p>
          ) : null}
          {error ? (
            <div className="px-4 py-3">
              <InlineAlert tone="danger">{error}</InlineAlert>
            </div>
          ) : null}
          {threadMessages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              toolCalls={toolCalls}
              orgSlug={orgSlug}
              canAdmin={canAdmin}
              inThread
              selfId={selfId}
              avatarUrl={message.senderId ? memberAvatars[message.senderId] : null}
            />
          ))}
          {!loading && !error && threadMessages.length <= 1 ? (
            <p className="px-4 py-6 text-[13px] leading-relaxed text-muted">
              No replies yet. Replies here stay out of the main chat. Mention an agent to ask it to
              reply in this thread.
            </p>
          ) : null}
        </div>

        <TurnStrip
          turnState={null}
          agents={roomAgents}
          streamingRunId={streaming?.runId ?? null}
          orgSlug={orgSlug}
          roomId={roomId}
        />

        <div className="shrink-0 border-t border-line pb-[env(safe-area-inset-bottom)]">
          <Composer
            orgSlug={orgSlug}
            roomId={roomId}
            threadRootId={root.id}
            agents={roomAgents}
            people={people}
            selfId={selfId}
            placeholder={`Reply in thread in ${roomName}`}
            compact
            autoFocus
            onTyping={onTyping}
          />
        </div>
      </div>
    </dialog>
  )
}
