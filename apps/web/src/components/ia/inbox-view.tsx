"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useState, useTransition } from "react"
import { decideBotInviteAction } from "@/lib/actions/bot-invites"
import { ApprovalCard } from "@/components/room/tool-call-card"
import { AskCard, when } from "@/components/ia/ask-card"
import { FactsPanel } from "@/components/ia/facts-panel"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/ui/empty"
import { showToast } from "@/components/ui/toast"
import { useWorkspaceChange } from "@/lib/use-workspace-change"
import type {
  BotJoinRequestView,
  InboxApprovalView,
  InboxDoneView,
  InboxRequestView,
  OwnerFactView,
  TaskView,
} from "@/lib/types"

function JoinCard({
  request,
  orgSlug,
  canDecide,
  onDecided,
}: {
  request: BotJoinRequestView
  orgSlug: string
  canDecide: boolean
  onDecided: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function decide(approve: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await decideBotInviteAction({ orgSlug, inviteId: request.inviteId, approve })
      if (!result.ok) {
        setError(result.error ?? "Could not save your answer")
        return
      }
      showToast({ tone: approve ? "success" : "neutral", message: result.message ?? (approve ? "Approved" : "Declined") })
      onDecided()
    })
  }

  return (
    <li className="rounded-xl border border-accent/40 bg-panel p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Avatar name={request.name} kind="agent" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-text">
            {request.name} wants to join #{request.roomName}
          </p>
          <p className="text-[12px] text-faint">
            {request.appLabel ? `${request.appLabel} · ` : ""}
            {when(request.requestedAt)}
          </p>
          {request.about ? <p className="mt-2 text-[14px] text-muted">&ldquo;{request.about}&rdquo;</p> : null}
          {request.rejectedAttempts > 0 ? (
            <p className="mt-2 text-[12px] text-warn">
              Someone else also tried this link and was turned away. Only approve if you pasted it into this agent
              yourself.
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-faint">
              Once approved it can read and post in #{request.roomName} and take tasks there. Nothing else.
            </p>
          )}
          {error ? <p className="mt-2 text-[13px] text-danger">{error}</p> : null}
          {canDecide ? (
            <div className="mt-3 flex gap-2">
              <Button variant="primary" disabled={pending} onClick={() => decide(true)}>
                Approve
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => decide(false)}>
                Decline
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-faint">A room admin has to approve this.</p>
          )}
        </div>
      </div>
    </li>
  )
}

function SectionTitle({ id, title, count, hint }: { id: string; title: string; count?: number; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="flex items-center gap-2 text-[16px] font-medium text-text">
        {title}
        {count ? (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[12px] font-medium text-accent">{count}</span>
        ) : null}
      </h2>
      {hint ? <p className="mt-0.5 text-[13px] text-faint">{hint}</p> : null}
    </div>
  )
}

