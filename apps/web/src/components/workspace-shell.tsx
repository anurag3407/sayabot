"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import {
  ArrowDownToLine,
  BarChart3,
  Bot,
  CalendarClock,
  CheckSquare,
  ChevronDown,
  CircleHelp,
  FolderClosed,
  Inbox,
  MessageCircle,
  RefreshCw,
  Search,
  Settings2,
  Store,
  Users,
} from "lucide-react"
import { UpdateProvider, useAppUpdate } from "@/components/update-notification"
import { signOutAction } from "@/lib/actions/auth"
import { cn } from "@/lib/format"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DetailsMenu } from "@/components/ui/details-menu"
import { Mascot } from "@/components/ui/mascot"
import { SayabotMark } from "@/components/landing/sayabot-mark"
import { ChatList, type BotLink } from "@/components/workspace/chat-list"
import { CommandPalette } from "@/components/command-palette"
import { SidebarPlanRings } from "@/components/usage/plan-rings"
import { useWorkspaceActivity } from "@/components/use-workspace-activity"
import { IconRail } from "@/components/workspace/icon-rail"
import { Titlebar } from "@/components/workspace/titlebar"
import { TitlebarSlotContext } from "@/components/workspace/titlebar-slot"
import { CloseIcon, MenuIcon, PlusIcon } from "@/components/ui/icons"
import { GuestBanner } from "@/components/auth/guest-banner"
import type { ChatListItem, OrgRole, OrgSummary } from "@/lib/types"

type NavIcon = ComponentType<{ className?: string }>

/** Every destination, for the command palette. The sidebar only shows the everyday few. */
const ALL_PAGES: { key: string; href: string; label: string; icon: NavIcon }[] = [
  { key: "chats", href: "", label: "Chats", icon: MessageCircle },
  { key: "inbox", href: "/inbox", label: "Inbox", icon: Inbox },
  { key: "tasks", href: "/tasks", label: "To-dos", icon: CheckSquare },
  { key: "cron", href: "/cron", label: "Routines", icon: CalendarClock },
  { key: "files", href: "/files", label: "Files", icon: FolderClosed },
  { key: "meetings", href: "/meetings", label: "Meetings", icon: Users },
  { key: "agents", href: "/agents", label: "Agents", icon: Bot },
  { key: "marketplace", href: "/marketplace", label: "Find more agents", icon: Store },
  { key: "search", href: "/search", label: "Search", icon: Search },
]

const SIDEBAR_NAV = ALL_PAGES.filter((page) => ["inbox", "tasks", "cron"].includes(page.key))

/** Places behind the rail's "more" button on wide screens. */
const RAIL_MORE_PAGES = ALL_PAGES.filter((page) =>
  ["agents", "files", "meetings", "search"].includes(page.key),
)

const LIST_OPEN_KEY = "sayabot:chat-list-open"

/** Quieter places that live in the account menu instead of crowding the sidebar. */
const MENU_PAGES = ALL_PAGES.filter((page) =>
  ["agents", "files", "meetings", "marketplace"].includes(page.key),
)

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

/** The Mac app hides its title bar, so the traffic lights sit over the top of the sidebar. */
function useDesktopApp(): boolean {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    setDesktop(Boolean((window as unknown as { sayabotDesktop?: unknown }).sayabotDesktop))
  }, [])
  return desktop
}

/** Wide screens get the rail, tabs and title bar; phones keep the drawer. */
function useWideScreen(): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)")
    const apply = () => setWide(query.matches)
    apply()
    query.addEventListener("change", apply)
    return () => query.removeEventListener("change", apply)
  }, [])
  return wide
}

/** Whether the chat list column is showing, remembered on this device. */
function useListOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(LIST_OPEN_KEY) === "0") setOpen(false)
    } catch {
      // Stays open.
    }
  }, [])
  const toggle = useCallback(() => {
    setOpen((previous) => {
      const next = !previous
      try {
        window.localStorage.setItem(LIST_OPEN_KEY, next ? "1" : "0")
      } catch {
        // The choice lasts for this visit.
      }
      return next
    })
  }, [])
  return [open, toggle]
}

