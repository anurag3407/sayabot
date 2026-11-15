"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react"
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  BarChart3,
  BellOff,
  BellRing,
  Bot,
  CheckSquare,
  ChevronDown,
  CircleHelp,
  Ellipsis,
  FolderClosed,
  Inbox,
  Link2,
  MailOpen,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Settings2,
  SlidersHorizontal,
  Store,
  Users,
  Zap,
} from "lucide-react"
import { useAppUpdate } from "@/components/update-notification"
import { signOutAction } from "@/lib/actions/auth"
import { openBotDmAction, setChatPreferenceAction } from "@/lib/actions/room-state"
import { Avatar } from "@/components/ui/avatar"
import { DetailsMenu } from "@/components/ui/details-menu"
import { Mascot } from "@/components/ui/mascot"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import type { ChatListItem, OrgRole, OrgSummary } from "@/lib/types"

export interface BotLink {
  id: string
  handle: string
  displayName: string
  kind: "llm" | "external"
}

type RowAction = "pin" | "unpin" | "mute" | "unmute" | "archive" | "unarchive" | "mark_unread"

interface SidebarUser {
  displayName: string
  avatarUrl: string | null
  email: string | null
  isGuest?: boolean
}

const popover =
  "surface-pop pop-in absolute z-50 overflow-hidden rounded-2xl p-1.5"

const popoverItem =
  "flex w-full items-center gap-2.5 truncate rounded-xl px-2.5 py-2 text-left text-[13.5px] text-muted transition-colors hover:bg-raised hover:text-text disabled:opacity-50"

/** The everyday extras, tucked under "Tools" so the top of the sidebar stays about your bots. */
const TOOLS: { key: string; href: string; label: string; icon: typeof Zap }[] = [
  { key: "cron", href: "/cron", label: "Routines", icon: Zap },
  { key: "tasks", href: "/tasks", label: "To-dos", icon: CheckSquare },
  { key: "files", href: "/files", label: "Files", icon: FolderClosed },
  { key: "agents", href: "/agents", label: "Team", icon: Users },
  { key: "marketplace", href: "/marketplace", label: "Bot store", icon: Store },
]

function isMuted(item: ChatListItem): boolean {
  return Boolean(item.mutedUntil && new Date(item.mutedUntil).getTime() > Date.now())
}

function shortTime(iso: string | null): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
}

/** A section heading that folds, remembered on this device. */
function useFolded(key: string): [boolean, () => void] {
  const storageKey = `sayabot:sidebar:${key}`
  const [folded, setFolded] = useState(false)
  useEffect(() => {
    try {
      setFolded(window.localStorage.getItem(storageKey) === "1")
    } catch {
      // Stays open.
    }
  }, [storageKey])
  const toggle = useCallback(() => {
    setFolded((previous) => {
      const next = !previous
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0")
      } catch {
        // Lasts for this visit.
      }
      return next
    })
  }, [storageKey])
  return [folded, toggle]
}

function Section({
  id,
  label,
  action,
  children,
}: {
  id: string
  label: string
  action?: ReactNode
  children: ReactNode
}) {
  const [folded, toggle] = useFolded(id)
  return (
    <section className="mt-3">
      <div className="group/section flex h-7 items-center gap-1 px-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!folded}
          className="flex items-center gap-1 rounded-md text-[12.5px] font-medium text-faint transition-colors hover:text-text"
        >
          {label}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", folded && "-rotate-90")} />
        </button>
        <span className="ml-auto opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100">
          {action}
        </span>
      </div>
      {folded ? null : children}
    </section>
  )
}

function RowFace({ item }: { item: ChatListItem }) {
  if (item.isBotDm) {
    return <Mascot seed={item.agentNames[0] ?? item.name} className="h-9 w-9 shrink-0" />
  }
  return (
    <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-raised text-[14px] font-medium text-muted">
      {item.kind === "public" ? "#" : item.name.slice(0, 1).toUpperCase()}
      {item.agentNames[0] ? (
        <Mascot seed={item.agentNames[0]} className="absolute -bottom-1 -right-1 h-[18px] w-[18px]" />
      ) : null}
    </span>
  )
}

