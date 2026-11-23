"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react"
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  BarChart3,
  BellOff,
  BellRing,
  Bot,
  Cable,
  Crown,
  Gauge,
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
  Settings2,
  SlidersHorizontal,
  Store,
  Users,
  Zap,
} from "lucide-react"
import { useAppUpdate } from "@/components/update-notification"
import { PlanRing, describeLimits, usePlanLimits } from "@/components/usage/plan-rings"
import { signOutAction } from "@/lib/actions/auth"
import { openBotDmAction, setChatPreferenceAction } from "@/lib/actions/room-state"
import { Avatar } from "@/components/ui/avatar"
import { DetailsMenu } from "@/components/ui/details-menu"
import { Mascot } from "@/components/ui/mascot"
import { showToast } from "@/components/ui/toast"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn, formatTokens } from "@/lib/format"
import type { ChatListItem, OrgRole, OrgSummary } from "@/lib/types"
import type { SidebarUsage } from "@/lib/sidebar-usage"

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

const popover = "surface-pop pop-in absolute z-50 overflow-hidden rounded-2xl p-1.5"

const popoverItem =
  "flex w-full items-center gap-2.5 truncate rounded-xl px-2.5 py-2 text-left text-[13.5px] text-muted transition-colors hover:bg-raised hover:text-text disabled:opacity-50"

/** The everyday extras, tucked under "Tools" so the top of the sidebar stays about your bots. */
const TOOLS: { key: string; href: string; label: string; icon: typeof Zap }[] = [
  { key: "cron", href: "/cron", label: "Routines", icon: Zap },
  { key: "tasks", href: "/tasks", label: "To-dos", icon: CheckSquare },
  { key: "files", href: "/files", label: "Files", icon: FolderClosed },
  { key: "agents", href: "/agents", label: "Team", icon: Users },
  { key: "connectors", href: "/connectors", label: "Connectors", icon: Cable },
  { key: "bot-store", href: "/bot-store", label: "Bot store", icon: Store },
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
  count,
  action,
  children,
}: {
  id: string
  label: string
  count?: number
  action?: ReactNode
  children: ReactNode
}) {
  const [folded, toggle] = useFolded(id)
  return (
    <section className="mt-4 first:mt-2">
      <div className="group/section flex h-7 items-center gap-1 px-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!folded}
          className="flex items-center gap-1.5 rounded-md text-[11px] font-semibold uppercase tracking-[0.08em] text-faint transition-colors hover:text-text"
        >
          <ChevronDown
            className={cn("h-3 w-3 transition-transform duration-200", folded && "-rotate-90")}
          />
          {label}
          {count ? (
            <span className="rounded-full bg-text/[0.06] px-1.5 py-px text-[10px] font-medium tabular-nums tracking-normal text-faint">
              {count}
            </span>
          ) : null}
        </button>
        <span className="ml-auto opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100 max-md:opacity-100">
          {action}
        </span>
      </div>
      {folded ? null : <div className="mt-0.5">{children}</div>}
    </section>
  )
}