const popover =
  "absolute z-50 w-64 overflow-hidden rounded-2xl border border-line-strong bg-panel p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"

const popoverItem =
  "flex w-full items-center gap-2.5 truncate rounded-xl px-2.5 py-2 text-left text-[13.5px] text-muted transition-colors hover:bg-raised hover:text-text"

/** The workspace as a character: one friendly face instead of a logo and a name. */
function WorkspaceHero({
  org,
  orgs,
  role,
}: {
  org: { slug: string; name: string }
  orgs: OrgSummary[]
  role: OrgRole
}) {
  return (
    <DetailsMenu
      className="relative mx-auto"
      summaryLabel={`${org.name}: switch workspace`}
      summaryClassName="group flex cursor-pointer list-none flex-col items-center gap-1.5 rounded-3xl px-6 pb-3 pt-2 transition-colors hover:bg-panel"
      summary={
        <>
          <span className="relative block">
            <Mascot
              seed={org.name}
              figure
              shadow
              blink
              mood="happy"
              className="block h-[92px] w-auto transition-transform duration-300 ease-out group-hover:-translate-y-1"
            />
            {role === "owner" ? (
              <span
                className="absolute -right-1 bottom-4 grid h-6 w-6 place-items-center rounded-full bg-m-yellow text-[12px] shadow-[0_0_0_3px_var(--color-ink)]"
                aria-label="You own this workspace"
                title="You own this workspace"
              >
                <span aria-hidden="true">♛</span>
              </span>
            ) : null}
          </span>
          <span className="flex items-center gap-1 text-[16px] font-semibold tracking-[-0.01em] text-text">
            <span className="max-w-[200px] truncate">{org.name}</span>
            <ChevronDown className="h-3.5 w-3.5 text-faint transition-colors group-hover:text-muted" />
          </span>
        </>
      }
    >
      <div className={cn(popover, "left-1/2 top-full mt-1 -translate-x-1/2")}>
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
          <PlusIcon width={15} height={15} className="text-faint" />
          New workspace
        </Link>
      </div>
    </DetailsMenu>
  )
}

