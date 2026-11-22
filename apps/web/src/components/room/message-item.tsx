"use client"

import { useMemo } from "react"
import { CopyButton } from "@/components/copy-button"
import { Markdown } from "@/components/markdown"
import { splitThinking } from "@sayabot/core"
import { InlineAlert } from "@/components/ui/empty"
import { ReplyIcon } from "@/components/ui/icons"
import { FailureActions, PokeBotButton } from "@/components/room/message-actions"
import { ToolCallsList } from "@/components/room/tool-call-card"
import { ChangedFilesCard } from "@/components/room/changed-files-card"
import { InspectTraceButton } from "@/components/trace/inspect-trace-button"
import { SpeakButton, VoiceNoteBubble } from "@/components/voice"
import { clockTime, cn, fullTime } from "@/lib/format"
import { replySourceLabel } from "@/lib/runs-on"
import { extractChangedFiles } from "@/lib/chat-tool-presenter"
import type { MessageView, ToolCallView } from "@/lib/types"

export function MessageItem({
  message,
  toolCalls,
  orgSlug,
  canAdmin,
  threadReplyCount,
  onOpenThread,
  inThread = false,
  showRetry = false,
  selfId = null,
  continued = false,
  onShowCanvas,
}: {
  message: MessageView
  toolCalls: ToolCallView[]
  orgSlug: string
  canAdmin: boolean
  threadReplyCount?: number
  onOpenThread?: (message: MessageView) => void
  inThread?: boolean
  avatarUrl?: string | null
  showRetry?: boolean
  selfId?: string | null
  /** Same sender as the message above. */
  continued?: boolean
  onShowCanvas?: () => void
}) {
  const relatedCalls = useMemo(
    () =>
      toolCalls.filter(
        (call) =>
          call.messageId === message.id ||
          (message.runId !== null && call.runId === message.runId && call.messageId === null),
      ),
    [toolCalls, message.id, message.runId],
  )
  const changedFilesSummary = useMemo(() => extractChangedFiles(relatedCalls), [relatedCalls])

  if (message.senderType === "system") {
    const halted = message.status === "halted"
    return (
      <div
        className={cn(
          "mx-2 my-2 flex gap-3 rounded-xl border px-3 py-2.5",
          halted ? "border-warn/25 bg-warn/[0.06]" : "border-line/70 bg-panel/40",
        )}
        role="status"
        data-testid="system-message"
        data-status={message.status}
      >
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold",
            halted ? "bg-warn/15 text-warn" : "bg-raised text-faint",
          )}
        >
          {halted ? "!" : "i"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[11.5px] font-medium text-muted">Sayabot</span>
            <span className="font-mono text-[10.5px] text-faint" title={fullTime(message.createdAt)}>
              {clockTime(message.createdAt)}
            </span>
            {halted ? (
              <span className="rounded-full bg-warn/15 px-1.5 py-px text-[10.5px] font-medium text-warn">
                Halted
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-[13px] leading-relaxed text-muted">
            <Markdown content={message.content} />
          </div>
          {message.metadata.reason === "agent_quiet" &&
          typeof message.metadata.quietAgentHandle === "string" ? (
            <PokeBotButton
              orgSlug={orgSlug}
              roomId={message.roomId}
              handle={message.metadata.quietAgentHandle}
              threadRootId={message.threadRootId}
            />
          ) : null}
          {message.status === "halted" ? (
            <FailureActions
              orgSlug={orgSlug}
              roomId={message.roomId}
              messageId={message.id}
              runId={message.runId}
              text={message.content}
              reason={typeof message.metadata.reason === "string" ? message.metadata.reason : null}
              canAdmin={canAdmin}
              showRetry={showRetry}
            />
          ) : null}
        </div>
      </div>
    )
  }

  const isAgent = message.senderType === "agent"
  const error = typeof message.metadata.error === "string" ? message.metadata.error : null
  const warnings = Array.isArray(message.metadata.warnings)
    ? (message.metadata.warnings as string[])
    : []
  const streaming = message.status === "streaming"

  const mine = !isAgent && selfId !== null && message.senderId === selfId
  const folded = isAgent ? splitThinking(message.content) : null
  const answer = folded ? folded.answer : message.content
  const thinking = folded?.thinking ?? null
  const thinkingStreaming = Boolean(streaming && folded?.open)

  return (
    <article
      className={cn(
        "group relative w-full px-2 md:px-4",
        continued ? "pt-1.5" : "pt-4",
        inThread && "px-2",
      )}
      aria-label={`${message.senderName} ${isAgent ? "agent" : "human"} message`}
      data-testid="message"
      data-sender-type={message.senderType}
      data-sender-handle={message.senderHandle ?? message.senderName}
      data-status={message.status}
    >
      {/* Human user message: right-aligned sleek bubble */}
      {mine ? (
        <div className="flex w-full flex-col items-end">
          <div className="max-w-[85%] rounded-2xl bg-zinc-200 text-zinc-900 dark:bg-[#1e1e24] dark:text-[#ededf0] px-4 py-2.5 text-sm border border-zinc-300/70 dark:border-white/5 shadow-sm [overflow-wrap:anywhere]">
            {!isAgent &&
            (message.metadata.command === "goal" || message.metadata.command === "btw") ? (
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-accent">
                {message.metadata.command === "goal" ? "Goal" : "Side note"}
              </span>
            ) : null}
            <Markdown content={answer} streaming={streaming} />
            {streaming ? <span className="streaming-caret" aria-hidden="true" /> : null}
            <div className="mt-1 flex justify-end text-right font-mono text-[10px] text-faint opacity-60">
              <time dateTime={message.createdAt} title={fullTime(message.createdAt)}>
                {clockTime(message.createdAt)}
              </time>
            </div>
          </div>
          {/* Subtle actions & thread reply for self message */}
          <div className="mt-1 flex items-center gap-2 text-2xs text-faint">
            <CopyButton text={answer || message.content} />
            {!inThread && onOpenThread ? (
              <button
                type="button"
                onClick={() => onOpenThread(message)}
                className="inline-flex items-center gap-1 hover:text-text"
              >
                <ReplyIcon width={12} height={12} /> Reply
              </button>
            ) : null}
          </div>
          {!inThread && onOpenThread && threadReplyCount !== undefined && threadReplyCount > 0 ? (
            <button
              type="button"
              onClick={() => onOpenThread(message)}
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-panel px-2.5 py-1 text-xs text-muted hover:text-text"
            >
              <ReplyIcon width={12} height={12} />
              {threadReplyCount} {threadReplyCount === 1 ? "reply" : "replies"}
            </button>
          ) : null}
        </div>
      ) : !isAgent ? (
        /* Non-self human message */
        <div className="flex w-full flex-col items-start">
          <div className="max-w-[85%] rounded-2xl bg-panel px-4 py-2.5 text-sm text-text border border-line [overflow-wrap:anywhere]">
            <div className="mb-1 flex items-baseline gap-2 text-xs">
              <span className="font-semibold text-text">{message.senderName}</span>
              <time
                dateTime={message.createdAt}
                title={fullTime(message.createdAt)}
                className="font-mono text-[10px] text-faint"
              >
                {clockTime(message.createdAt)}
              </time>
            </div>
            <Markdown content={answer} streaming={streaming} />
          </div>
          {/* Subtle actions & thread reply for other human message */}
          <div className="mt-1 flex items-center gap-2 text-2xs text-faint">
            <CopyButton text={answer || message.content} />
            {!inThread && onOpenThread ? (
              <button
                type="button"
                onClick={() => onOpenThread(message)}
                className="inline-flex items-center gap-1 hover:text-text"
              >
                <ReplyIcon width={12} height={12} /> Reply
              </button>
            ) : null}
          </div>
          {!inThread && onOpenThread && threadReplyCount !== undefined && threadReplyCount > 0 ? (
            <button
              type="button"
              onClick={() => onOpenThread(message)}
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-panel px-2.5 py-1 text-xs text-muted hover:text-text"
            >
              <ReplyIcon width={12} height={12} />
              {threadReplyCount} {threadReplyCount === 1 ? "reply" : "replies"}
            </button>
          ) : null}
        </div>
      ) : (
        /* Agent message: sleek, modern presentation with action bar, thinking disclosure & clean markdown */
        <div className="min-w-0 max-w-full space-y-1">
          {/* Agent Header (Avatar + Name + Timestamp) shown when sender changes or block starts */}
          {!continued ? (
            <div className="flex items-center gap-2 mb-1.5 text-xs">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent text-2xs font-semibold">
                {message.senderName ? message.senderName.charAt(0).toUpperCase() : "A"}
              </div>
              <span className="font-semibold text-text">{message.senderName}</span>
              <time
                dateTime={message.createdAt}
                title={fullTime(message.createdAt)}
                className="font-mono text-[10px] text-faint"
              >
                {clockTime(message.createdAt)}
              </time>
            </div>
          ) : null}

          {/* Collapsible Action Bar (Working/Worked + Tools + Reasoning) */}
          <ToolCallsList
            calls={relatedCalls}
            orgSlug={orgSlug}
            canApprove={canAdmin}
            agentName={isAgent ? message.senderName : null}
            viewerId={selfId}
            thinking={thinking}
            thinkingStreaming={thinkingStreaming}
            timestamp={message.createdAt}
          />

          {/* Assistant Generated Answer */}
          {answer ? (
            <div className="min-w-0 max-w-full text-[14px] leading-relaxed text-[#ededf0] [overflow-wrap:anywhere] py-1">
              <Markdown content={answer} streaming={streaming} />
              {streaming ? <span className="streaming-caret" aria-hidden="true" /> : null}
            </div>
          ) : streaming && !thinking && !thinkingStreaming && !relatedCalls.length ? (
            <p
              className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-xs text-faint"
              aria-label="Thinking"
            >
              <span className="thinking-dot" />
              <span className="thinking-dot [animation-delay:150ms]" />
              <span className="thinking-dot [animation-delay:300ms]" />
            </p>
          ) : null}

          {/* Changed Files Footer (like in code workspace turns) */}
          {changedFilesSummary.totalFiles > 0 ? (
            <ChangedFilesCard
              summary={changedFilesSummary}
              onOpenDiff={onShowCanvas ? () => onShowCanvas() : undefined}
            />
          ) : null}

          {/* Voice note bubble */}
          {message.metadata.voiceNote && typeof message.metadata.voiceNote === "object" ? (
            <VoiceNoteBubble
              audioUrl={String(
                (message.metadata.voiceNote as Record<string, unknown>).audioUrl || "",
              )}
              durationMs={
                typeof (message.metadata.voiceNote as Record<string, unknown>).durationMs === "number"
                  ? ((message.metadata.voiceNote as Record<string, unknown>).durationMs as number)
                  : undefined
              }
              text={
                typeof (message.metadata.voiceNote as Record<string, unknown>).text === "string"
                  ? ((message.metadata.voiceNote as Record<string, unknown>).text as string)
                  : undefined
              }
              provider={
                typeof (message.metadata.voiceNote as Record<string, unknown>).provider === "string"
                  ? ((message.metadata.voiceNote as Record<string, unknown>).provider as string)
                  : undefined
              }
              voice={
                typeof (message.metadata.voiceNote as Record<string, unknown>).voice === "string"
                  ? ((message.metadata.voiceNote as Record<string, unknown>).voice as string)
                  : undefined
              }
            />
          ) : null}

          {/* Vote tally */}
          {message.metadata.vote ? <VoteTally vote={message.metadata.vote as VoteMeta} /> : null}

          {/* Error & Warnings */}
          {error ? (
            <div className="mt-2">
              <InlineAlert tone="danger">{error}</InlineAlert>
              <FailureActions
                orgSlug={orgSlug}
                roomId={message.roomId}
                messageId={message.id}
                runId={message.runId}
                text={error}
                reason={null}
                canAdmin={canAdmin}
                showRetry={showRetry}
                kind={
                  typeof message.metadata.errorKind === "string" ? message.metadata.errorKind : null
                }
              />
            </div>
          ) : null}

          {warnings.length ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-mono text-2xs text-warn">
                {warnings.length} tool {warnings.length === 1 ? "warning" : "warnings"}
              </summary>
              <ul className="mt-1 space-y-1 border-l border-line pl-3">
                {warnings.map((warning, index) => (
                  <li key={index} className="font-mono text-2xs leading-relaxed text-muted">
                    {warning}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {/* Subtle Bottom Action Strip */}
          <div className="flex flex-wrap items-center gap-3 pt-1 text-2xs text-faint transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
            {replySourceLabel(message.metadata) ? (
              <span className="font-mono text-faint/80">{replySourceLabel(message.metadata)}</span>
            ) : null}

            <div className="ml-auto flex items-center gap-2">
              <InspectTraceButton
                orgSlug={orgSlug}
                runId={message.runId}
                messageId={message.id}
                agentName={message.senderName}
              />
              {!streaming && (answer || message.content) ? (
                <SpeakButton messageId={message.id} text={answer || message.content} />
              ) : null}
              <CopyButton text={answer || folded?.thinking || message.content} />
              {!inThread && onOpenThread ? (
                <button
                  type="button"
                  onClick={() => onOpenThread(message)}
                  className="inline-flex items-center gap-1 text-faint hover:text-text"
                >
                  <ReplyIcon width={12} height={12} /> Reply
                </button>
              ) : null}
              <time dateTime={message.createdAt} title={fullTime(message.createdAt)} className="font-mono">
                {clockTime(message.createdAt)}
              </time>
            </div>
          </div>

          {!inThread && onOpenThread && threadReplyCount !== undefined && threadReplyCount > 0 ? (
            <button
              type="button"
              onClick={() => onOpenThread(message)}
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-panel px-2.5 py-1 text-xs text-muted hover:text-text"
            >
              <ReplyIcon width={12} height={12} />
              {threadReplyCount} {threadReplyCount === 1 ? "reply" : "replies"}
            </button>
          ) : null}
        </div>
      )}
    </article>
  )
}

interface VoteMeta {
  question: string
  options: string[]
  ballots: Record<string, { option: string; reason: string; handle: string }>
}

/** Live tally for a vote an agent started. Ballots arrive as agents call cast_vote. */
function VoteTally({ vote }: { vote: VoteMeta }) {
  if (!Array.isArray(vote.options)) return null
  const ballots = Object.values(vote.ballots ?? {})
  const total = ballots.length
  const counts = vote.options.map((option) => ({
    option,
    voters: ballots.filter((b) => b.option === option),
  }))
  const max = Math.max(0, ...counts.map((c) => c.voters.length))
  return (
    <div className="mt-2 space-y-1.5 rounded-xl bg-panel p-3" aria-label="Vote results">
      <p className="font-mono text-2xs text-faint">
        {total} {total === 1 ? "vote" : "votes"}
      </p>
      {counts.map(({ option, voters }) => {
        const pct = total ? Math.round((voters.length / total) * 100) : 0
        const leading = max > 0 && voters.length === max
        return (
          <div key={option}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className={leading ? "text-text" : "text-muted"}>{option}</span>
              <span className="font-mono text-2xs text-faint">
                {voters.length} · {voters.map((v) => `@${v.handle}`).join(" ")}
              </span>
            </div>
            <div className="mt-0.5 h-1 bg-raised">
              <div
                className={leading ? "h-1 bg-accent" : "h-1 bg-line-strong"}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
      {ballots.some((b) => b.reason) ? (
        <details>
          <summary className="cursor-pointer font-mono text-2xs text-muted">reasons</summary>
          <ul className="mt-1 space-y-1 border-l border-line pl-3 text-xs text-muted">
            {ballots
              .filter((b) => b.reason)
              .map((b) => (
                <li key={b.handle}>
                  @{b.handle} → {b.option}: {b.reason}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