function RowFace({ item }: { item: ChatListItem }) {
  if (item.isBotDm || item.orchestrator) {
    return (
      <Mascot
        seed={item.agentNames[0] ?? item.name}
        crown={item.orchestrator}
        className="h-8 w-8 shrink-0"
      />
    )
  }
  return (
    <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-text/[0.06] text-[13px] font-semibold text-muted ring-1 ring-inset ring-text/[0.04]">
      {item.kind === "public" ? "#" : item.name.slice(0, 1).toUpperCase()}
      {item.agentNames[0] ? (
        <Mascot seed={item.agentNames[0]} className="absolute -bottom-1 -right-1 h-4 w-4" />
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
          "relative flex items-center gap-2.5 rounded-xl px-2 py-[7px] transition-colors",
          active
            ? "bg-text/[0.07] before:absolute before:inset-y-2 before:-left-2.5 before:w-[3px] before:rounded-r-full before:bg-accent"
            : "hover:bg-text/[0.035]",
        )}
      >
        <RowFace item={item} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                "truncate text-[13.5px] leading-5",
                unread ? "font-semibold text-text" : "font-medium text-text/90",
              )}
            >
              {item.name}
            </span>
            {item.pinned ? (
              <Pin className="h-3 w-3 shrink-0 self-center text-faint" aria-label="Pinned" />
            ) : null}
            <span
              suppressHydrationWarning
              className="ml-auto shrink-0 text-[11px] tabular-nums text-faint md:group-hover:opacity-0 md:group-focus-within:opacity-0"
            >
              {shortTime(item.lastAt)}
            </span>
          </span>
          <span className="mt-px flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 truncate text-[12px] leading-4",
                unread ? "text-muted" : "text-faint",
              )}
            >
              {item.lastMessage ?? (item.isBotDm ? "Say hello" : "No messages yet")}
            </span>
            {item.mentionCount > 0 ? (
              <span className="ml-auto grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-accent px-1 text-[11px] font-medium text-void">
                {item.mentionCount}
              </span>
            ) : unread && !muted ? (
              <span
                className="ml-auto h-2 w-2 shrink-0 rounded-full bg-accent"
                aria-label={`${item.unreadCount} unread`}
              />
            ) : muted ? (
              <BellOff className="ml-auto h-3 w-3 shrink-0 text-faint" aria-label="Muted" />
            ) : null}
          </span>
        </span>
      </Link>

      <DetailsMenu
        className="absolute right-1 top-1/2 -translate-y-1/2"
        summaryLabel={`Options for ${item.name}`}
        summaryClassName="grid h-7 w-7 cursor-pointer list-none place-items-center rounded-lg text-faint opacity-100 transition-opacity hover:bg-hover hover:text-text md:opacity-0 md:group-hover:opacity-100 [[open]>&]:opacity-100"
        summary={<Ellipsis className="h-4 w-4" />}
      >
        <div className={cn(popover, "right-0 top-8 w-56")}>
          {item.isBotDm && item.agentId ? (
            <Link href={`${href}?configure=1`} onClick={onNavigate} className={popoverItem}>
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
            {item.pinned ? (
              <PinOff className="h-4 w-4 text-faint" />
            ) : (
              <Pin className="h-4 w-4 text-faint" />
            )}
            {item.pinned ? "Unpin" : "Pin to top"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onAction("mark_unread")}
            className={popoverItem}
          >
            <MailOpen className="h-4 w-4 text-faint" />
            Mark as unread
          </button>
          {muted ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => onAction("unmute")}
              className={popoverItem}
            >
              <BellRing className="h-4 w-4 text-faint" />
              Unmute
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => onAction("mute", "8h")}
                className={popoverItem}
              >
                <BellOff className="h-4 w-4 text-faint" />
                Mute for 8 hours
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => onAction("mute", "always")}
                className={popoverItem}
              >
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
function NewBotRow({
  bot,
  orgSlug,
  onNavigate,
}: {
  bot: BotLink
  orgSlug: string
  onNavigate?: () => void
}) {
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
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-[7px] text-left transition-colors hover:bg-text/[0.035] disabled:opacity-60"
      >
        <Mascot seed={bot.displayName} className="h-8 w-8 shrink-0 opacity-90" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium leading-5 text-text/90">
              {bot.displayName}
            </span>
            {bot.kind === "external" ? (
              <span className="shrink-0 rounded-md bg-raised px-1.5 py-px text-[10.5px] text-muted">
                MCP
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              "mt-px block truncate text-[12px] leading-4",
              error ? "text-danger" : "text-faint",
            )}
          >
            {pending ? "Opening…" : (error ?? "Say hi")}
          </span>
        </span>
      </button>
    </li>
  )
}

