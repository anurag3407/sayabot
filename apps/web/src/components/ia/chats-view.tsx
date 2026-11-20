"use client"

import Link from "next/link"
import { ChatList, type BotLink } from "@/components/workspace/chat-list"
import { RARE_MASCOT } from "@/components/ui/mascot"
import { LiveMascot } from "@/components/ui/live-mascot"
import type { BotChatView, ChatListItem } from "@/lib/types"

function relativeTime(iso: string | null): string {
  if (!iso) return ""
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return "now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function Handoffs({ orgSlug, handoffs }: { orgSlug: string; handoffs: BotChatView[] }) {
  if (handoffs.length === 0) return null
  return (
    <section className="mt-12 w-full max-w-xl text-left" aria-labelledby="handoffs-heading">
      <h2 id="handoffs-heading" className="px-1 text-[13px] text-faint">
        Agents talking to each other
      </h2>
      <ul className="mt-2 space-y-1">
        {handoffs.map((handoff) => (
          <li key={handoff.roomId} className="rounded-xl bg-panel">
            <details>
              <summary className="flex cursor-pointer list-none items-baseline gap-2 px-4 py-3">
                <span className="truncate text-[14px]">{handoff.roomName}</span>
                <span className="ml-auto shrink-0 text-[12px] text-faint">
                  {handoff.messages.length} · {relativeTime(handoff.lastAt)}
                </span>
              </summary>
              <div className="space-y-3 border-t border-line px-4 py-3">
                {handoff.messages.slice(-6).map((message) => (
                  <div key={message.id} className="text-[13px] leading-relaxed">
                    <p className="text-[12px] text-faint">
                      <span className="text-text">@{message.senderHandle}</span>
                      {" → "}
                      {message.mentions.map((mention) => `@${mention}`).join(", ")}
                    </p>
                    <p className="mt-0.5 line-clamp-4 text-muted">{message.content}</p>
                  </div>
                ))}
                <Link
                  href={`/${orgSlug}/r/${handoff.roomId}`}
                  className="inline-block text-[13px] text-accent"
                >
                  Open room
                </Link>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ChatsView({
  orgSlug,
  items,
  bots,
  handoffs,
  inboxCount,
}: {
  orgSlug: string
  items: ChatListItem[]
  bots: BotLink[]
  handoffs: BotChatView[]
  inboxCount: number
}) {
  // Your first two bots flank the rare orchestrator; the cast fills in when you have fewer.
  const [left = "Pip", right = "Moss"] = [...bots.map((bot) => bot.displayName), "Pip", "Moss"]
  const faces = [left, RARE_MASCOT, right]
  return (
    <div className="h-full">
      <div className="h-full md:hidden">
        <ChatList orgSlug={orgSlug} items={items} bots={bots} />
      </div>
      <div className="hidden h-full overflow-y-auto md:block">
        <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center px-8 py-12 text-center">
          <div className="flex items-end gap-3" aria-hidden>
            {faces.map((name, index) => (
              <LiveMascot
                key={`${name}-${index}`}
                seed={name}
                live
                shadow
                delay={index * 0.4}
                className={index === 1 ? "h-20 w-20" : "h-14 w-14"}
              />
            ))}
          </div>
          <h1 className="mt-6 text-[22px] font-medium tracking-[-0.02em]">
            Pick up where you left off
          </h1>
          <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-muted">
            {inboxCount > 0
              ? `${inboxCount} ${inboxCount === 1 ? "item needs" : "items need"} your decision. Choose a chat to keep going.`
              : "Choose a chat on the left, or start something new."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link
              href={`/${orgSlug}/chats/new`}
              className="inline-flex h-9 items-center rounded-full bg-text px-4 text-[13px] font-medium text-void transition-colors hover:bg-white"
            >
              New chat
            </Link>
            {inboxCount > 0 ? (
              <Link
                href={`/${orgSlug}/inbox`}
                className="inline-flex h-9 items-center rounded-full border border-line-strong px-4 text-[13px] text-text transition-colors hover:bg-raised"
              >
                Open Inbox
              </Link>
            ) : null}
            <Link
              href={`/${orgSlug}/settings/bots`}
              className="inline-flex h-9 items-center rounded-full border border-line-strong px-4 text-[13px] text-text transition-colors hover:bg-raised"
            >
              Connect an agent over MCP
            </Link>
          </div>
          <Handoffs orgSlug={orgSlug} handoffs={handoffs} />
        </div>
      </div>
    </div>
  )
}