function AccountMenu({
  base,
  user,
  role,
  compact = false,
}: {
  base: string
  user: { displayName: string; avatarUrl: string | null; email: string | null }
  role: OrgRole
  /** The rail version: a small square that opens to the right. */
  compact?: boolean
}) {
  const { updateReady, restartToUpdate, checkForUpdates, checking, versionData } = useAppUpdate()
  return (
    <DetailsMenu
      className="relative shrink-0"
      summaryLabel="Your account and settings"
      summaryClassName={
        compact
          ? "relative grid h-11 w-11 cursor-pointer list-none place-items-center rounded-xl transition-colors hover:bg-panel"
          : "relative grid h-12 w-12 cursor-pointer list-none place-items-center rounded-full bg-panel transition-colors hover:bg-raised"
      }
      summary={
        <>
          {compact ? (
            <Avatar
              name={user.displayName}
              src={user.avatarUrl}
              kind="human"
              size="lg"
              className="h-9 w-9 rounded-[10px] border-0 bg-m-coral/90 font-sans text-[13px] text-void"
            />
          ) : (
            <Avatar name={user.displayName} src={user.avatarUrl} kind="human" size="md" />
          )}
          {updateReady ? (
            <span className="absolute right-0.5 top-0.5 flex h-3 w-3" aria-label="Update ready">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-ok shadow-[0_0_0_2px_var(--color-ink)]" />
            </span>
          ) : null}
        </>
      }
    >
      <div className={cn(popover, compact ? "bottom-0 left-full ml-2" : "bottom-full left-0 mb-2")}>
        <div className="flex items-center gap-2.5 px-2.5 pb-2.5 pt-1.5">
          <Avatar name={user.displayName} src={user.avatarUrl} kind="human" size="md" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium text-text">{user.displayName}</p>
            <p className="truncate text-[12px] text-faint">{user.email ?? role}</p>
          </div>
        </div>
        {updateReady ? (
          <button
            type="button"
            onClick={restartToUpdate}
            className="mb-1 flex w-full items-center justify-center gap-1.5 rounded-xl bg-ok/15 px-2.5 py-2 text-[13px] font-medium text-ok hover:bg-ok/25"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Restart to get the new version
          </button>
        ) : null}
        <div className="h-px bg-line" />
        <div className="py-1">
          {MENU_PAGES.map((page) => (
            <Link key={page.key} href={`${base}${page.href}`} className={popoverItem}>
              <page.icon className="h-4 w-4 text-faint" />
              {page.label}
            </Link>
          ))}
        </div>
        <div className="h-px bg-line" />
        <div className="py-1">
          <Link href={`${base}/settings`} className={popoverItem}>
            <Settings2 className="h-4 w-4 text-faint" />
            Settings
          </Link>
          <Link href={`${base}/analytics`} className={popoverItem}>
            <BarChart3 className="h-4 w-4 text-faint" />
            Usage
          </Link>
          <Link href="/download" className={popoverItem}>
            <ArrowDownToLine className="h-4 w-4 text-faint" />
            <span className="flex-1">Get the apps</span>
            <span className="text-[11px] text-faint">
              {versionData?.version ? `v${versionData.version}` : ""}
            </span>
          </Link>
          <button
            type="button"
            onClick={() => void checkForUpdates()}
            disabled={checking}
            className={popoverItem}
          >
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

/** Tiny stand-ins for the apps people connect most, so the pill reads at a glance. */
function AppGlyphs() {
  const glyph = "grid h-[18px] w-[18px] place-items-center rounded-[5px] text-[10px] font-bold"
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      <span className={cn(glyph, "bg-m-blue/20 text-m-blue")}>G</span>
      <span className={cn(glyph, "bg-m-pink/20 text-m-pink")}>#</span>
      <span className={cn(glyph, "bg-text/15 text-text")}>N</span>
    </span>
  )
}

function Sidebar({
  org,
  orgs,
  chats,
  bots,
  user,
  role,
  pathname,
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
  user: { displayName: string; avatarUrl: string | null; email: string | null }
  role: OrgRole
  pathname: string
  inboxCount: number
  desktopApp: boolean
  onOpenPalette: () => void
  onNavigate?: () => void
  headerExtra?: React.ReactNode
}) {
  const base = `/${org.slug}`
  const [searchOpen, setSearchOpen] = useState(false)
  const iconButton =
    "grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-panel hover:text-text"

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 px-3",
          desktopApp ? "h-14 pl-[84px] [-webkit-app-region:drag]" : "h-14",
        )}
      >
        {headerExtra}
        <div className="ml-auto flex items-center gap-0.5 [-webkit-app-region:no-drag]">
          <button
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            onDoubleClick={onOpenPalette}
            aria-label="Search chats"
            aria-pressed={searchOpen}
            title="Search chats (⌘K for everything)"
            className={cn(iconButton, searchOpen && "bg-panel text-text")}
          >
            <Search className="h-[18px] w-[18px]" />
          </button>
          <Link
            href={`${base}/chats/new`}
            onClick={onNavigate}
            aria-label="New chat"
            title="New chat"
            className={iconButton}
          >
            <PlusIcon width={18} height={18} />
          </Link>
        </div>
      </div>

      <nav aria-label="Workspace" className="shrink-0 space-y-0.5 px-3">
        {SIDEBAR_NAV.map((item) => {
          const href = `${base}${item.href}`
          const active = pathname.startsWith(href)
          const count = item.key === "inbox" ? inboxCount : 0
          return (
            <Link
              key={item.key}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-2xl px-2 py-1.5 text-[15px] transition-colors",
                active ? "bg-raised text-text" : "text-text/90 hover:bg-panel",
              )}
            >
              <span
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-full transition-colors",
                  active ? "bg-hover" : "bg-panel",
                )}
              >
                <item.icon className="h-[18px] w-[18px] text-muted" />
              </span>
              <span className="flex-1">{item.label}</span>
              {count > 0 ? (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-void">
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>

      <div className="shrink-0 pb-1 pt-4">
        <WorkspaceHero org={org} orgs={orgs} role={role} />
      </div>

      <div className="min-h-0 flex-1">
        <ChatList
          orgSlug={org.slug}
          items={chats}
          bots={bots}
          onNavigate={onNavigate}
          searchOpen={searchOpen}
          onSearchOpenChange={setSearchOpen}
        />
      </div>

      <div className="shrink-0 px-3 pt-1">
        <SidebarPlanRings usageHref={`${base}/analytics`} onNavigate={onNavigate} />
      </div>

      <div className="flex shrink-0 items-center gap-2 px-3 pb-3 pt-2">
        <AccountMenu base={base} user={user} role={role} />
        <Link
          href={`${base}/settings/connectors`}
          onClick={onNavigate}
          className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-full bg-panel px-4 text-[14.5px] font-medium text-text transition-colors hover:bg-raised"
        >
          <span className="truncate">Connect apps</span>
          <AppGlyphs />
        </Link>
      </div>
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
    isGuest?: boolean
  }
  role: OrgRole
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const desktopApp = useDesktopApp()
  const wide = useWideScreen()
  const [listOpen, toggleList] = useListOpen()
  const [titlebarSlot, setTitlebarSlot] = useState<HTMLDivElement | null>(null)

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

  const sidebarProps = {
    org,
    orgs,
    chats,
    bots,
    user,
    role,
    pathname,
    inboxCount,
    onOpenPalette: () => setPaletteOpen(true),
  }

  return (
    <UpdateProvider>
      <TitlebarSlotContext.Provider value={wide ? titlebarSlot : null}>
      <div className="flex h-dvh flex-col overflow-hidden bg-ink md:bg-void">
        <div className="hidden md:block">
          <Titlebar
            orgSlug={org.slug}
            chats={chats}
            pages={ALL_PAGES}
            pathname={pathname}
            currentRoomId={currentRoomId}
            desktopApp={desktopApp}
            listOpen={listOpen}
            onToggleList={toggleList}
            slotRef={setTitlebarSlot}
          />
        </div>

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

        {user.isGuest ? <GuestBanner orgSlug={org.slug} /> : null}

        <div className="flex min-h-0 flex-1">
          <div className="hidden md:flex">
            <IconRail
              orgSlug={org.slug}
              pathname={pathname}
              inboxCount={inboxCount}
              morePages={RAIL_MORE_PAGES}
              onOpenPalette={() => setPaletteOpen(true)}
              account={<AccountMenu base={`/${org.slug}`} user={user} role={role} compact />}
            />
          </div>

          <div className="flex min-w-0 flex-1 overflow-hidden bg-ink md:mb-2 md:mr-2 md:rounded-2xl md:border md:border-line">
            {listOpen ? (
              <aside
                className="hidden w-[300px] shrink-0 flex-col border-r border-line pt-3 md:flex"
                aria-label="Chats"
              >
                <ChatList
                  orgSlug={org.slug}
                  items={chats}
                  bots={bots}
                  newChatHref={`/${org.slug}/chats/new`}
                />
              </aside>
            ) : null}

            <main
              id="main-content"
              tabIndex={-1}
              className="min-h-0 min-w-0 flex-1 bg-ink outline-none"
            >
              {children}
            </main>
          </div>
        </div>

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          orgSlug={org.slug}
          role={role}
          chats={chats}
          bots={bots}
          pages={ALL_PAGES}
        />

        <dialog
          ref={dialogRef}
          className="m-0 h-dvh max-h-none w-[88vw] max-w-[340px] bg-ink p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-text backdrop:bg-void/70"
          onClose={() => setMobileOpen(false)}
          onClick={(event) => {
            if (event.target === dialogRef.current) setMobileOpen(false)
          }}
        >
          <Sidebar
            {...sidebarProps}
            desktopApp={false}
            onNavigate={() => setMobileOpen(false)}
            headerExtra={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setMobileOpen(false)}
                aria-label="Close workspace menu"
              >
                <CloseIcon width={15} height={15} />
              </Button>
            }
          />
        </dialog>
      </div>
      </TitlebarSlotContext.Provider>
    </UpdateProvider>
  )
}
