"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react"
import { ArrowDownToLine, Bot, CircleHelp, Clock, Inbox, MessageCircle, Search, Settings2 } from "lucide-react"
import { signOutAction } from "@/lib/actions/auth"
import { cn } from "@/lib/format"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DetailsMenu } from "@/components/ui/details-menu"
import { SayabotMark } from "@/components/landing/sayabot-mark"
import { ChatList, type BotLink } from "@/components/workspace/chat-list"
import { CommandPalette } from "@/components/command-palette"
import { useWorkspaceActivity } from "@/components/use-workspace-activity"
import { visibleSettingsGroups } from "@/lib/settings-nav"
import {
  AnalyticsIcon,
  CanvasIcon,
  CheckIcon,
  CloseIcon,
  HistoryIcon,
  MenuIcon,
  PlusIcon,
} from "@/components/ui/icons"
import type { ChatListItem, OrgRole, OrgSummary } from "@/lib/types"

type NavIcon = ComponentType<{ className?: string; width?: number; height?: number }>

const PRIMARY_NAV: { key: string; href: string; label: string; icon: NavIcon }[] = [
  { key: "chats", href: "", label: "Chats", icon: MessageCircle },
  { key: "inbox", href: "/inbox", label: "Inbox", icon: Inbox },
  { key: "cron", href: "/cron", label: "Automations", icon: Clock },
  { key: "meetings", href: "/meetings", label: "Meetings", icon: HistoryIcon },
  { key: "tasks", href: "/tasks", label: "Tasks", icon: CheckIcon },
  { key: "files", href: "/files", label: "Files", icon: CanvasIcon },
  { key: "agents", href: "/agents", label: "Agents", icon: Bot },
  { key: "search", href: "/search", label: "Search", icon: Search },
]

/** Settings entries this role may open, flattened from the one shared settings config. */
function settingsLinks(role: OrgRole): { href: string; label: string }[] {
  return [
    { href: "/settings", label: "Overview" },
    ...visibleSettingsGroups(role === "owner" || role === "admin").flatMap((group) =>
      group.links.map((link) => ({ href: `/settings/${link.segment}`, label: link.label })),
    ),
  ]
}

function isMuted(item: ChatListItem): boolean {
  return Boolean(item.mutedUntil && new Date(item.mutedUntil).getTime() > Date.now())
}

/** Unread messages that should pull attention: muted and archived chats do not count. */
function attentionUnread(chats: ChatListItem[]): number {
  return chats.reduce(
    (total, chat) => total + (chat.archived || isMuted(chat) ? 0 : chat.unreadCount),
    0,
  )
}

function isChatRoute(pathname: string, base: string): boolean {
  return (
    pathname === base || pathname.startsWith(`${base}/r/`) || pathname.startsWith(`${base}/chats`)
  )
}

function navActive(key: string, href: string, pathname: string, base: string): boolean {
  return key === "chats" ? isChatRoute(pathname, base) : pathname.startsWith(`${base}${href}`)
}

const railButton =
  "peer relative grid h-10 w-10 place-items-center rounded-xl text-muted transition-colors hover:bg-panel hover:text-text"

const popover =
  "absolute bottom-0 left-full z-50 ml-2 w-60 overflow-hidden rounded-xl border border-line-strong bg-panel py-1 shadow-[0_16px_40px_rgba(0,0,0,0.5)]"

const popoverItem =
  "block truncate px-3 py-1.5 text-[13px] text-muted hover:bg-raised hover:text-text"

function Tip({ children }: { children: ReactNode }) {
  return (
    <span
      role="presentation"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-line-strong bg-panel px-2 py-1 text-[12px] text-text opacity-0 transition-opacity peer-hover:opacity-100 peer-focus-visible:opacity-100"
    >
      {children}
    </span>
  )
}

