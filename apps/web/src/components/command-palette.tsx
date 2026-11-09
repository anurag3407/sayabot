"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import {
  ArrowRight,
  Bot,
  CornerDownLeft,
  Hash,
  MessageCircle,
  Plus,
  Search,
  Settings2,
} from "lucide-react"
import { cn } from "@/lib/format"
import { visibleSettingsGroups } from "@/lib/settings-nav"
import type { ChatListItem, OrgRole } from "@/lib/types"
import type { BotLink } from "@/components/workspace/chat-list"

type Icon = ComponentType<{ className?: string }>

interface Command {
  id: string
  group: "Actions" | "Chats" | "Agents" | "Go to" | "Settings"
  label: string
  hint?: string
  keywords?: string
  href: string
  icon: Icon
}

const GROUP_ORDER: Command["group"][] = ["Actions", "Chats", "Agents", "Go to", "Settings"]

/** Subsequence match with a bonus for word starts, so "gen" finds "#general" before "agents". */
function score(query: string, text: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const direct = t.indexOf(q)
  if (direct === 0) return 100
  if (direct > 0) return 80 - Math.min(direct, 40) + (/\W/.test(t[direct - 1] ?? "") ? 15 : 0)
  let ti = 0
  let hits = 0
  for (const ch of q) {
    ti = t.indexOf(ch, ti)
    if (ti === -1) return 0
    hits++
    ti++
  }
  return hits === q.length ? 20 : 0
}

export function CommandPalette({
  open,
  onClose,
  orgSlug,
  role,
  chats,
  bots,
  pages,
}: {
  open: boolean
  onClose: () => void
  orgSlug: string
  role: OrgRole
  chats: ChatListItem[]
  bots: BotLink[]
  pages: { key: string; href: string; label: string }[]
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const base = `/${orgSlug}`

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setQuery("")
      setActive(0)
      dialog.showModal()
      requestAnimationFrame(() => inputRef.current?.focus())
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const isAdmin = role === "owner" || role === "admin"
    const list: Command[] = [
      {
        id: "new-chat",
        group: "Actions",
        label: "New chat",
        keywords: "room create start",
        href: `${base}/chats/new`,
        icon: Plus,
      },
      {
        id: "new-agent",
        group: "Actions",
        label: "Create an agent",
        keywords: "bot new",
        href: `${base}/agents/new`,
        icon: Plus,
      },
      {
        id: "search",
        group: "Actions",
        label: "Search messages and files",
        keywords: "find",
        href: `${base}/search`,
        icon: Search,
      },
    ]
    for (const chat of chats.filter((item) => !item.archived)) {
      list.push({
        id: `chat-${chat.id}`,
        group: "Chats",
        label: chat.isBotDm ? chat.name : `#${chat.name}`,
        hint:
          chat.unreadCount > 0
            ? `${chat.unreadCount} unread`
            : chat.agentNames.slice(0, 2).join(", ") || undefined,
        keywords: chat.agentNames.join(" "),
        href: `${base}/r/${chat.id}`,
        icon: chat.isBotDm ? MessageCircle : Hash,
      })
    }
    for (const bot of bots) {
      list.push({
        id: `bot-${bot.id}`,
        group: "Agents",
        label: bot.displayName,
        hint: `@${bot.handle}`,
        keywords: `${bot.handle} ${bot.kind === "external" ? "external" : "agent"}`,
        href: `${base}/agents/${bot.id}`,
        icon: Bot,
      })
    }
    for (const page of pages) {
      list.push({
        id: `page-${page.key}`,
        group: "Go to",
        label: page.label,
        href: `${base}${page.href}`,
        icon: ArrowRight,
      })
    }
    list.push({
      id: "page-usage",
      group: "Go to",
      label: "Usage",
      keywords: "analytics cost tokens",
      href: `${base}/analytics`,
      icon: ArrowRight,
    })
    for (const group of visibleSettingsGroups(isAdmin)) {
      for (const link of group.links) {
        list.push({
          id: `settings-${link.segment}`,
          group: "Settings",
          label: link.label,
          keywords: `settings ${link.description}`,
          href: `${base}/settings/${link.segment}`,
          icon: Settings2,
        })
      }
    }
    return list
  }, [base, bots, chats, pages, role])

  const results = useMemo(() => {
    const q = query.trim()
    const scored = commands
      .map((command) => ({
        command,
        score: Math.max(
          score(q, command.label),
          score(q, command.keywords ?? "") * 0.6,
          score(q, command.hint ?? "") * 0.7,
        ),
      }))
      .filter((item) => item.score > 0)
    if (q) scored.sort((a, b) => b.score - a.score)
    // Without a query keep the list short: actions, a few recent chats, then pages.
    const limited = q
      ? scored.slice(0, 30)
      : scored.filter((item, index, all) => {
          if (item.command.group !== "Chats" && item.command.group !== "Agents")
            return item.command.group !== "Settings"
          return (
            all.filter((other, i) => i < index && other.command.group === item.command.group)
              .length < 5
          )
        })
    if (q) return limited.map((item) => item.command)
    return GROUP_ORDER.flatMap((group) =>
      limited.filter((item) => item.command.group === group).map((item) => item.command),
    )
  }, [commands, query])

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [active])

  function run(command: Command | undefined) {
    if (!command) return
    onClose()
    router.push(command.href)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => (results.length ? (index + 1) % results.length : 0))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => (results.length ? (index - 1 + results.length) % results.length : 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      run(results[active])
    }
  }

  let lastGroup: string | null = null

  return (
    <dialog
      ref={dialogRef}
      aria-label="Command menu"
      className="mx-auto mt-[12vh] w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-[18px] border border-line-strong bg-panel p-0 text-text shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop:bg-void/60 backdrop:backdrop-blur-[2px]"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="h-4 w-4 shrink-0 text-faint" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to a chat, agent, page or setting…"
          aria-label="Search commands"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
        <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint sm:block">
          esc
        </kbd>
      </div>
      <div
        ref={listRef}
        id="command-results"
        role="listbox"
        className="max-h-[min(420px,60vh)] overflow-y-auto p-2"
      >
        {results.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <p className="text-[13px] text-muted">Nothing matches “{query}”.</p>
            <button
              type="button"
              onClick={() => {
                onClose()
                router.push(`${base}/search?q=${encodeURIComponent(query)}`)
              }}
              className="mt-2 text-[13px] text-accent hover:underline"
            >
              Search messages for it instead
            </button>
          </div>
        ) : (
          results.map((command, index) => {
            const header = command.group !== lastGroup ? command.group : null
            lastGroup = command.group
            const Icon = command.icon
            return (
              <div key={command.id}>
                {header ? (
                  <p className="px-3 pb-1 pt-3 text-[11px] font-medium text-faint first:pt-1">
                    {header}
                  </p>
                ) : null}
                <button
                  type="button"
                  id={`cmd-${command.id}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(command)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px]",
                    index === active ? "bg-raised text-text" : "text-muted",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      index === active ? "text-accent" : "text-faint",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {command.hint ? (
                    <span className="shrink-0 truncate text-[12px] text-faint">{command.hint}</span>
                  ) : null}
                  {index === active ? (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                  ) : null}
                </button>
              </div>
            )
          })
        )}
      </div>
      <div className="hidden items-center gap-4 border-t border-line px-4 py-2 font-mono text-[11px] text-faint sm:flex">
        <span>↑↓ move</span>
        <span>↵ open</span>
        <span className="ml-auto">⌘K anywhere</span>
      </div>
    </dialog>
  )
}
