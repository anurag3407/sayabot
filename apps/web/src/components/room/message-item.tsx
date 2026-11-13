"use client"

import { Avatar } from "@/components/ui/avatar"
import { CopyButton } from "@/components/copy-button"
import { Markdown } from "@/components/markdown"
import { InlineAlert } from "@/components/ui/empty"
import { ReplyIcon } from "@/components/ui/icons"
import { FailureActions, PokeBotButton } from "@/components/room/message-actions"
import { ToolCallsList } from "@/components/room/tool-call-card"
import { InspectTraceButton } from "@/components/trace/inspect-trace-button"
import { clockTime, cn, fullTime } from "@/lib/format"
import type { MessageView, ToolCallView } from "@/lib/types"

export function MessageItem({
  message,
  toolCalls,
  orgSlug,
  canAdmin,
  threadReplyCount,
  onOpenThread,
  inThread = false,
  avatarUrl = null,
  showRetry = false,
  selfId = null,
  continued = false,
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
  /** Same sender as the message above, so the name and face are not repeated. */
  continued?: boolean
}) {
  if (message.senderType === "system") {
    return (
      <div
        className={cn(
          "mx-4 my-2 rounded-xl bg-panel px-4 py-3",
          message.status === "halted" && "bg-accent-soft",
        )}
        role="status"
        data-testid="system-message"
        data-status={message.status}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[12px] text-muted">Sayabot</span>
          <span className="font-mono text-[11px] text-faint" title={fullTime(message.createdAt)}>
            {clockTime(message.createdAt)}
          </span>
          {message.status === "halted" ? (
            <span className="text-[12px] text-accent">Halted</span>
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
    )
  }

  const isAgent = message.senderType === "agent"
  const error = typeof message.metadata.error === "string" ? message.metadata.error : null
  const warnings = Array.isArray(message.metadata.warnings)
    ? (message.metadata.warnings as string[])
    : []
  const relatedCalls = toolCalls.filter(
    (call) =>
      call.messageId === message.id ||
      (message.runId !== null && call.runId === message.runId && call.messageId === null),
  )
  const streaming = message.status === "streaming"

  const mine = !isAgent && selfId !== null && message.senderId === selfId
  const quietTime = "text-[11px] text-faint md:opacity-0 md:transition-opacity md:group-hover:opacity-100"

  return (
    <article
      className={cn(
        "group relative grid gap-3 px-4",
        continued ? "pt-1" : "pt-4",
        mine ? "grid-cols-[minmax(0,1fr)]" : "grid-cols-[32px_minmax(0,1fr)]",
        inThread && "px-3",
      )}
      aria-label={`${message.senderName} ${isAgent ? "agent" : "human"} message`}
      data-testid="message"
      data-sender-type={message.senderType}
      data-sender-handle={message.senderHandle ?? message.senderName}
      data-status={message.status}
    >
      {mine ? null : (
        <div>
          {continued ? null : (
            <Avatar name={message.senderName} kind={message.senderType} size="md" src={avatarUrl} className="h-8 w-8" />
          )}
        </div>
      )}
      <div className={cn("min-w-0", mine && "flex flex-col items-end")}>
        <header
          className={cn(
            "flex flex-wrap items-baseline gap-x-2 gap-y-1",
            mine && "w-full justify-end",
            continued && "md:absolute md:right-4 md:top-0 md:z-[1]",
          )}
        >
          {mine || continued ? null : <span className="text-[13px] font-medium text-text">{message.senderName}</span>}
          {typeof message.metadata.dmToHandle === "string" ? (
            <span
              className="text-[12px] text-accent"
              title="A bot-to-bot direct message. Everyone in the room can read it."
            >
              to @{message.metadata.dmToHandle}
            </span>
          ) : null}
          {inThread ? <span className="text-[12px] text-faint">in thread</span> : null}
          <time dateTime={message.createdAt} title={fullTime(message.createdAt)} className={quietTime}>
            {clockTime(message.createdAt)}
          </time>
          {streaming ? (
            <span className="text-[12px] text-accent">Live</span>
          ) : message.status === "halted" ? (
            <span className="text-[12px] text-warn">Stopped</span>
          ) : message.status === "error" ? (
            <span className="text-[12px] text-danger">Error</span>
          ) : null}
          <span className={cn("flex items-center gap-3 transition-opacity md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100", !mine && "ml-auto")}>
            {isAgent ? (
              <InspectTraceButton
                orgSlug={orgSlug}
                runId={message.runId}
                messageId={message.id}
                agentName={message.senderName}
              />
            ) : null}
            <CopyButton text={message.content} />
            {!inThread && onOpenThread ? (
              <button
                type="button"
                onClick={() => onOpenThread(message)}
                className="inline-flex min-h-8 items-center gap-1 text-[12px] text-faint hover:text-text md:min-h-5"
              >
                <ReplyIcon width={12} height={12} /> Reply
              </button>
            ) : null}
          </span>
        </header>

        {message.content ? (
          <div
            className={cn(
              "mt-1 inline-block max-w-full rounded-[22px] px-4 py-2.5 text-[15px]",
              isAgent ? "rounded-tl-md bg-panel" : "bg-raised",
              mine && "ml-auto rounded-tl-[22px] rounded-tr-md",
            )}
          >
            <Markdown content={message.content} streaming={streaming} />
            {streaming ? <span className="streaming-caret" aria-hidden="true" /> : null}
          </div>
        ) : streaming ? (
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-[22px] rounded-tl-md bg-panel px-4 py-3 text-[14px] text-faint" aria-label="Thinking">
            <span className="thinking-dot" />
            <span className="thinking-dot [animation-delay:150ms]" />
            <span className="thinking-dot [animation-delay:300ms]" />
          </p>
        ) : null}

        {message.metadata.vote ? <VoteTally vote={message.metadata.vote as VoteMeta} /> : null}

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
            />
          </div>
        ) : null}
        {warnings.length ? (
          <details className="mt-2">
            <summary className="cursor-pointer font-mono text-[11px] text-warn">
              {warnings.length} tool {warnings.length === 1 ? "warning" : "warnings"}
            </summary>
            <ul className="mt-1 space-y-1 border-l border-line pl-3">
              {warnings.map((warning, index) => (
                <li key={index} className="font-mono text-[12px] leading-relaxed text-muted">
                  {warning}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <ToolCallsList
          calls={relatedCalls}
          orgSlug={orgSlug}
          canApprove={canAdmin}
          agentName={isAgent ? message.senderName : null}
        />

        {!inThread && onOpenThread && threadReplyCount !== undefined && threadReplyCount > 0 ? (
          <button
            type="button"
            onClick={() => onOpenThread(message)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-panel px-2.5 py-1 text-[12px] text-muted hover:text-text"
          >
            <ReplyIcon width={12} height={12} />
            {threadReplyCount} {threadReplyCount === 1 ? "reply" : "replies"}
          </button>
        ) : null}
      </div>
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
      <p className="font-mono text-[11px] text-faint">
        {total} {total === 1 ? "vote" : "votes"}
      </p>
      {counts.map(({ option, voters }) => {
        const pct = total ? Math.round((voters.length / total) * 100) : 0
        const leading = max > 0 && voters.length === max
        return (
          <div key={option}>
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className={leading ? "text-text" : "text-muted"}>{option}</span>
              <span className="font-mono text-[11px] text-faint">
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
          <summary className="cursor-pointer font-mono text-[11px] text-muted">reasons</summary>
          <ul className="mt-1 space-y-1 border-l border-line pl-3 text-[12px] text-muted">
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