function ThreadRow({
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
  const muted = isMuted(item)
  const unread = item.unreadCount > 0
  const href = `/${orgSlug}/r/${item.id}`

  function copyLink() {
    const url = `${window.location.origin}${href}`
    void navigator.clipboard?.writeText(url).then(
      () => showToast({ message: "Link copied" }),
      () => showToast({ message: "Could not copy the link", tone: "danger" }),
    )
  }

  return (
    <li className="group relative">
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        data-testid="room-link"
        data-room-name={item.name}
        className={cn(
          "flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors",
          active ? "bg-raised" : "hover:bg-panel",
        )}
      >
        <RowFace item={item} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("truncate text-[14px] text-text", unread ? "font-semibold" : "font-medium")}>
              {item.name}
            </span>
            {item.pinned ? <Pin className="h-3 w-3 shrink-0 self-center text-faint" aria-label="Pinned" /> : null}
            <span className="ml-auto shrink-0 text-[11.5px] text-faint md:group-hover:opacity-0 md:group-focus-within:opacity-0">
              {shortTime(item.lastAt)}
            </span>
          </span>
          <span className="mt-px flex items-center gap-2">
            <span className={cn("min-w-0 truncate text-[12.5px]", unread ? "text-muted" : "text-faint")}>
              {item.lastMessage ?? (item.isBotDm ? "Say hello" : "No messages yet")}
            </span>
            {item.mentionCount > 0 ? (
              <span className="ml-auto grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-accent px-1 text-[11px] font-medium text-void">
                {item.mentionCount}
              </span>
            ) : unread && !muted ? (
              <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-accent" aria-label={`${item.unreadCount} unread`} />
            ) : muted ? (
              <BellOff className="ml-auto h-3 w-3 shrink-0 text-faint" aria-label="Muted" />
            ) : null}
          </span>
        </span>
      </Link>

      <DetailsMenu
        className="absolute right-1.5 top-1.5"
        summaryLabel={`Options for ${item.name}`}
        summaryClassName="grid h-7 w-7 cursor-pointer list-none place-items-center rounded-lg text-faint opacity-100 transition-opacity hover:bg-hover hover:text-text md:opacity-0 md:group-hover:opacity-100 [[open]>&]:opacity-100"
        summary={<Ellipsis className="h-4 w-4" />}
      >
        <div className={cn(popover, "right-0 top-8 w-56")}>
          {item.isBotDm && item.agentId ? (
            <Link href={`/${orgSlug}/agents/${item.agentId}`} onClick={onNavigate} className={popoverItem}>
              <Bot className="h-4 w-4 text-faint" />
              Edit bot
            </Link>
          ) : (
            <Link href={`${href}/settings`} onClick={onNavigate} className={popoverItem}>
              <SlidersHorizontal className="h-4 w-4 text-faint" />
              Chat settings
            </Link>
          )}
          <button type="button" className={popoverItem} onClick={copyLink}>
            <Link2 className="h-4 w-4 text-faint" />
            Copy link
          </button>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            disabled={pending}
            onClick={() => onAction(item.pinned ? "unpin" : "pin")}
            className={popoverItem}
          >
            {item.pinned ? <PinOff className="h-4 w-4 text-faint" /> : <Pin className="h-4 w-4 text-faint" />}
            {item.pinned ? "Unpin" : "Pin to top"}
          </button>
          <button type="button" disabled={pending} onClick={() => onAction("mark_unread")} className={popoverItem}>
            <MailOpen className="h-4 w-4 text-faint" />
            Mark as unread
          </button>
          {muted ? (
            <button type="button" disabled={pending} onClick={() => onAction("unmute")} className={popoverItem}>
              <BellRing className="h-4 w-4 text-faint" />
              Unmute
            </button>
          ) : (
            <>
              <button type="button" disabled={pending} onClick={() => onAction("mute", "8h")} className={popoverItem}>
                <BellOff className="h-4 w-4 text-faint" />
                Mute for 8 hours
              </button>
              <button type="button" disabled={pending} onClick={() => onAction("mute", "always")} className={popoverItem}>
                <BellOff className="h-4 w-4 text-faint" />
                Mute until I unmute
              </button>
            </>
          )}
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            disabled={pending}
            onClick={() => onAction(item.archived ? "unarchive" : "archive")}
            className={popoverItem}
          >
            {item.archived ? (
              <ArchiveRestore className="h-4 w-4 text-faint" />
            ) : (
              <Archive className="h-4 w-4 text-faint" />
            )}
            {item.archived ? "Move back to chats" : "Archive"}
          </button>
        </div>
      </DetailsMenu>
    </li>
  )
}

