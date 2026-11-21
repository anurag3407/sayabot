"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import {
  ArrowLeft,
  Bot,
  Cable,
  CalendarClock,
  CheckSquare,
  FolderClosed,
  Inbox,
  MessageCircle,
  Search,
  Store,
  Users,
} from "lucide-react"
import { UpdateProvider } from "@/components/update-notification"
import { Button } from "@/components/ui/button"
import { SayabotMark } from "@/components/landing/sayabot-mark"
import { AppSidebar, type BotLink } from "@/components/workspace/sidebar"
import { CommandPalette } from "@/components/command-palette"
import { useWorkspaceActivity } from "@/components/use-workspace-activity"
import { cn } from "@/lib/format"
import { CloseIcon, MenuIcon } from "@/components/ui/icons"
import { PlanUsageBanner } from "@/components/plan-usage-banner"
import type { ChatListItem, OrgRole, OrgSummary } from "@/lib/types"
import type { SidebarUsage } from "@/lib/sidebar-usage"

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
  { key: "connectors", href: "/connectors", label: "Connectors", icon: Cable },
  { key: "bot-store", href: "/bot-store", label: "Bot store", icon: Store },
  { key: "search", href: "/search", label: "Search", icon: Search },
]

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

/**
 * Back: one step through what you opened in this window, or up to the workspace home when there
 * is nothing to go back to (a fresh window, a link from elsewhere). Hidden on the home itself.
 */
function BackButton({ home, className }: { home: string; className?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const steps = useRef(-1)
  useEffect(() => {
    steps.current += 1
  }, [pathname])
  if (pathname === home) return null
  return (
    <button
      type="button"
      onClick={() => {
        if (steps.current > 0) {
          steps.current -= 2
          router.back()
        } else {
          router.push(home)
        }
      }}
      aria-label="Go back"
      title="Back (⌘[)"
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-white/5 hover:text-text [-webkit-app-region:no-drag]",
        className,
      )}
    >
      <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
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
  planUsage = null,
  usage = null,
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
  /** Sayabot Cloud: month's server replies at 80%+ (admins only). */
  planUsage?: { used: number; limit: number; planName: string } | null
  /** This month's replies, tokens and spend for the sidebar's Usage row. */
  usage?: SidebarUsage | null
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const desktopApp = useDesktopApp()
  const router = useRouter()
  const home = `/${org.slug}`

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
      // ⌘[ goes back, like every Mac app. Not while typing, where it indents.
      const typing = (event.target as HTMLElement | null)?.closest(
        "input, textarea, [contenteditable]",
      )
      if (event.metaKey && event.key === "[" && !typing) {
        event.preventDefault()
        router.back()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [router])

  const sidebarProps = {
    org,
    orgs,
    chats,
    bots,
    user,
    role,
    inboxCount,
    usage,
    onOpenPalette: () => setPaletteOpen(true),
  }

  return (
    <UpdateProvider>
      <div className="flex h-dvh flex-col overflow-hidden bg-void">
        <div className="flex shrink-0 items-center gap-2 bg-ink px-2 pb-1 pt-[max(0.25rem,env(safe-area-inset-top))] md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
            aria-label="Open workspace menu"
          >
            <MenuIcon />
          </Button>
          <BackButton home={home} className="h-10 w-10" />
          <SayabotMark className="h-6 w-6" />
          <span className="truncate text-[14px] text-text">{org.name}</span>
          {inboxCount + totalUnread > 0 ? (
            <span className="ml-auto mr-2 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-medium text-void">
              {inboxCount + totalUnread > 99 ? "99+" : inboxCount + totalUnread}
            </span>
          ) : null}
        </div>

        {planUsage ? <PlanUsageBanner orgSlug={org.slug} {...planUsage} /> : null}

        {/* In the Mac app the window has no title bar: the dark gutters are what you drag. */}
        <div className={cn("flex min-h-0 flex-1", desktopApp && "[-webkit-app-region:drag]")}>
          <aside
            className="hidden w-[272px] shrink-0 border-r border-line/70 bg-void md:flex md:flex-col lg:w-[288px]"
            aria-label="Sidebar"
          >
            <AppSidebar
              {...sidebarProps}
              desktopApp={desktopApp}
              headerExtra={<BackButton home={home} />}
            />
          </aside>

          <main
            id="main-content"
            tabIndex={-1}
            className={cn(
              "min-h-0 min-w-0 flex-1 overflow-hidden bg-ink outline-none",
              desktopApp && "[-webkit-app-region:no-drag]",
            )}
          >
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
          pages={ALL_PAGES}
        />

        <dialog
          ref={dialogRef}
          className="m-0 h-dvh max-h-none w-[88vw] max-w-[340px] bg-void p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-text backdrop:bg-void/70"
          onClose={() => setMobileOpen(false)}
          onClick={(event) => {
            if (event.target === dialogRef.current) setMobileOpen(false)
          }}
        >
          <AppSidebar
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
    </UpdateProvider>
  )
}