/** Which workspace you are in, as a small pill at the top. */
function WorkspaceSwitcher({
  org,
  orgs,
}: {
  org: { slug: string; name: string }
  orgs: OrgSummary[]
}) {
  const seen = new Set<string>()
  const list = orgs.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
  const nameCount = new Map<string, number>()
  for (const item of list) nameCount.set(item.name, (nameCount.get(item.name) ?? 0) + 1)

  return (
    <DetailsMenu
      className="group min-w-0"
      summaryLabel={`${org.name}: switch workspace`}
      summaryClassName="flex h-9 min-w-0 max-w-full cursor-pointer list-none items-center gap-2 rounded-xl px-1.5 text-[14px] font-semibold tracking-[-0.01em] text-text transition-colors hover:bg-text/[0.06] group-open:bg-text/[0.08]"
      summary={
        <>
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-text/[0.07]">
            <Mascot seed={org.name} mood="happy" className="h-5 w-5" />
          </span>
          <span className="truncate">{org.name}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" />
        </>
      }
    >
      {/* The header is the positioning parent, so the menu spans the sidebar
          instead of starting under the traffic lights and covering half the search field. */}
      <div className={cn(popover, "left-2.5 right-2.5 top-full z-50 mt-1 w-auto")}>
        <p className="px-2.5 pb-1 pt-1 text-[12px] text-faint">Your workspaces</p>
        {list.map((item) => (
          <Link
            key={item.id}
            href={`/${item.slug}`}
            className={cn(popoverItem, item.slug === org.slug && "bg-raised text-text")}
          >
            <Mascot seed={item.name} className="h-6 w-6 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            {(nameCount.get(item.name) ?? 0) > 1 ? (
              <span className="shrink-0 truncate text-[11px] text-faint">{item.slug}</span>
            ) : null}
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
  const { updateReady, applyUpdate, checkForUpdates, checking, appVersion, desktop } =
    useAppUpdate()
  return (
    <DetailsMenu
      className="relative min-w-0 flex-1"
      summaryLabel="Your account"
      summaryClassName="flex h-10 min-w-0 cursor-pointer list-none items-center gap-2.5 rounded-xl px-1.5 transition-colors hover:bg-text/[0.05]"
      summary={
        <>
          <span className="relative shrink-0">
            <Avatar name={user.displayName} src={user.avatarUrl} kind="human" size="md" />
            {updateReady ? (
              <span
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-ok shadow-[0_0_0_2px_var(--color-ink)]"
                aria-label="Update ready"
              />
            ) : null}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium leading-5 text-text">
              {user.displayName}
            </span>
            <span className="block truncate text-[11px] capitalize leading-4 text-faint">
              {user.isGuest ? "Guest" : role}
            </span>
          </span>
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
            {desktop?.status === "available"
              ? `Install Sayabot ${desktop.latest}`
              : "Reload for the new version"}
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
        <div className="py-1">
          <ThemeToggle variant="menu-item" />
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

/** Saya gets her own card: she runs the workspace, so she sits above every list. */
function OrchestratorCard({
  item,
  orgSlug,
  active,
  onNavigate,
}: {
  item: ChatListItem
  orgSlug: string
  active: boolean
  onNavigate?: () => void
}) {
  const unread = item.unreadCount > 0
  return (
    <Link
      href={`/${orgSlug}/r/${item.id}`}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      data-testid="room-link"
      data-room-name={item.name}
      className={cn(
        "group/saya relative mt-1 flex items-center gap-3 overflow-hidden rounded-2xl p-2.5 pr-3 transition-all",
        "bg-[linear-gradient(135deg,rgba(157,140,255,0.16),rgba(110,180,255,0.07)_55%,rgba(255,255,255,0.02))]",
        "ring-1 ring-inset",
        active ? "ring-accent/50" : "ring-text/[0.07] hover:ring-accent/30",
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-accent/20 blur-2xl transition-opacity group-hover/saya:opacity-100 md:opacity-60"
      />
      <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-void/60">
        <Mascot seed={item.agentNames[0] ?? item.name} crown live className="h-9 w-9" />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate text-[14px] text-text",
              unread ? "font-semibold" : "font-medium",
            )}
          >
            {item.name}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] text-warn">
            <Crown className="h-2.5 w-2.5" aria-hidden="true" />
            Lead
          </span>
          {item.mentionCount > 0 ? (
            <span className="ml-auto grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-void">
              {item.mentionCount}
            </span>
          ) : unread ? (
            <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-muted">
          {item.lastMessage ?? "Ask me to set up bots, rooms and routines"}
        </span>
      </span>
    </Link>
  )
}

/** Usage, a tap away: Mac plan rings when there are readings, this month's numbers otherwise. */
function UsageRow({
  href,
  usage,
  active,
  onNavigate,
}: {
  href: string
  usage: SidebarUsage | null
  active: boolean
  onNavigate?: () => void
}) {
  const { supported, limits } = usePlanLimits()
  const rings = supported ? (limits ?? []).filter((item) => item.windows.length > 0) : []
  const planShare = usage?.plan
    ? Math.min(1, usage.plan.used / Math.max(1, usage.plan.limit))
    : null
  const title = [
    ...rings.map(describeLimits),
    usage
      ? `This month: ${usage.replies.toLocaleString()} replies, ${formatTokens(usage.tokens)} tokens, $${usage.costUsd.toFixed(2)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n")

  return (
    <Link
      href={href}
      prefetch={true}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={title || "Usage"}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-[13.5px] font-medium transition-colors",
        active ? "bg-text/[0.07] text-text" : "text-text/90 hover:bg-text/[0.035]",
      )}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-text/[0.06]">
        <Gauge className="h-4 w-4 text-muted" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block leading-5">Usage</span>
        {planShare !== null ? (
          <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-text/[0.07]">
            <span
              className={cn(
                "block h-full rounded-full",
                planShare >= 0.9 ? "bg-danger" : planShare >= 0.75 ? "bg-warn" : "bg-accent",
              )}
              style={{ width: `${Math.max(3, planShare * 100)}%` }}
            />
          </span>
        ) : null}
      </span>
      {rings.length ? (
        <span className="flex shrink-0 items-center -space-x-0.5" aria-hidden="true">
          {rings.map((item) => (
            <span key={item.provider} className="grid h-6 w-6 place-items-center">
              <PlanRing limits={item} size={20} glyph={0.5} stroke={1.5} />
            </span>
          ))}
        </span>
      ) : usage ? (
        <span className="shrink-0 text-right text-[11px] font-normal leading-tight tabular-nums text-faint">
          <span className="block text-muted">{formatTokens(usage.tokens)} tok</span>
          <span className="block">${usage.costUsd.toFixed(2)}</span>
        </span>
      ) : null}
    </Link>
  )
}

function ToolsGrid({
  base,
  pathname,
  onNavigate,
}: {
  base: string
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <nav aria-label="Tools" className="grid grid-cols-3 gap-1 pb-1">
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
              "group/tool flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors",
              active
                ? "bg-text/[0.08] text-text"
                : "text-muted hover:bg-text/[0.04] hover:text-text",
            )}
          >
            <tool.icon
              className={cn(
                "h-[17px] w-[17px] transition-transform group-hover/tool:-translate-y-px",
                active ? "text-accent" : "text-faint group-hover/tool:text-text",
              )}
            />
            <span className="truncate">{tool.label}</span>
          </Link>
        )
      })}
    </nav>
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
  usage = null,
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
  usage?: SidebarUsage | null
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
      if (
        event.key.toLowerCase() !== "n" ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey
      )
        return
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

  const live = useMemo(
    () => chats.filter((item) => !item.archived && matches(item)),
    [chats, matches],
  )
  const archived = useMemo(
    () => chats.filter((item) => item.archived && matches(item)),
    [chats, matches],
  )
  const orchestratorChats = live.filter((item) => item.orchestrator)
  const pinned = live.filter((item) => item.pinned && !item.orchestrator)
  const botChats = live.filter((item) => item.isBotDm && !item.pinned && !item.orchestrator)
  const groupChats = live.filter((item) => !item.isBotDm && !item.pinned && !item.orchestrator)

  const dmAgentIds = new Set(
    chats.filter((item) => item.isBotDm && item.agentId).map((item) => item.agentId),
  )
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
        showToast({
          message: "Chat archived",
          action: { label: "Undo", onClick: () => act(roomId, "unarchive") },
        })
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
      prefetch={true}
      onClick={onNavigate}
      aria-label={label}
      title={label}
      className="grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-hover hover:text-text"
    >
      <Plus className="h-3.5 w-3.5" />
    </Link>
  )
  const nothing =
    !orchestratorChats.length &&
    !pinned.length &&
    !botChats.length &&
    !groupChats.length &&
    !newBots.length

  const usageActive = pathname.startsWith(`${base}/analytics`)
  const orchestrator = orchestratorChats[0] ?? null

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden [-webkit-app-region:no-drag]">
      {/* A soft wash of colour at the top, so the sidebar feels like a place, not a table. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(157,140,255,0.12),transparent_60%),radial-gradient(90%_70%_at_100%_0%,rgba(110,180,255,0.07),transparent_65%)]"
      />

      <div
        className={cn(
          "relative z-30 flex h-14 shrink-0 items-center gap-1 px-2.5",
          desktopApp && "pl-[84px] [-webkit-app-region:drag]",
        )}
      >
        {headerExtra}
        <div className="min-w-0 flex-1 [-webkit-app-region:no-drag]">
          <WorkspaceSwitcher org={org} orgs={orgs} />
        </div>
        <DetailsMenu
          className="shrink-0 [-webkit-app-region:no-drag]"
          summaryLabel="New bot or group chat"
          summaryClassName="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-xl bg-text/[0.06] text-text transition-colors hover:bg-accent hover:text-void"
          summary={<Plus className="h-[18px] w-[18px]" />}
        >
          <div className={cn(popover, "right-2.5 top-full z-50 mt-1 w-60")}>
            <Link href={`${base}/agents/new`} onClick={onNavigate} className={popoverItem}>
              <Bot className="h-4 w-4 text-faint" />
              <span className="flex-1">New bot</span>
              <kbd className="rounded-md border border-line-strong px-1.5 font-sans text-[10.5px] text-faint">
                ⌘N
              </kbd>
            </Link>
            <Link href={`${base}/chats/new`} onClick={onNavigate} className={popoverItem}>
              <Users className="h-4 w-4 text-faint" />
              New group chat
            </Link>
            {orchestrator ? (
              <Link
                href={`${base}/r/${orchestrator.id}`}
                onClick={onNavigate}
                className={popoverItem}
              >
                <Crown className="h-4 w-4 text-warn" />
                Ask Saya to set it up
              </Link>
            ) : null}
          </div>
        </DetailsMenu>
      </div>

      <div className="relative shrink-0 space-y-1 px-2.5">
        <label className="flex h-9 items-center gap-2.5 rounded-xl bg-text/[0.05] px-3 ring-1 ring-inset ring-text/[0.04] transition-colors focus-within:bg-text/[0.08] focus-within:ring-accent/40">
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
            className="w-full min-w-0 bg-transparent text-[13.5px] text-text outline-none placeholder:text-faint"
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

        <nav aria-label="Workspace" className="pt-1">
          <Link
            href={`${base}/inbox`}
            onClick={onNavigate}
            aria-current={inboxActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-[13.5px] font-medium transition-colors",
              inboxActive ? "bg-text/[0.07] text-text" : "text-text/90 hover:bg-text/[0.035]",
            )}
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-text/[0.06]">
              <Inbox className="h-4 w-4 text-muted" />
            </span>
            <span className="flex-1 leading-5">Inbox</span>
            {inboxCount > 0 ? (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-void">
                {inboxCount > 99 ? "99+" : inboxCount}
              </span>
            ) : null}
          </Link>
          <UsageRow
            href={`${base}/analytics`}
            usage={usage}
            active={usageActive}
            onNavigate={onNavigate}
          />
        </nav>

        {orchestrator ? (
          <OrchestratorCard
            item={orchestrator}
            orgSlug={org.slug}
            active={pathname.startsWith(`${base}/r/${orchestrator.id}`)}
            onNavigate={onNavigate}
          />
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-3 pt-1 [scrollbar-width:thin]">
        {orchestratorChats.length > 1 || pinned.length ? (
          <Section id="pinned" label="Pinned" count={pinned.length || undefined}>
            <ul className="space-y-px">{[...orchestratorChats.slice(1), ...pinned].map(row)}</ul>
          </Section>
        ) : null}

        {botChats.length || newBots.length || !needle ? (
          <Section
            id="bots"
            label="Bots"
            count={botChats.length + newBots.length || undefined}
            action={sectionAction(`${base}/agents/new`, "New bot")}
          >
            <ul className="space-y-px">
              {botChats.map(row)}
              {newBots.map((bot) => (
                <NewBotRow key={bot.id} bot={bot} orgSlug={org.slug} onNavigate={onNavigate} />
              ))}
            </ul>
            {!botChats.length && !newBots.length && !needle ? (
              <Link
                href={`${base}/agents/new`}
                onClick={onNavigate}
                className="mt-1 flex items-center gap-2.5 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-[12.5px] text-muted transition-colors hover:border-accent/50 hover:text-text"
              >
                <Mascot seed="Pip" mood="happy" className="h-6 w-6" />
                Make your first bot
              </Link>
            ) : null}
          </Section>
        ) : null}

        {groupChats.length || !needle ? (
          <Section
            id="groups"
            label="Group chats"
            count={groupChats.length || undefined}
            action={sectionAction(`${base}/chats/new`, "New group chat")}
          >
            <ul className="space-y-px">{groupChats.map(row)}</ul>
            {!groupChats.length && !needle ? (
              <Link
                href={`${base}/chats/new`}
                onClick={onNavigate}
                className="mt-1 flex items-center gap-2.5 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-[12.5px] text-muted transition-colors hover:border-accent/50 hover:text-text"
              >
                <Plus className="h-4 w-4" />
                Start a group chat and invite bots
              </Link>
            ) : null}
          </Section>
        ) : null}

        {archived.length ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowArchived((open) => !open)}
              aria-expanded={showArchived}
              className="flex h-7 items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint hover:text-text"
            >
              <Archive className="h-3 w-3" />
              Archived
              <span className="rounded-full bg-text/[0.06] px-1.5 py-px text-[10px] font-medium tracking-normal">
                {archived.length}
              </span>
            </button>
            {showArchived ? <ul className="space-y-px opacity-80">{archived.map(row)}</ul> : null}
          </div>
        ) : null}

        {nothing && needle ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <Mascot seed="Hoot" mood="thinking" className="h-10 w-10" />
            <p className="text-[12.5px] leading-relaxed text-faint">
              Nothing matches. Press Enter to search every message.
            </p>
          </div>
        ) : null}
      </div>

      <div className="relative shrink-0 border-t border-text/[0.06] px-2.5 pt-1">
        <Section id="tools" label="Tools">
          <ToolsGrid base={base} pathname={pathname} onNavigate={onNavigate} />
        </Section>
      </div>

      {user.isGuest ? (
        <div className="relative shrink-0 px-2.5 pt-1">
          <Link
            href={`/auth/save-account?next=${encodeURIComponent(base)}`}
            onClick={onNavigate}
            className="flex items-center gap-2.5 rounded-xl bg-accent/10 px-3 py-2 text-[12px] leading-snug text-muted ring-1 ring-inset ring-accent/20 transition-colors hover:bg-accent/15 hover:text-text"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-text">Save your account</span>
              <span className="block truncate">Keep your bots on phone and web</span>
            </span>
          </Link>
        </div>
      ) : null}

      <div className="relative flex shrink-0 items-center gap-1 px-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
        <AccountRow base={base} user={user} role={role} />
        <Link
          href={`${base}/settings`}
          prefetch={true}
          onClick={onNavigate}
          aria-label="Settings"
          title="Settings"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-text/[0.05] hover:text-text"
        >
          <Settings2 className="h-[17px] w-[17px]" />
        </Link>
      </div>
    </div>
  )
}
