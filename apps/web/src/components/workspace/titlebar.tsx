"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState, useTransition, type ComponentType } from "react"
import { ArrowLeft, ArrowRight, PanelLeft, Pin, PinOff, X } from "lucide-react"
import { setChatPreferenceAction } from "@/lib/actions/room-state"
import { ModelPickerButton } from "@/components/room/model-picker"
import { Mascot } from "@/components/ui/mascot"
import { PlusIcon } from "@/components/ui/icons"
import { showToast } from "@/components/ui/toast"
import { cn } from "@/lib/format"
import type { ChatListItem } from "@/lib/types"

const MAX_TABS = 8

export interface TitlebarPage {
  key: string
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
}

const iconButton =
  "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-panel hover:text-text disabled:opacity-40 [-webkit-app-region:no-drag]"

function readTabs(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

/** The chats you have open, like browser tabs. Remembered per workspace on this device. */
function useOpenTabs(orgSlug: string, currentRoomId: string | null) {
  const storageKey = `sayabot:tabs:${orgSlug}`
  const [tabs, setTabs] = useState<string[] | null>(null)

  useEffect(() => {
    setTabs(readTabs(storageKey))
  }, [storageKey])

  const loaded = tabs !== null
  useEffect(() => {
    if (!currentRoomId || !loaded) return
    setTabs((previous) => {
      if (previous === null || previous.includes(currentRoomId)) return previous
      return [...previous, currentRoomId].slice(-MAX_TABS)
    })
  }, [currentRoomId, loaded])

  useEffect(() => {
    if (tabs === null) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(tabs))
    } catch {
      // Tabs just reset on the next visit.
    }
  }, [storageKey, tabs])

  return [tabs ?? [], setTabs] as const
}

function TabFace({ chat }: { chat: ChatListItem }) {
  if (chat.isBotDm) {
    return <Mascot seed={chat.agentNames[0] ?? chat.name} className="h-5 w-5 shrink-0" />
  }
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-raised text-[11px] font-medium text-muted">
      {chat.kind === "public" ? "#" : chat.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

const tabClass =
  "group flex h-8 min-w-0 max-w-[220px] shrink-0 items-center gap-2 rounded-lg pl-2 pr-1 text-[13.5px] transition-colors [-webkit-app-region:no-drag]"

export function Titlebar({
  orgSlug,
  chats,
  pages,
  pathname,
  currentRoomId,
  desktopApp,
  listOpen,
  onToggleList,
  slotRef,
}: {
  orgSlug: string
  chats: ChatListItem[]
  pages: TitlebarPage[]
  pathname: string
  currentRoomId: string | null
  desktopApp: boolean
  listOpen: boolean
  onToggleList: () => void
  slotRef: (element: HTMLDivElement | null) => void
}) {
  const router = useRouter()
  const base = `/${orgSlug}`
  const [tabs, setTabs] = useOpenTabs(orgSlug, currentRoomId)
  const [pinPending, startPin] = useTransition()

  const byId = useMemo(() => new Map(chats.map((chat) => [chat.id, chat])), [chats])
  const openChats = tabs.map((id) => byId.get(id)).filter((chat): chat is ChatListItem => !!chat)
  const current = currentRoomId ? byId.get(currentRoomId) ?? null : null

  // Outside a chat, the page you are on shows as the active tab.
  const page = useMemo(() => {
    if (currentRoomId) return null
    if (pathname === base || pathname === `${base}/`) return null
    if (pathname.startsWith(`${base}/settings`)) return { label: "Settings", icon: null }
    if (pathname.startsWith(`${base}/chats/new`)) return { label: "New chat", icon: null }
    const match = pages
      .filter((item) => item.href && pathname.startsWith(`${base}${item.href}`))
      .sort((a, b) => b.href.length - a.href.length)[0]
    return match ? { label: match.label, icon: match.icon } : null
  }, [base, currentRoomId, pages, pathname])

  function closeTab(id: string) {
    const index = openChats.findIndex((chat) => chat.id === id)
    const rest = openChats.filter((chat) => chat.id !== id)
    setTabs(rest.map((chat) => chat.id))
    if (id !== currentRoomId) return
    const next = rest[Math.min(index, rest.length - 1)]
    router.push(next ? `${base}/r/${next.id}` : base)
  }

  function togglePin() {
    if (!current) return
    const action = current.pinned ? "unpin" : "pin"
    startPin(async () => {
      const result = await setChatPreferenceAction({ orgSlug, roomId: current.id, action })
      if (!result.ok) {
        showToast({ message: result.error ?? "Could not update the chat", tone: "danger" })
        return
      }
      router.refresh()
    })
  }

  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-1 bg-void pr-2 [-webkit-app-region:drag]",
        desktopApp ? "pl-[84px]" : "pl-3",
      )}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <button type="button" onClick={() => router.back()} aria-label="Back" title="Back" className={iconButton}>
          <ArrowLeft className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={() => window.history.forward()}
          aria-label="Forward"
          title="Forward"
          className={iconButton}
        >
          <ArrowRight className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={onToggleList}
          aria-label={listOpen ? "Hide chat list" : "Show chat list"}
          aria-pressed={listOpen}
          title={listOpen ? "Hide chat list" : "Show chat list"}
          className={iconButton}
        >
          <PanelLeft className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="mx-2 h-5 w-px shrink-0 bg-line" aria-hidden="true" />

      <nav aria-label="Open chats" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {openChats.map((chat) => {
          const active = chat.id === currentRoomId
          return (
            <div
              key={chat.id}
              className={cn(tabClass, active ? "bg-raised text-text" : "text-muted hover:bg-panel hover:text-text")}
            >
              <Link
                href={`${base}/r/${chat.id}`}
                aria-current={active ? "page" : undefined}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <TabFace chat={chat} />
                <span className="truncate font-medium">{chat.name}</span>
                {!active && chat.unreadCount > 0 ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" />
                ) : null}
              </Link>
              <button
                type="button"
                onClick={() => closeTab(chat.id)}
                aria-label={`Close ${chat.name}`}
                title="Close tab"
                className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-text",
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
        {page ? (
          <span className={cn(tabClass, "bg-raised pr-3 font-medium text-text")} aria-current="page">
            {page.icon ? <page.icon className="h-4 w-4 shrink-0 text-muted" /> : null}
            <span className="truncate">{page.label}</span>
          </span>
        ) : null}
        <Link href={`${base}/chats/new`} aria-label="New chat" title="New chat" className={iconButton}>
          <PlusIcon width={16} height={16} />
        </Link>
      </nav>

      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <ModelPickerButton variant="titlebar" />
        {current ? (
          <button
            type="button"
            onClick={togglePin}
            disabled={pinPending}
            aria-pressed={current.pinned}
            aria-label={current.pinned ? "Unpin this chat" : "Pin this chat"}
            title={current.pinned ? "Unpin this chat" : "Pin this chat"}
            className={cn(iconButton, "h-9 w-9", current.pinned && "text-text")}
          >
            {current.pinned ? <PinOff className="h-[17px] w-[17px]" /> : <Pin className="h-[17px] w-[17px]" />}
          </button>
        ) : null}
        <div ref={slotRef} className="flex items-center gap-1" />
      </div>
    </header>
  )
}