function Rail({
  org,
  orgs,
  user,
  role,
  pathname,
  unread,
  inboxCount,
}: {
  org: { slug: string; name: string }
  orgs: OrgSummary[]
  user: { displayName: string; avatarUrl: string | null; email: string | null }
  role: OrgRole
  pathname: string
  unread: boolean
  inboxCount: number
}) {
  const base = `/${org.slug}`
  const settingsActive = pathname.startsWith(`${base}/settings`)
  const usageActive = pathname.startsWith(`${base}/analytics`)

  return (
    <nav
      aria-label="Workspace"
      className="hidden w-[60px] shrink-0 flex-col items-center gap-1 py-1 md:flex"
    >
      <DetailsMenu
        className="relative mb-2"
        summaryLabel={`${org.name}: switch workspace`}
        summaryClassName="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-xl hover:bg-panel"
        summary={<SayabotMark className="h-7 w-7" />}
      >
        <div className={cn(popover, "bottom-auto top-0")}>
          <p className="px-3 pb-1 pt-1.5 text-[12px] text-faint">Workspaces</p>
          {orgs.map((item) => (
            <Link
              key={item.id}
              href={`/${item.slug}`}
              className={cn(
                "flex items-center justify-between gap-3 px-3 py-1.5 text-[13px] hover:bg-raised",
                item.slug === org.slug ? "text-text" : "text-muted",
              )}
            >
              <span className="truncate">{item.name}</span>
              <span className="text-[11px] text-faint">{item.role}</span>
            </Link>
          ))}
          <div className="my-1 h-px bg-line" />
          <Link href="/new-workspace" className={popoverItem}>
            New workspace
          </Link>
        </div>
      </DetailsMenu>

      {PRIMARY_NAV.map((item) => {
        const href = `${base}${item.href}`
        const isActive = navActive(item.key, item.href, pathname, base)
        const count = item.key === "inbox" ? inboxCount : 0
        return (
          <div key={item.key} className="relative">
            <Link
              href={href}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              className={cn(railButton, isActive && "bg-raised text-text")}
            >
              <item.icon width={19} height={19} className="h-[19px] w-[19px]" />
              {count > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-medium text-void">
                  {count > 99 ? "99+" : count}
                </span>
              ) : item.key === "chats" && unread ? (
                <span
                  className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent"
                  aria-label="Unread chats"
                />
              ) : null}
            </Link>
            <Tip>{item.label}</Tip>
          </div>
        )
      })}

      <div className="mt-auto flex flex-col items-center gap-1">
        <DetailsMenu
          className="relative"
          summaryLabel="Updates"
          summaryClassName={cn(
            "grid h-10 w-10 cursor-pointer list-none place-items-center rounded-xl text-muted transition-colors hover:bg-panel hover:text-text",
            pathname === "/download" && "bg-raised text-text",
          )}
          summary={<ArrowDownToLine className="h-[18px] w-[18px]" />}
        >
          <div className={popover}>
            <div className="flex items-center justify-between px-3 pb-1.5 pt-1.5 border-b border-line mb-1">
              <p className="text-[12px] font-medium text-text">Sayabot Updates</p>
              <span className="font-mono text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">v1.0.1</span>
            </div>
            <a
              href="https://github.com/anurag3407/Mesh/releases/latest/download/Sayabot-arm64.dmg"
              className={popoverItem}
            >
              Download macOS (.dmg)
            </a>
            <a
              href="https://github.com/anurag3407/Mesh/releases/latest/download/Sayabot.apk"
              className={popoverItem}
            >
              Download Android (.apk)
            </a>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={cn(popoverItem, "w-full text-left")}
            >
              Check Web Updates (Reload)
            </button>
            <div className="border-t border-line mt-1 pt-1">
              <Link href="/download" className={cn(popoverItem, "text-emerald-400 font-medium")}>
                View All Downloads →
              </Link>
            </div>
          </div>
        </DetailsMenu>
        <div className="relative">
          <Link
            href={`${base}/analytics`}
            aria-label="Usage"
            aria-current={usageActive ? "page" : undefined}
            className={cn(railButton, usageActive && "bg-raised text-text")}
          >
            <AnalyticsIcon width={18} height={18} />
          </Link>
          <Tip>Usage</Tip>
        </div>
        <div className="relative">
          <Link href="/help" aria-label="Help" className={railButton}>
            <CircleHelp className="h-[19px] w-[19px]" />
          </Link>
          <Tip>Help</Tip>
        </div>
        <DetailsMenu
          className="relative"
          summaryLabel="Settings"
          summaryClassName={cn(
            "grid h-10 w-10 cursor-pointer list-none place-items-center rounded-xl text-muted transition-colors hover:bg-panel hover:text-text",
            settingsActive && "bg-raised text-text",
          )}
          summary={<Settings2 className="h-[19px] w-[19px]" />}
        >
          <div className={popover}>
            <p className="px-3 pb-1 pt-1.5 text-[12px] text-faint">Settings</p>
            {settingsLinks(role).map((link) => {
              const href = `${base}${link.href}`
              const active =
                link.href === "/settings" ? pathname === href : pathname.startsWith(href)
              return (
                <Link
                  key={link.href}
                  href={href}
                  className={cn(popoverItem, active && "text-text")}
                >
                  {link.label}
                </Link>
              )
            })}
          </div>
        </DetailsMenu>
        <DetailsMenu
          className="relative mt-1"
          summaryLabel="Your account"
          summaryClassName="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-xl hover:bg-panel"
          summary={<Avatar name={user.displayName} src={user.avatarUrl} kind="human" size="md" />}
        >
          <div className={popover}>
            <div className="border-b border-line px-3 pb-2 pt-1.5">
              <p className="truncate text-[13px] text-text">{user.displayName}</p>
              <p className="truncate text-[12px] text-faint">{user.email ?? role}</p>
            </div>
            <Link href={`${base}/settings/profile`} className={cn(popoverItem, "mt-1")}>
              Your profile
            </Link>
            <form action={signOutAction}>
              <button type="submit" className={cn(popoverItem, "w-full text-left")}>
                Sign out
              </button>
            </form>
          </div>
        </DetailsMenu>
      </div>
    </nav>
  )
}

