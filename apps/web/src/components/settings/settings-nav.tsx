"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/format"
import { visibleSettingsGroups } from "@/lib/settings-nav"
import { SETTINGS_ICONS } from "@/components/settings/settings-icons"

/**
 * Desktop: a grouped vertical sidebar. Phone: one horizontally scrolling row of chips, so every
 * section stays one tap away without a second menu.
 */
export function SettingsNav({ orgSlug, isAdmin }: { orgSlug: string; isAdmin: boolean }) {
  const pathname = usePathname()
  const base = `/${orgSlug}/settings`
  const groups = visibleSettingsGroups(isAdmin)
  const overviewActive = pathname === base

  const itemClass = (active: boolean) =>
    cn(
      "flex shrink-0 items-center gap-2.5 rounded-sm px-2.5 text-[13px] transition-colors",
      "h-9 md:h-8",
      active ? "bg-raised text-text" : "text-muted hover:bg-panel hover:text-text",
    )

  return (
    <nav aria-label="Settings" className="md:w-52 md:shrink-0">
      <div className="-mx-5 flex gap-1 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:mx-0 md:flex-col md:gap-0 md:overflow-visible md:px-0">
        <Link
          href={base}
          aria-current={overviewActive ? "page" : undefined}
          className={itemClass(overviewActive)}
        >
          Overview
        </Link>
        {groups.map((group) => (
          <div key={group.label} className="contents md:mt-5 md:block">
            <p className="hidden px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-faint md:block">
              {group.label}
            </p>
            {group.links.map((link) => {
              const href = `${base}/${link.segment}`
              const active = pathname === href || pathname.startsWith(`${href}/`)
              const Icon = SETTINGS_ICONS[link.icon]
              return (
                <Link
                  key={link.segment}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(itemClass(active), "md:w-full")}
                >
                  <Icon
                    className={cn("hidden h-4 w-4 md:block", active ? "text-accent" : "text-faint")}
                  />
                  <span className="whitespace-nowrap">{link.label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}