export function InboxView({
  orgSlug,
  approvals,
  requests,
  agedStuck = [],
  done,
  orgAdmin,
  adminRoomIds,
  viewerId,
  joinRequests = [],
  facts = [],
  rooms = [],
}: {
  orgSlug: string
  approvals: InboxApprovalView[]
  requests: InboxRequestView[]
  agedStuck?: TaskView[]
  done: InboxDoneView[]
  orgAdmin: boolean
  adminRoomIds: string[]
  /** The signed-in person; approvals from someone's Mac are only theirs to answer. */
  viewerId?: string | null
  joinRequests?: BotJoinRequestView[]
  facts?: OwnerFactView[]
  rooms?: { id: string; name: string }[]
}) {
  const router = useRouter()
  const refresh = useCallback(() => router.refresh(), [router])
  useWorkspaceChange(["tool_calls", "tasks"], refresh)
  const adminRooms = new Set(adminRoomIds)
  const canApproveAny = orgAdmin || adminRooms.size > 0
  const needsYou = joinRequests.length + requests.length + approvals.length

  // Newest activity first; one agent's questions sit together.
  const sortedRequests = [...requests].sort((a, b) => {
    const byAgent = (a.task.requestedByHandle ?? "").localeCompare(b.task.requestedByHandle ?? "")
    return byAgent || b.task.updatedAt.localeCompare(a.task.updatedAt)
  })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <header className="pb-6">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-text">Inbox</h1>
          <p className="mt-1 text-[14px] text-muted">
            {needsYou === 0
              ? "You're all caught up. Your agents will ask here when they need you."
              : `${needsYou} ${needsYou === 1 ? "thing needs" : "things need"} you. Everything else your agents handle on their own.`}
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-10">
            {joinRequests.length ? (
              <section aria-labelledby="join-heading">
                <SectionTitle id="join-heading" title="Agents asking to join" count={joinRequests.length} />
                <ul className="space-y-3">
                  {joinRequests.map((request) => (
                    <JoinCard
                      key={request.inviteId}
                      request={request}
                      orgSlug={orgSlug}
                      canDecide={orgAdmin || adminRooms.has(request.roomId)}
                      onDecided={refresh}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="questions-heading">
              <SectionTitle
                id="questions-heading"
                title="Questions for you"
                count={requests.length}
                hint="Answer once. Your agents remember it and won't ask again."
              />
              {requests.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line p-5 text-center text-[14px] text-faint">
                  No agent is waiting on you.
                </p>
              ) : (
                <ul className="space-y-3">
                  {sortedRequests.map((item) => (
                    <AskCard
                      key={item.task.id}
                      task={item.task}
                      agentName={item.task.requestedByHandle ?? "An agent"}
                      orgSlug={orgSlug}
                      onAnswered={refresh}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="approvals-heading">
              <SectionTitle
                id="approvals-heading"
                title="Waiting for your OK"
                count={approvals.length}
                hint="An agent wants to change something and is paused until someone allows it. It gives up after 5 minutes."
              />
              {approvals.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line p-5 text-center text-[14px] text-faint">
                  Nothing is paused.
                </p>
              ) : (
                <ul className="space-y-3">
                  {approvals.map((item) => (
                    <li key={item.toolCall.id}>
                      <p className="mb-1.5 text-[12px] text-faint">
                        {item.agentName ?? item.agentHandle ?? "An agent"} in {item.roomName} · {when(item.toolCall.createdAt)}
                      </p>
                      <ApprovalCard
                        call={item.toolCall}
                        orgSlug={orgSlug}
                        canApprove={orgAdmin || adminRooms.has(item.toolCall.roomId)}
                        agentName={item.agentName}
                        viewerId={viewerId}
                        onResolved={refresh}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {agedStuck.length > 0 ? (
              <section aria-labelledby="stuck-heading">
                <SectionTitle
                  id="stuck-heading"
                  title="Stuck for more than 3 days"
                  count={agedStuck.length}
                  hint="These need someone to unblock or reassign them."
                />
                <ul className="space-y-2">
                  {agedStuck.map((task) => (
                    <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/30 bg-panel p-4">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-text">{task.title}</p>
                        <p className="mt-0.5 text-[12px] text-faint">
                          {task.roomName}
                          {task.assigneeHandle ? ` · @${task.assigneeHandle}` : ""}
                          {task.unblockDetail ? ` · ${task.unblockDetail}` : ""}
                        </p>
                      </div>
                      <Link
                        href={`/${orgSlug}/r/${task.roomId}`}
                        className="inline-flex h-9 items-center rounded-sm border border-line px-3 text-[13px] text-muted hover:text-text"
                      >
                        Open chat
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <details className="group">
              <summary className="cursor-pointer list-none text-[14px] text-muted hover:text-text">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
                Done in the last 7 days ({done.length})
              </summary>
              {done.length === 0 ? (
                <p className="mt-3 text-[13px] text-faint">Nothing yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                  {done.map((item) => (
                    <li key={`${item.kind}-${item.id}`} className="flex items-baseline gap-2 px-4 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{item.label}</span>
                      <span className="shrink-0 text-[12px] text-faint">{when(item.resolvedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>

            {!canApproveAny ? (
              <InlineAlert tone="neutral">You can see everything here. A room or workspace admin decides.</InlineAlert>
            ) : null}
          </div>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <FactsPanel orgSlug={orgSlug} facts={facts} rooms={rooms} onChanged={refresh} />
          </aside>
        </div>
      </div>
    </div>
  )
}