/** Phone drawer: every destination as a grid, then the chat list. */
function MobileDrawer({
  org,
  orgs,
  chats,
  bots,
  user,
  pathname,
  inboxCount,
  onNavigate,
}: {
  org: { slug: string; name: string }
  orgs: OrgSummary[]
  chats: ChatListItem[]
  bots: BotLink[]
  user: { displayName: string; avatarUrl: string | null; email: string | null }
  pathname: string
  inboxCount: number
  onNavigate: () => void
}) {
  const base = `/${org.slug}`
  const tile = "flex flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] text-muted"
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-4 gap-1 border-b border-line p-2">
        {PRIMARY_NAV.map((item) => (
          <Link
            key={item.key}
            href={`${base}${item.href}`}
            onClick={onNavigate}
            aria-current={navActive(item.key, item.href, pathname, base) ? "page" : undefined}
            className={cn(
              tile,
              navActive(item.key, item.href, pathname, base) && "bg-raised text-text",
            )}
          >
            <item.icon width={19} height={19} className="h-[19px] w-[19px]" />
            {item.key === "inbox" && inboxCount > 0 ? `Inbox ${inboxCount}` : item.label}
          </Link>
        ))}
        <Link href="/download" onClick={onNavigate} className={tile}>
          <ArrowDownToLine width={19} height={19} className="h-[19px] w-[19px]" />
          Updates
        </Link>
        <Link href={`${base}/analytics`} onClick={onNavigate} className={tile}>
          <AnalyticsIcon width={19} height={19} />
          Usage
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        <ChatList orgSlug={org.slug} items={chats} bots={bots} onNavigate={onNavigate} />
      </div>
      <details className="shrink-0 border-t border-line">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-3">
          <Avatar name={user.displayName} src={user.avatarUrl} kind="human" size="sm" />
          <span className="min-w-0 flex-1 truncate text-[13px]">{user.displayName}</span>
          <span className="text-[12px] text-faint">{org.name}</span>
        </summary>
        <div className="max-h-[40dvh] overflow-y-auto pb-2 text-[14px]">
          {orgs
            .filter((item) => item.slug !== org.slug)
            .map((item) => (
              <Link
                key={item.id}
                href={`/${item.slug}`}
                onClick={onNavigate}
                className="block px-4 py-2.5 text-muted"
              >
                Switch to {item.name}
              </Link>
            ))}
          <Link href="/new-workspace" onClick={onNavigate} className="block px-4 py-2.5 text-muted">
            New workspace
          </Link>
          <Link
            href={`${base}/settings`}
            onClick={onNavigate}
            className="block px-4 py-2.5 text-muted"
          >
            Settings
          </Link>
          <Link
            href={`${base}/settings/profile`}
            onClick={onNavigate}
            className="block px-4 py-2.5 text-muted"
          >
            Your profile
          </Link>
          <Link href="/help" onClick={onNavigate} className="block px-4 py-2.5 text-muted">
            Help
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="block w-full px-4 py-2.5 text-left text-muted">
              Sign out
            </button>
          </form>
        </div>
      </details>
    </div>
  )
}

