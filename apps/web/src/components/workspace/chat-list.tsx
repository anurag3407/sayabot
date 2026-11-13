"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { Search } from "lucide-react"
import { PlusIcon } from "@/components/ui/icons"
import { openBotDmAction, setChatPreferenceAction } from "@/lib/actions/room-state"
import { showToast } from "@/components/ui/toast"
import { Mascot } from "@/components/ui/mascot"
import { cn } from "@/lib/format"
import type { ChatListItem } from "@/lib/types"

export interface BotLink {
  id: string
  handle: string
  displayName: string
  kind: "llm" | "external"
}

type Filter = "all" | "unread" | "mentions" | "bots" | "archived"
type RowAction = "pin" | "unpin" | "mute" | "unmute" | "archive" | "unarchive" | "mark_unread"

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "mentions", label: "Mentions" },
  { key: "bots", label: "Agents" },
  { key: "archived", label: "Archived" },
]

function isMuted(item: ChatListItem): boolean {
  return Boolean(item.mutedUntil && new Date(item.mutedUntil).getTime() > Date.now())
}

function shortDate(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

function RowFace({ item }: { item: ChatListItem }) {
  if (item.isBotDm) {
    return <Mascot seed={item.agentNames[0] ?? item.name} className="h-12 w-12 shrink-0" />
  }
  return (
    <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-raised text-[16px] font-medium text-muted">
      {item.kind === "public" ? "#" : item.name.slice(0, 1).toUpperCase()}
      {item.agentNames[0] ? (
        <Mascot seed={item.agentNames[0]} className="absolute -bottom-1 -right-1 h-[22px] w-[22px]" />
      ) : null}
    </span>
  )
}

const menuItem =
  "block w-full px-3 py-2.5 text-left text-[13px] text-muted hover:bg-raised hover:text-text disabled:opacity-50 md:py-1.5"

function ChatRow({
  item,
  orgSlug,
  active,
  pending,
  onNavigate,
  onAction,
}: {
  item: ChatListItem
  orgSlug: string
  active: boolean
  pending: boolean
  onNavigate?: () => void
  onAction: (action: RowAction, duration?: "8h" | "1w" | "always") => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const muted = isMuted(item)
  const unread = item.unreadCount > 0

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setMenuOpen(false)
      menuButton.current?.focus()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [menuOpen])

  function run(action: RowAction, duration?: "8h" | "1w" | "always") {
    onAction(action, duration)
    setMenuOpen(false)
  }

  return (
    <li className="group relative">
      <Link
        href={`/${orgSlug}/r/${item.id}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        data-testid="room-link"
        data-room-name={item.name}
        className={cn(
          "flex items-center gap-3 rounded-2xl px-2.5 py-2.5 transition-colors",
          active ? "bg-raised/80" : "hover:bg-panel",
        )}
      >
        <RowFace item={item} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("truncate text-[15px]", unread ? "font-semibold text-text" : "font-medium text-text")}>
              {item.name}
            </span>
            {!item.isBotDm && item.agentNames[0] ? (
              <span className="max-w-[64px] shrink-0 truncate rounded-md bg-raised px-1.5 py-px text-[11px] text-muted">
                {item.agentNames[0]}
              </span>
            ) : null}
            <span className="ml-auto shrink-0 text-[12px] text-faint md:group-hover:opacity-0 md:group-focus-within:opacity-0">
              {shortDate(item.lastAt)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className={cn("min-w-0 truncate text-[13px]", unread ? "text-muted" : "text-faint")}>
              {item.lastMessage ?? (item.isBotDm ? "Say hello" : "No messages yet")}
            </span>
            {item.mentionCount > 0 ? (
              <span className="ml-auto grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-accent px-1 text-[11px] font-medium text-void">
                {item.mentionCount}
              </span>
            ) : unread && !muted ? (
              <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={`${item.unreadCount} unread`} />
            ) : muted ? (
              <span className="ml-auto shrink-0 text-[11px] text-faint">muted</span>
            ) : null}
          </span>
        </span>
      </Link>

      <button
        ref={menuButton}
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-label={`Options for ${item.name}`}
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-[13px] text-faint opacity-100 hover:bg-hover hover:text-text focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 aria-expanded:opacity-100"
      >
        ···
      </button>

      {menuOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-2 top-10 z-20 w-44 overflow-hidden rounded-xl border border-line-strong bg-panel py-1 shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
            <button type="button" disabled={pending} onClick={() => run(item.pinned ? "unpin" : "pin")} className={menuItem}>
              {item.pinned ? "Unpin" : "Pin"}
            </button>
            <button type="button" disabled={pending} onClick={() => run("mark_unread")} className={menuItem}>
              Mark unread
            </button>
            {muted ? (
              <button type="button" disabled={pending} onClick={() => run("unmute")} className={menuItem}>
                Unmute
              </button>
            ) : (
              <>
                <p className="px-3 pb-0.5 pt-1.5 text-[11px] text-faint">Mute for</p>
                {(["8h", "1w", "always"] as const).map((duration) => (
                  <button key={duration} type="button" disabled={pending} onClick={() => run("mute", duration)} className={menuItem}>
                    {duration === "8h" ? "8 hours" : duration === "1w" ? "1 week" : "Until I unmute"}
                  </button>
                ))}
              </>
            )}
            <div className="my-1 h-px bg-line" />
            <button type="button" disabled={pending} onClick={() => run(item.archived ? "unarchive" : "archive")} className={menuItem}>
              {item.archived ? "Unarchive" : "Archive"}
            </button>
          </div>
        </>
      ) : null}
    </li>
  )
}

function BotRow({ bot, orgSlug, onNavigate }: { bot: BotLink; orgSlug: string; onNavigate?: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function start() {
    setError(null)
    startTransition(async () => {
      const result = await openBotDmAction(orgSlug, bot.id)
      if (!result.ok) {
        setError(result.error ?? "Could not open the bot chat")
        return
      }
      const path = typeof result.data?.path === "string" ? result.data.path : null
      if (path) {
        onNavigate?.()
        router.push(path)
        router.refresh()
      }
    })
  }

  return (
    <li>
      <button
        type="button"
        onClick={start}
        disabled={pending}
        title={`Start a direct chat with ${bot.displayName}`}
        className="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors hover:bg-panel disabled:opacity-60"
      >
        <Mascot seed={bot.displayName} className="h-12 w-12 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium text-text">{bot.displayName}</span>
            {bot.kind === "external" ? (
              <span className="shrink-0 rounded-md bg-raised px-1.5 py-px text-[11px] text-muted">MCP</span>
            ) : null}
          </span>
          <span className={cn("mt-0.5 block truncate text-[13px]", error ? "text-danger" : "text-faint")}>
            {pending ? "Saying hi…" : error ?? "Tap to say hi"}
          </span>
        </span>
      </button>
    </li>
  )
}

function Group({ label, children, action }: { label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex h-7 items-center justify-between px-2">
        <p className="text-[12px] font-medium text-faint">{label}</p>
        {action}
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  )
}

/** The one list of conversations: agents and rooms, with filters and per-chat actions. */
export function ChatList({
  orgSlug,
  items,
  bots,
  onNavigate,
  searchOpen,
  onSearchOpenChange,
  newChatHref,
}: {
  orgSlug: string
  items: ChatListItem[]
  bots: BotLink[]
  onNavigate?: () => void
  /**
   * The roomy desktop column: search always showing with a new-chat button beside it, one flat
   * list, and filters only while you are searching.
   */
  newChatHref?: string
  /** When given, search and filters stay tucked away until the caller opens them. */
  searchOpen?: boolean
  onSearchOpenChange?: (open: boolean) => void
}) {
  const pathname = usePathname()
  const showSearch = searchOpen ?? true
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const [pending, startTransition] = useTransition()
  const searchInput = useRef<HTMLInputElement>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const flat = Boolean(newChatHref)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return
      if (onSearchOpenChange && !searchOpen) {
        event.preventDefault()
        onSearchOpenChange(true)
        return
      }
      if (!searchInput.current?.offsetParent) return
      event.preventDefault()
      searchInput.current.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onSearchOpenChange, searchOpen])

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus()
    else if (searchOpen === false) {
      setQuery("")
      setFilter("all")
    }
  }, [searchOpen])

  const counts: Record<Filter, number> = {
    all: items.filter((item) => !item.archived).length,
    unread: items.filter((item) => !item.archived && item.unreadCount > 0).length,
    mentions: items.filter((item) => !item.archived && item.mentionCount > 0).length,
    bots: items.filter((item) => !item.archived && item.isBotDm).length,
    archived: items.filter((item) => item.archived).length,
  }

  const needle = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      items.filter((item) => {
        if (filter === "archived" ? !item.archived : item.archived) return false
        if (filter === "unread" && item.unreadCount === 0) return false
        if (filter === "mentions" && item.mentionCount === 0) return false
        if (filter === "bots" && !item.isBotDm) return false
        if (!needle) return true
        return (
          item.name.toLowerCase().includes(needle) ||
          (item.lastMessage ?? "").toLowerCase().includes(needle) ||
          item.agentNames.some((name) => name.toLowerCase().includes(needle))
        )
      }),
    [items, filter, needle],
  )

  const pinned = filtered.filter((item) => item.pinned)
  const agents = filtered.filter((item) => item.isBotDm && !item.pinned)
  const rooms = filtered.filter((item) => !item.isBotDm && !item.pinned)

  const dmAgentIds = new Set(items.filter((item) => item.isBotDm && item.agentId).map((item) => item.agentId))
  const newBots =
    filter === "all" || filter === "bots"
      ? bots.filter(
          (bot) =>
            !dmAgentIds.has(bot.id) && (!needle || bot.displayName.toLowerCase().includes(needle)),
        )
      : []

  function act(roomId: string, action: RowAction, duration?: "8h" | "1w" | "always") {
    startTransition(async () => {
      const result = await setChatPreferenceAction({ orgSlug, roomId, action, duration })
      if (!result.ok) {
        showToast({ message: result.error ?? "Could not update the chat", tone: "danger" })
        return
      }
      router.refresh()
      if (action === "archive") {
        showToast({ message: "Chat archived", action: { label: "Undo", onClick: () => act(roomId, "unarchive") } })
      }
    })
  }

  const row = (item: ChatListItem) => (
    <ChatRow
      key={item.id}
      item={item}
      orgSlug={orgSlug}
      active={pathname.startsWith(`/${orgSlug}/r/${item.id}`)}
      pending={pending}
      onNavigate={onNavigate}
      onAction={(action, duration) => act(item.id, action, duration)}
    />
  )

  const visibleFilters =
    flat && !searchFocused && !needle && filter === "all"
      ? []
      : FILTERS.filter(
          (option) => option.key === "all" || option.key === filter || counts[option.key] > 0,
        )
  const empty = !pinned.length && !agents.length && !rooms.length && !newBots.length

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showSearch ? (
      <div
        className="shrink-0 px-3 pb-2 pt-1"
        onFocus={() => setSearchFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSearchFocused(false)
        }}
      >
        <div className="flex items-center gap-1.5">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl bg-panel px-3 focus-within:bg-raised">
          <Search className="h-4 w-4 shrink-0 text-faint" aria-hidden />
          <span className="sr-only">Filter chats. Press Enter to search every message.</span>
          <input
            ref={searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && onSearchOpenChange) {
                onSearchOpenChange(false)
                return
              }
              if (event.key === "Enter" && needle) {
                onNavigate?.()
                router.push(`/${orgSlug}/search?q=${encodeURIComponent(query.trim())}`)
              }
            }}
            placeholder={flat ? "Search" : "Find a chat"}
            className="w-full bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
          />
        </label>
        {newChatHref ? (
          <Link
            href={newChatHref}
            onClick={onNavigate}
            aria-label="New chat"
            title="New chat"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-panel hover:text-text"
          >
            <PlusIcon width={19} height={19} />
          </Link>
        ) : null}
        </div>
        {visibleFilters.length > 1 ? (
          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Filter chats">
            {visibleFilters.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                aria-pressed={filter === option.key}
                className={cn(
                  "h-7 rounded-full px-3 text-[12px] transition-colors",
                  filter === option.key ? "bg-raised text-text" : "text-faint hover:text-text",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {flat && !empty ? (
          <ul className="space-y-0.5">
            {pinned.map(row)}
            {filtered.filter((item) => !item.pinned).map(row)}
            {newBots.map((bot) => (
              <BotRow key={bot.id} bot={bot} orgSlug={orgSlug} onNavigate={onNavigate} />
            ))}
          </ul>
        ) : null}
        {!flat && pinned.length ? <Group label="Pinned">{pinned.map(row)}</Group> : null}
        {!flat && (agents.length || newBots.length) ? (
          <Group
            label="Your agents"
            action={
              <Link href={`/${orgSlug}/agents`} onClick={onNavigate} className="text-[12px] text-faint hover:text-text">
                See all
              </Link>
            }
          >
            {agents.map(row)}
            {newBots.map((bot) => (
              <BotRow key={bot.id} bot={bot} orgSlug={orgSlug} onNavigate={onNavigate} />
            ))}
          </Group>
        ) : null}
        {!flat && rooms.length ? <Group label="Group chats">{rooms.map(row)}</Group> : null}

        {empty ? (
          <div className="px-3 py-8 text-center">
            <p className="text-[13px] leading-relaxed text-faint">
              {needle ? "No chats match. Press Enter to search every message." : "Nothing here yet."}
            </p>
            {!needle ? (
              <Link
                href={`/${orgSlug}/chats/new`}
                onClick={onNavigate}
                className="mt-2 inline-block text-[13px] text-accent"
              >
                Start a chat
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
