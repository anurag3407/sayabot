"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/format"

const links = [
  { segment: "keys", label: "Provider keys" },
  { segment: "vector", label: "Vector & RAG" },
  { segment: "vault", label: "Secret Vault" },
  { segment: "tools", label: "Tools & MCP" },
  { segment: "bots", label: "External agents" },
  { segment: "pricing", label: "Pricing" },
]

export function SettingsNav({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname()
  return (
    <nav
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line pb-2"
      aria-label="Workspace settings"
    >
      {links.map((link) => {
        const href = `/${orgSlug}/settings/${link.segment}`
        const active = pathname.startsWith(href)
        return (
          <Link
            key={link.segment}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 pb-1 font-mono text-[12px] transition-colors",
              active
                ? "border-accent text-text"
                : "border-transparent text-muted hover:text-text",
            )}
          >
            {link.label}
          </Link>
        )
      })}
      <Link
        href={`/${orgSlug}/admin`}
        className="border-b-2 border-transparent pb-1 font-mono text-[12px] text-muted hover:text-text"
      >
        Workspace & members
      </Link>
    </nav>
  )
}