export function WorkspaceShell({
  org,
  orgs,
  chats: initialChats,
  bots,
  inboxCount: initialInboxCount,
  user,
  role,
  children,
}: {
  org: { slug: string; name: string }
  orgs: OrgSummary[]
  chats: ChatListItem[]
  bots: BotLink[]
  inboxCount: number
  user: {
    id: string
    displayName: string
    avatarUrl: string | null
    email: string | null
    notifications: "all" | "mentions" | "off"
    sound: boolean
  }
  role: OrgRole
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    setMobileOpen(false)
    dialogRef.current?.close()
  }, [pathname])

  useEffect(() => {
    if (mobileOpen) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [mobileOpen])

  const currentRoomId = useMemo(() => {
    const match = /\/r\/([^/]+)/.exec(pathname)
    return match?.[1] ?? null
  }, [pathname])

  const activity = useWorkspaceActivity({
    orgSlug: org.slug,
    role,
    userId: user.id,
    userName: user.displayName,
    notifications: user.notifications,
    sound: user.sound,
    chats: initialChats,
    inboxCount: initialInboxCount,
    currentRoomId,
  })
  const inboxCount = activity.inboxCount
  // The room on screen is being read, even if the server has not recorded that yet.
  const chats = useMemo(
    () =>
      activity.chats.map((chat) =>
        chat.id === currentRoomId ? { ...chat, unreadCount: 0, mentionCount: 0 } : chat,
      ),
    [activity.chats, currentRoomId],
  )
  const totalUnread = attentionUnread(chats)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const showList = isChatRoute(pathname, `/${org.slug}`)

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void md:flex-row md:py-2 md:pr-2">
      <Rail
        org={org}
        orgs={orgs}
        user={user}
        role={role}
        pathname={pathname}
        unread={totalUnread > 0}
        inboxCount={inboxCount}
      />

      <div className="flex shrink-0 items-center gap-2 bg-ink px-2 pb-1 pt-[max(0.25rem,env(safe-area-inset-top))] md:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(true)}
          aria-label="Open workspace menu"
        >
          <MenuIcon />
        </Button>
        <SayabotMark className="h-6 w-6" />
        <span className="truncate text-[14px] text-text">{org.name}</span>
        {inboxCount + totalUnread > 0 ? (
          <span className="ml-auto mr-2 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-medium text-void">
            {inboxCount + totalUnread > 99 ? "99+" : inboxCount + totalUnread}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-ink md:rounded-[18px] md:border md:border-line">
        {showList ? (
          <aside
            className="hidden w-[320px] shrink-0 flex-col border-r border-line md:flex"
            aria-label="Chats"
          >
            <div className="flex h-12 shrink-0 items-center justify-between pl-5 pr-3">
              <span className="truncate text-[14px] font-medium">{org.name}</span>
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="Open command menu"
                title="Jump to… (⌘K)"
                className="ml-auto mr-1 hidden h-8 items-center gap-2 rounded-lg border border-line px-2.5 text-[12px] text-faint hover:border-line-strong hover:text-text lg:flex"
              >
                Jump to…
                <kbd className="font-mono text-[10px]">⌘K</kbd>
              </button>
              <Link
                href={`/${org.slug}/chats/new`}
                aria-label="New chat"
                title="New chat"
                className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-panel hover:text-text"
              >
                <PlusIcon width={16} height={16} />
              </Link>
            </div>
            <div className="min-h-0 flex-1">
              <ChatList orgSlug={org.slug} items={chats} bots={bots} />
            </div>
          </aside>
        ) : null}

        <main id="main-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 outline-none">
          {children}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        orgSlug={org.slug}
        role={role}
        chats={chats}
        bots={bots}
        pages={PRIMARY_NAV}
      />

      <dialog
        ref={dialogRef}
        className="m-0 h-dvh max-h-none w-[88vw] max-w-[360px] bg-ink p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-text backdrop:bg-void/70"
        onClose={() => setMobileOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) setMobileOpen(false)
        }}
      >
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between px-3 py-2">
            <span className="text-[14px] font-medium">{org.name}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileOpen(false)}
              aria-label="Close workspace menu"
            >
              <CloseIcon width={15} height={15} />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <MobileDrawer
              org={org}
              orgs={orgs}
              chats={chats}
              bots={bots}
              user={user}
              pathname={pathname}
              inboxCount={inboxCount}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      </dialog>
    </div>
  )
}