/** A bot you have not talked to yet: one tap opens its chat. */
function NewBotRow({ bot, orgSlug, onNavigate }: { bot: BotLink; orgSlug: string; onNavigate?: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function start() {
    setError(null)
    startTransition(async () => {
      const result = await openBotDmAction(orgSlug, bot.id)
      if (!result.ok) {
        setError(result.error ?? "Could not open the chat")
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
        title={`Chat with ${bot.displayName}`}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-panel disabled:opacity-60"
      >
        <Mascot seed={bot.displayName} className="h-9 w-9 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium text-text">{bot.displayName}</span>
            {bot.kind === "external" ? (
              <span className="shrink-0 rounded-md bg-raised px-1.5 py-px text-[10.5px] text-muted">MCP</span>
            ) : null}
          </span>
          <span className={cn("mt-px block truncate text-[12.5px]", error ? "text-danger" : "text-faint")}>
            {pending ? "Opening…" : (error ?? "Say hi")}
          </span>
        </span>
      </button>
    </li>
  )
}

/** Which workspace you are in, as a small pill at the top. */
function WorkspaceSwitcher({ org, orgs, role }: { org: { slug: string; name: string }; orgs: OrgSummary[]; role: OrgRole }) {
  return (
    <DetailsMenu
      className="relative min-w-0"
      summaryLabel={`${org.name}: switch workspace`}
      summaryClassName="flex h-9 min-w-0 cursor-pointer list-none items-center gap-2 rounded-xl px-2 text-[14px] font-medium text-text transition-colors hover:bg-white/5"
      summary={
        <>
          <Mascot seed={org.name} mood="happy" className="h-6 w-6 shrink-0" />
          <span className="truncate">{org.name}</span>
          {role === "owner" ? (
            <span className="shrink-0 text-[11px] text-m-yellow" title="You own this workspace" aria-label="Owner">
              ♛
            </span>
          ) : null}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" />
        </>
      }
    >
      <div className={cn(popover, "left-0 top-full mt-1 w-64")}>
        <p className="px-2.5 pb-1 pt-1 text-[12px] text-faint">Your workspaces</p>
        {orgs.map((item) => (
          <Link
            key={item.id}
            href={`/${item.slug}`}
            className={cn(popoverItem, item.slug === org.slug && "bg-raised text-text")}
          >
            <Mascot seed={item.name} className="h-6 w-6 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
          </Link>
        ))}
        <div className="my-1 h-px bg-line" />
        <Link href="/new-workspace" className={popoverItem}>
          <Plus className="h-4 w-4 text-faint" />
          New workspace
        </Link>
      </div>
    </DetailsMenu>
  )
}

function AccountRow({ base, user, role }: { base: string; user: SidebarUser; role: OrgRole }) {
  const { updateReady, applyUpdate, checkForUpdates, checking, appVersion, desktop } = useAppUpdate()
  return (
    <DetailsMenu
      className="relative min-w-0 flex-1"
      summaryLabel="Your account"
      summaryClassName="flex h-11 min-w-0 cursor-pointer list-none items-center gap-2.5 rounded-xl px-2 transition-colors hover:bg-panel"
      summary={
        <>
          <span className="relative shrink-0">
            <Avatar name={user.displayName} src={user.avatarUrl} kind="human" size="md" />
            {updateReady ? (
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-ok shadow-[0_0_0_2px_var(--color-ink)]" aria-label="Update ready" />
            ) : null}
          </span>
          <span className="truncate text-[14px] font-medium text-text">{user.displayName}</span>
        </>
      }
    >
      <div className={cn(popover, "bottom-full left-0 mb-2 w-64")}>
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="truncate text-[14px] font-medium text-text">{user.displayName}</p>
          <p className="truncate text-[12px] text-faint">{user.email ?? role}</p>
        </div>
        {updateReady ? (
          <button
            type="button"
            onClick={applyUpdate}
            className="mb-1 flex w-full items-center justify-center gap-1.5 rounded-xl bg-ok/15 px-2.5 py-2 text-[13px] font-medium text-ok hover:bg-ok/25"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {desktop?.status === "available" ? `Install Sayabot ${desktop.latest}` : "Reload for the new version"}
          </button>
        ) : null}
        <div className="h-px bg-line" />
        <div className="py-1">
          <Link href={`${base}/settings`} className={popoverItem}>
            <Settings2 className="h-4 w-4 text-faint" />
            Settings
          </Link>
          <Link href={`${base}/meetings`} className={popoverItem}>
            <Users className="h-4 w-4 text-faint" />
            Meetings
          </Link>
          <Link href={`${base}/analytics`} className={popoverItem}>
            <BarChart3 className="h-4 w-4 text-faint" />
            Usage
          </Link>
          <Link href="/download" className={popoverItem}>
            <ArrowDownToLine className="h-4 w-4 text-faint" />
            <span className="flex-1">Get the apps</span>
            <span className="text-[11px] text-faint">{appVersion ? `v${appVersion}` : ""}</span>
          </Link>
          <button type="button" onClick={() => void checkForUpdates()} disabled={checking} className={popoverItem}>
            <RefreshCw className={cn("h-4 w-4 text-faint", checking && "animate-spin")} />
            {checking ? "Checking…" : "Check for updates"}
          </button>
          <Link href="/help" className={popoverItem}>
            <CircleHelp className="h-4 w-4 text-faint" />
            Help
          </Link>
        </div>
        <div className="h-px bg-line" />
        <form action={signOutAction} className="pt-1">
          <button type="submit" className={popoverItem}>
            Sign out
          </button>
        </form>
      </div>
    </DetailsMenu>
  )
}

/**
 * The whole left side in one column: workspace, search, inbox, your bots, group chats, and a
 * folded "Tools" drawer for everything else. New people see bots first, not a control panel.
 */
export function AppSidebar({
  org,
  orgs,
  chats,
  bots,
  user,
  role,
  inboxCount,
  desktopApp,
  onOpenPalette,
  onNavigate,
  headerExtra,
}: {
  org: { slug: string; name: string }
  orgs: OrgSummary[]
  chats: ChatListItem[]
  bots: BotLink[]
  user: SidebarUser
  role: OrgRole
  inboxCount: number
  desktopApp: boolean
  onOpenPalette: () => void
  onNavigate?: () => void
  headerExtra?: ReactNode
}) {
  const base = `/${org.slug}`
  const pathname = usePathname()
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const [pending, startTransition] = useTransition()
  const searchInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return
      if (!searchInput.current?.offsetParent) return
      event.preventDefault()
      searchInput.current.focus()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // ⌘N / Ctrl+N: new bot.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "n" || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      // The sidebar is mounted twice (desktop and phone drawer); only the visible one answers.
      if (!searchInput.current?.offsetParent) return
      event.preventDefault()
      router.push(`${base}/agents/new`)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [router, base])

  const needle = query.trim().toLowerCase()
  const matches = useCallback(
    (item: ChatListItem) =>
      !needle ||
      item.name.toLowerCase().includes(needle) ||
      (item.lastMessage ?? "").toLowerCase().includes(needle) ||
      item.agentNames.some((name) => name.toLowerCase().includes(needle)),
    [needle],
  )

  const live = useMemo(() => chats.filter((item) => !item.archived && matches(item)), [chats, matches])
  const archived = useMemo(() => chats.filter((item) => item.archived && matches(item)), [chats, matches])
  const pinned = live.filter((item) => item.pinned)
  const botChats = live.filter((item) => item.isBotDm && !item.pinned)
  const groupChats = live.filter((item) => !item.isBotDm && !item.pinned)

  const dmAgentIds = new Set(chats.filter((item) => item.isBotDm && item.agentId).map((item) => item.agentId))
  const newBots = bots.filter(
    (bot) => !dmAgentIds.has(bot.id) && (!needle || bot.displayName.toLowerCase().includes(needle)),
  )

  function act(roomId: string, action: RowAction, duration?: "8h" | "1w" | "always") {
    startTransition(async () => {
      const result = await setChatPreferenceAction({ orgSlug: org.slug, roomId, action, duration })
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
    <ThreadRow
      key={item.id}
      item={item}
      orgSlug={org.slug}
      active={pathname.startsWith(`${base}/r/${item.id}`)}
      pending={pending}
      onNavigate={onNavigate}
      onAction={(action, duration) => act(item.id, action, duration)}
    />
  )

  const inboxActive = pathname.startsWith(`${base}/inbox`)
  const sectionAction = (href: string, label: string) => (
    <Link
      href={href}
      onClick={onNavigate}
      aria-label={label}
      title={label}
      className="grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-hover hover:text-text"
    >
      <Plus className="h-3.5 w-3.5" />
    </Link>
  )
  const nothing = !pinned.length && !botChats.length && !groupChats.length && !newBots.length

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden [-webkit-app-region:no-drag]">
      {/* A soft wash of colour at the top, so the sidebar feels like a place, not a table. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(157,140,255,0.10),transparent_60%),radial-gradient(90%_70%_at_100%_0%,rgba(110,180,255,0.06),transparent_65%)]"
      />

      <div
        className={cn(
          "relative flex h-14 shrink-0 items-center gap-1 px-2.5",
          desktopApp && "pl-[84px] [-webkit-app-region:drag]",
        )}
      >
        {headerExtra}
        <div className="min-w-0 flex-1 [-webkit-app-region:no-drag]">
          <WorkspaceSwitcher org={org} orgs={orgs} role={role} />
        </div>
        <DetailsMenu
          className="relative shrink-0 [-webkit-app-region:no-drag]"
          summaryLabel="New bot or group chat"
          summaryClassName="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-xl text-muted transition-colors hover:bg-white/5 hover:text-text"
          summary={<Plus className="h-[18px] w-[18px]" />}
        >
          <div className={cn(popover, "right-0 top-full mt-1 w-56")}>
            <Link href={`${base}/agents/new`} onClick={onNavigate} className={popoverItem}>
              <Bot className="h-4 w-4 text-faint" />
              <span className="flex-1">New bot</span>
              <kbd className="rounded-md border border-line-strong px-1.5 font-sans text-[10.5px] text-faint">⌘N</kbd>
            </Link>
            <Link href={`${base}/chats/new`} onClick={onNavigate} className={popoverItem}>
              <Users className="h-4 w-4 text-faint" />
              New group chat
            </Link>
          </div>
        </DetailsMenu>
      </div>

      <div className="relative shrink-0 px-2.5">
        <label className="flex h-10 items-center gap-2.5 rounded-xl bg-white/[0.06] px-3 transition-colors focus-within:bg-white/[0.09]">
          <Search className="h-4 w-4 shrink-0 text-faint" aria-hidden />
          <span className="sr-only">Search chats. Press Enter to search every message.</span>
          <input
            ref={searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("")
              if (event.key === "Enter" && needle) {
                onNavigate?.()
                router.push(`${base}/search?q=${encodeURIComponent(query.trim())}`)
              }
            }}
            placeholder="Search"
            className="w-full min-w-0 bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
          />
          <button
            type="button"
            onClick={onOpenPalette}
            title="Go anywhere"
            aria-label="Open the command palette"
            className="hidden shrink-0 rounded-md border border-line-strong px-1.5 py-px font-sans text-[10.5px] text-faint hover:text-text md:block"
          >
            ⌘K
          </button>
        </label>

        <Link
          href={`${base}/inbox`}
          onClick={onNavigate}
          aria-current={inboxActive ? "page" : undefined}
          className={cn(
            "mt-2 flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-[14.5px] font-medium transition-colors",
            inboxActive ? "bg-raised text-text" : "text-text hover:bg-white/5",
          )}
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.07]">
            <Inbox className="h-[17px] w-[17px] text-muted" />
          </span>
          <span className="flex-1">Inbox</span>
          {inboxCount > 0 ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-void">
              {inboxCount > 99 ? "99+" : inboxCount}
            </span>
          ) : null}
        </Link>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 pt-1">
        {pinned.length ? <ul className="mt-2 space-y-0.5">{pinned.map(row)}</ul> : null}

        {botChats.length || newBots.length || !needle ? (
          <Section id="bots" label="Bots" action={sectionAction(`${base}/agents/new`, "New bot")}>
            <ul className="space-y-0.5">
              {botChats.map(row)}
              {newBots.map((bot) => (
                <NewBotRow key={bot.id} bot={bot} orgSlug={org.slug} onNavigate={onNavigate} />
              ))}
            </ul>
            {!botChats.length && !newBots.length && !needle ? (
              <Link
                href={`${base}/agents/new`}
                onClick={onNavigate}
                className="mx-2 mt-1 flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-muted hover:border-faint hover:text-text"
              >
                <Plus className="h-4 w-4" />
                Make your first bot
              </Link>
            ) : null}
          </Section>
        ) : null}

        {groupChats.length || !needle ? (
          <Section id="groups" label="Group chats" action={sectionAction(`${base}/chats/new`, "New group chat")}>
            <ul className="space-y-0.5">{groupChats.map(row)}</ul>
            {!groupChats.length && !needle ? (
              <Link
                href={`${base}/chats/new`}
                onClick={onNavigate}
                className="mx-2 mt-1 flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-[13px] text-muted hover:border-faint hover:text-text"
              >
                <Plus className="h-4 w-4" />
                Start a group chat and invite bots
              </Link>
            ) : null}
          </Section>
        ) : null}

        {archived.length ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowArchived((open) => !open)}
              aria-expanded={showArchived}
              className="flex h-7 items-center gap-1 px-2 text-[12.5px] text-faint hover:text-text"
            >
              <Archive className="h-3.5 w-3.5" />
              Archived ({archived.length})
            </button>
            {showArchived ? <ul className="space-y-0.5 opacity-80">{archived.map(row)}</ul> : null}
          </div>
        ) : null}

        {nothing && needle ? (
          <p className="px-3 py-8 text-center text-[13px] leading-relaxed text-faint">
            Nothing matches. Press Enter to search every message.
          </p>
        ) : null}
      </div>

      <div className="relative shrink-0 border-t border-line/60 px-2.5 pt-1">
        <Section id="tools" label="Tools">
          <nav aria-label="Tools" className="space-y-0.5 pb-1">
            {TOOLS.map((tool) => {
              const href = `${base}${tool.href}`
              const active = pathname.startsWith(href)
              return (
                <Link
                  key={tool.key}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-2.5 py-[7px] text-[14px] transition-colors",
                    active ? "bg-raised text-text" : "text-text/90 hover:bg-panel",
                  )}
                >
                  <tool.icon className="h-[17px] w-[17px] text-muted" />
                  {tool.label}
                </Link>
              )
            })}
          </nav>
        </Section>
      </div>

      {user.isGuest ? (
        <div className="relative shrink-0 px-2.5 pt-1">
          <Link
            href={`/auth/save-account?next=${encodeURIComponent(base)}`}
            onClick={onNavigate}
            className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2 text-[12.5px] leading-snug text-muted transition-colors hover:border-line-strong hover:text-text"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-text">Save your account</span>
              Keep your bots on your phone and the web
            </span>
          </Link>
        </div>
      ) : null}

      <div className="relative flex shrink-0 items-center gap-1 px-2.5 pb-3 pt-1">
        <AccountRow base={base} user={user} role={role} />
        <Link
          href={`${base}/settings`}
          onClick={onNavigate}
          aria-label="Settings"
          title="Settings"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-panel hover:text-text"
        >
          <Settings className="h-[18px] w-[18px]" />
        </Link>
      </div>
    </div>
  )
}
