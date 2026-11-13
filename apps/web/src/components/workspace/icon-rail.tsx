"use client"

import Link from "next/link"
import type { ComponentType, ReactNode } from "react"
import {
  Bot,
  ChartSpline,
  CircleHelp,
  Ellipsis,
  GalleryVerticalEnd,
  ListChecks,
  Settings,
  Store,
  Workflow,
} from "lucide-react"
import { DetailsMenu } from "@/components/ui/details-menu"
import { RailPlanRings } from "@/components/usage/plan-rings"
import { cn } from "@/lib/format"

type Icon = ComponentType<{ className?: string }>

export interface RailPage {
  key: string
  href: string
  label: string
  icon: Icon
}

const railButton =
  "relative grid h-11 w-11 place-items-center rounded-xl text-muted transition-colors hover:bg-panel hover:text-text"

function RailLink({
  href,
  label,
  icon: IconComponent,
  active,
  badge = 0,
}: {
  href: string
  label: string
  icon: Icon
  active: boolean
  badge?: number
}) {
  return (
    <Link
      href={href}
      aria-label={badge ? `${label}, ${badge} waiting` : label}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cn(railButton, active && "bg-raised text-text hover:bg-raised")}
    >
      <IconComponent className="h-[21px] w-[21px]" />
      {badge > 0 ? (
        <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-void shadow-[0_0_0_2px_var(--color-void)]">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  )
}

/** The narrow strip on the far left: where you are, and the places you go most. */
export function IconRail({
  orgSlug,
  pathname,
  inboxCount,
  morePages,
  onOpenPalette,
  account,
}: {
  orgSlug: string
  pathname: string
  inboxCount: number
  /** Everything that does not earn a spot of its own, behind the “more” button. */
  morePages: RailPage[]
  onOpenPalette: () => void
  account: ReactNode
}) {
  const base = `/${orgSlug}`
  const at = (href: string) => pathname.startsWith(`${base}${href}`)
  const inChats =
    pathname === base || pathname === `${base}/` || at("/r/") || at("/chats") || at("/agents")

  const top: { key: string; href: string; label: string; icon: Icon; active: boolean; badge?: number }[] = [
    { key: "chats", href: base, label: "Chats", icon: Bot, active: inChats },
    { key: "cron", href: `${base}/cron`, label: "Routines", icon: Workflow, active: at("/cron") },
    { key: "tasks", href: `${base}/tasks`, label: "To-dos", icon: ListChecks, active: at("/tasks") },
    { key: "usage", href: `${base}/analytics`, label: "Usage", icon: ChartSpline, active: at("/analytics") },
    {
      key: "inbox",
      href: `${base}/inbox`,
      label: "Inbox",
      icon: GalleryVerticalEnd,
      active: at("/inbox"),
      badge: inboxCount,
    },
  ]
  const moreActive = morePages.some((page) => at(page.href))

  return (
    <nav
      aria-label="Workspace"
      className="flex h-full w-[68px] shrink-0 flex-col items-center gap-1.5 bg-void pb-3 pt-1"
    >
      {top.map(({ key, ...item }) => (
        <RailLink key={key} {...item} />
      ))}

      <DetailsMenu
        className="relative"
        summaryLabel="More places"
        summaryClassName={cn(
          railButton,
          "cursor-pointer list-none",
          moreActive && "bg-raised text-text hover:bg-raised",
        )}
        summary={<Ellipsis className="h-[21px] w-[21px]" />}
      >
        <div className="absolute left-full top-0 z-50 ml-2 w-56 overflow-hidden rounded-2xl border border-line-strong bg-panel p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.55)]">
          {morePages.map((page) => (
            <Link
              key={page.key}
              href={`${base}${page.href}`}
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13.5px] text-muted transition-colors hover:bg-raised hover:text-text"
            >
              <page.icon className="h-4 w-4 text-faint" />
              {page.label}
            </Link>
          ))}
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            onClick={onOpenPalette}
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] text-muted transition-colors hover:bg-raised hover:text-text"
          >
            <span className="flex-1">Go anywhere</span>
            <kbd className="font-sans text-[11px] text-faint">⌘K</kbd>
          </button>
        </div>
      </DetailsMenu>

      <div className="flex-1" />

      <RailPlanRings usageHref={`${base}/analytics`} />

      <div className="mt-1 flex flex-col items-center gap-1.5">
        <RailLink
          href={`${base}/marketplace`}
          label="Find more agents"
          icon={Store}
          active={at("/marketplace")}
        />
        <Link href="/help" aria-label="Help" title="Help" className={railButton}>
          <CircleHelp className="h-[21px] w-[21px]" />
        </Link>
        <RailLink href={`${base}/settings`} label="Settings" icon={Settings} active={at("/settings")} />
      </div>

      <div className="my-1.5 h-px w-8 bg-line" aria-hidden="true" />

      {account}
    </nav>
  )
}
